import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { continueToPayment, expectAccessible, signIn, WEDDING, WEDDING_OWNER } from './helpers.ts';

const VIEWER = 'jordan@lakeside.test';

/** A unique name per test and viewport project (projects run in parallel on one database). */
const unique = (what: string) => `${what} ${Date.now()} ${test.info().project.name.split('-')[0]}`;
const emailOf = (name: string) => `${name.toLowerCase().replace(/\W+/g, '.')}@example.test`;

/** A new, published gala (its profile shows Seating) as the Lakeside owner; returns its console path. */
async function createGala(page: Page, name: string) {
  await page.goto('/o/lakeside-events/events/new');
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Event type').selectOption('gala');
  await page.getByLabel('Starts', { exact: true }).fill('2027-12-04T18:00');
  await page.getByLabel('Ends', { exact: true }).fill('2027-12-04T23:00');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  return { base, slug: base.split('/').pop() as string };
}

/** Round tables and a stage, from numbers (1060 × 1300 cm for two tables: stage on top). */
async function createPlan(page: Page, base: string, tables: number, seatsPerTable: number) {
  await page.goto(`${base}/seating`);
  await page.getByLabel('Rows').fill('0');
  await page.getByLabel('Seats per row').fill('1');
  await page.getByLabel('Round tables').fill(String(tables));
  await page.getByLabel('Seats per table').fill(String(seatsPerTable));
  await page.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.getByRole('application', { name: 'Seating plan' })).toBeVisible();
}

async function addGuests(page: Page, base: string, names: readonly string[]) {
  await page.goto(`${base}/attendees`);
  await page
    .getByText(/^Add (attendee|guest)/i)
    .first()
    .click();
  for (const name of names) {
    await page.getByLabel('Full name').fill(name);
    await page.getByLabel('Email', { exact: true }).fill(emailOf(name));
    await page.getByRole('button', { name: 'Add to the list' }).click();
    await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
  }
}

/** Seat one guest at a table (the M1.7d form), optionally in one seat. */
async function seat(page: Page, base: string, who: string, table: string, seatLabel?: string) {
  await page.goto(`${base}/seating/assign`);
  await page.getByRole('checkbox', { name: who }).check();
  const item = page.getByLabel('Table or row');
  const option = item.locator('option', { hasText: new RegExp(`^${table} — `) });
  await item.selectOption({ label: (await option.textContent()) ?? '' });
  if (seatLabel) await page.getByLabel('Seat', { exact: true }).selectOption({ label: seatLabel });
  await page.getByRole('button', { name: 'Seat them' }).click();
  await expect(page.getByRole('region', { name: table, exact: true })).toContainText(who);
}

/** Organizer: Seating → Seat finder, open it to guests (and choose the lookup). */
async function openFinder(page: Page, base: string, mode: 'code' | 'name' = 'code') {
  await page.goto(`${base}/seating/finder`);
  await page.getByLabel('Show guests the venue map and seat finder').check();
  await page
    .getByLabel(mode === 'code' ? 'With a code sent to their email (recommended)' : 'Instantly, by full name')
    .check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Seat finder settings saved.')).toBeVisible();
}

const newGuest = async (page: Page): Promise<{ guest: Page; context: BrowserContext }> => {
  const context = await page.context().browser()?.newContext();
  if (!context) throw new Error('no browser');
  return { guest: await context.newPage(), context };
};

/** The code "emailed" to an address (dev mail peek; the console mailer prints it in the worker). */
async function mailedCode(page: Page, slug: string, email: string) {
  const res = await page.request.get(
    `/api/dev/seat-finder-code?event=${encodeURIComponent(slug)}&email=${encodeURIComponent(email)}`,
  );
  expect(res.status()).toBe(200);
  const code = ((await res.json()) as { code: string }).code;
  expect(code).toMatch(/^\d{6}$/);
  return code;
}

const viewBox = async (page: Page) =>
  ((await page.getByTestId('venue-map').first().getAttribute('viewBox')) ?? '').split(' ').map(Number);
const noSideScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
const alert = (page: Page) => page.locator('[aria-live="polite"]').getByRole('alert');
const SENT = "If you're on the guest list, we've emailed you a 6-digit code. It works for 10 minutes.";

test.describe('venue map and seat finder (M1.7e)', () => {
  // Each test sets up its own event through the UI (plan, guests, seats) before the guest's part.
  test.describe.configure({ timeout: 120_000 });

  test('the organizer opens the venue map; guests zoom it by buttons and keys; the poster QR and the legacy URL lead to the finder', async ({
    page,
  }) => {
    const name = unique('Map Gala');
    await signIn(page);
    const { base, slug } = await createGala(page, name);
    await createPlan(page, base, 2, 4);
    // An entrance, added and placed with the editor's list (the keyboard path).
    await page.getByLabel('Object', { exact: true }).selectOption('entrance');
    await page.getByRole('button', { name: 'Add object' }).click();
    const label = page.getByLabel('Label of Entrance');
    await label.fill('Garden doors');
    await label.press('Tab');
    const x = page.getByLabel('x — Garden doors');
    await x.fill('0');
    await x.press('Enter');
    const saved = page.getByRole('toolbar', { name: 'Plan tools' }).getByRole('status');
    await expect(saved).not.toHaveText('All changes saved');
    await expect(saved).toHaveText('All changes saved', { timeout: 10_000 });

    // Closed by default: no map on the event page; the finder page says it isn't open.
    await page.goto(`/events/${slug}`);
    await expect(page.getByRole('heading', { name: name, level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Venue map' })).toHaveCount(0);
    await page.goto(`/events/${slug}/seat-finder`);
    await expect(page.getByText("The seat finder isn't open yet")).toBeVisible();
    await expectAccessible(page);

    // The organizer's Seat finder view: the privacy trade-off is spelled out; open it.
    await page.goto(`${base}/seating`);
    await page
      .getByRole('navigation', { name: 'Seating views' })
      .getByRole('link', { name: 'Seat finder' })
      .click();
    await expect(page.getByRole('heading', { name: 'Seat finder', level: 1 })).toBeVisible();
    await expect(page.getByText('Closed to guests')).toBeVisible();
    await expect(
      page.getByText("Faster at the door, but anyone who knows a guest's full name can see where they sit."),
    ).toBeVisible();
    await expect(page.getByLabel('With a code sent to their email (recommended)')).toBeChecked();
    await expect(page.getByTestId('finder-url')).toHaveText(new RegExp(`/events/${slug}/seat-finder$`));
    await expectAccessible(page);
    await openFinder(page, base);
    await page.reload();
    await expect(page.getByText('Open to guests')).toBeVisible();
    await expect(page.getByLabel('Show guests the venue map and seat finder')).toBeChecked();

    // The public event page: the map with its landmarks labelled, and the venue guide.
    await page.goto(`/events/${slug}`);
    const venue = page.getByRole('region', { name: 'Venue map' });
    await expect(venue.getByRole('heading', { name: 'Venue map' })).toBeVisible();
    const map = venue.getByTestId('venue-map');
    await expect(map.locator('[data-object="stage"] text')).toHaveText('Stage');
    await expect(map.locator('[data-object="entrance"] text')).toHaveText('Garden doors');
    await expect(map.locator('[data-item="table"]')).toHaveCount(2);
    const guide = venue.getByRole('list', { name: 'Venue guide' });
    await expect(guide.getByRole('listitem').filter({ hasText: 'Stage' })).toContainText('Top of the map');
    await expect(guide.getByRole('listitem').filter({ hasText: 'Entrance: Garden doors' })).toContainText(
      'Left side of the map',
    );
    await expect(guide.getByRole('listitem').filter({ hasText: 'Table 2' })).toContainText('4 seats');
    await expect(guide.getByRole('listitem').filter({ hasText: 'Table 2' })).toContainText(
      'Right side of the map',
    );
    await expectAccessible(page);
    await noSideScroll(page);

    // Zoom with the buttons…
    const zoom = venue.getByRole('status').filter({ hasText: /^Zoom/ });
    await expect(zoom).toHaveText('Zoom 100%');
    const [, , fullW] = await viewBox(page);
    await venue.getByRole('button', { name: 'Zoom in' }).click();
    await expect(zoom).toHaveText('Zoom 150%');
    expect((await viewBox(page))[2]).toBeLessThan(fullW ?? 0);
    await venue.getByRole('button', { name: 'Zoom out' }).click();
    await expect(zoom).toHaveText('Zoom 100%');
    await expect(venue.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    // …and with the keyboard: Tab to the map, + zooms, arrows move, 0 shows the whole room.
    const app = venue.getByRole('application', { name: 'Venue map' });
    await venue.getByRole('button', { name: 'Zoom in' }).focus();
    for (let i = 0; i < 4 && !(await app.evaluate((el) => el === document.activeElement)); i++)
      await page.keyboard.press('Tab');
    await expect(app).toBeFocused();
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    await expect(zoom).toHaveText('Zoom 225%');
    const [x0] = await viewBox(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await viewBox(page))[0]).toBeGreaterThan(x0 ?? 0);
    await page.keyboard.press('-');
    await expect(zoom).toHaveText('Zoom 150%');
    await page.keyboard.press('0');
    await expect(zoom).toHaveText('Zoom 100%');
    await venue.getByRole('link', { name: 'Find my seat' }).click();
    await expect(page).toHaveURL(new RegExp(`/events/${slug}/seat-finder$`));
    await expect(page.getByRole('heading', { name: 'Find your seat' })).toBeVisible();

    // The poster: a QR code of the stable finder address, which resolves.
    await page.goto(`${base}/seating/finder`);
    await page.getByRole('link', { name: 'Print seat-finder poster' }).click();
    await expect(page).toHaveURL(new RegExp(`/events/${slug}/seat-finder/poster$`));
    await expect(page.getByRole('heading', { name: 'Find your seat', level: 1 })).toBeVisible();
    await expect(page.getByText("Enter your email — we'll send you a code.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print poster' })).toBeVisible();
    const qr = page.getByTestId('poster-qr');
    const url = (await qr.getAttribute('data-url')) ?? '';
    expect(url).toBe(`${new URL(page.url()).origin}/events/${slug}/seat-finder`);
    await expect(qr).toHaveAttribute('aria-label', `QR code to the seat finder: ${url}`);
    expect(await decodeQr((await qr.locator('path').getAttribute('d')) ?? '')).toBe(url);
    await expectAccessible(page);
    const resolved = await page.request.get(url);
    expect(resolved.status()).toBe(200);
    expect(await resolved.text()).toContain('Find your seat');
    // Printed legacy posters: /events/{slug}/attendee resolves to the finder.
    await page.goto(`/events/${slug}/attendee`);
    await expect(page).toHaveURL(new RegExp(`/events/${slug}/seat-finder$`));
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();

    // Arabic: right to left, translated, accessible; no sideways scrolling at any width.
    await page.goto(`/ar/events/${slug}/seat-finder`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'ابحث عن مقعدك' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'دليل المكان' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'تكبير', exact: true })).toBeVisible();
    await expectAccessible(page);
    await noSideScroll(page);
    await page.goto(`/ar/events/${slug}`);
    await expect(page.getByRole('heading', { name: 'خريطة المكان' })).toBeVisible();
    await expectAccessible(page);
    await noSideScroll(page);
  });

  test('a guest finds their seat with an emailed code; unknown emails get the same answer; wrong codes run out; a used code is refused', async ({
    page,
  }) => {
    const name = unique('Code Gala');
    const ann = `Ann ${name}`;
    await signIn(page);
    const { base, slug } = await createGala(page, name);
    await createPlan(page, base, 2, 4);
    await addGuests(page, base, [ann]);
    await seat(page, base, ann, 'Table 2', 'Table 2 · 1');
    await openFinder(page, base);

    const { guest, context } = await newGuest(page);
    await guest.goto(`/events/${slug}/seat-finder`);
    await expect(guest.getByRole('heading', { name: 'Find your seat', level: 2 })).toBeVisible();
    await expectAccessible(guest);
    const email = guest.getByLabel('Email', { exact: true });
    const send = guest.getByRole('button', { name: 'Email me a code' });

    // Validation.
    await send.click();
    await expect(alert(guest)).toHaveText('Enter a valid email address.');
    await email.fill('not-an-email');
    await send.click();
    await expect(alert(guest)).toHaveText('Enter a valid email address.');
    await expect(email).toHaveValue('not-an-email');

    // An address that isn't on the list gets exactly the same answer, and no code works for it.
    await email.fill(`nobody.${Date.now()}@example.test`);
    await send.click();
    await expect(guest.getByRole('status').filter({ hasText: SENT })).toBeVisible();
    const unknownAnswer = await guest.getByRole('region', { name: 'Enter your code' }).innerText();
    const code = guest.getByLabel('6-digit code');
    await code.fill('123456');
    await guest.getByRole('button', { name: 'Show my seat' }).click();
    await expect(alert(guest)).toHaveText("That code isn't right. You have 4 tries left.");
    await expectAccessible(guest);
    await guest.getByRole('button', { name: 'Use a different email' }).click();
    await expect(email).toBeVisible();

    // The guest on the list, by keyboard: type the email, Enter; the same neutral answer.
    await email.focus();
    await guest.keyboard.type(emailOf(ann));
    await guest.keyboard.press('Enter');
    await expect(guest.getByRole('status').filter({ hasText: SENT })).toBeVisible();
    expect(await guest.getByRole('region', { name: 'Enter your code' }).innerText()).toBe(unknownAnswer);
    const right = await mailedCode(page, slug, emailOf(ann));
    // A copy of this browser's state, to try the same code again later.
    const twin = await (
      await page
        .context()
        .browser()
        ?.newContext({ storageState: await context.storageState() })
    )?.newPage();
    if (!twin) throw new Error('no twin');
    await code.fill('12ab');
    await code.press('Enter');
    await expect(alert(guest)).toHaveText('Enter the 6 digits from the email.');
    await code.fill(right);
    await code.press('Enter');

    // Their seat: listed, described, highlighted on the map and marked in the guide.
    const result = guest.getByRole('region', { name: 'Your seat', exact: true });
    await expect(result).toContainText('Table 2 · Seat 1');
    await expect(result).toContainText('Right side of the map');
    await expect(guest.getByTestId('venue-map').locator('[data-highlight]')).toHaveCount(1);
    await expect(
      guest.getByRole('list', { name: 'Venue guide' }).getByRole('listitem').filter({ hasText: 'Table 2' }),
    ).toContainText('Your seat: 1');
    await expect(guest.getByRole('status').filter({ hasText: /^Zoom/ })).toHaveText('Zoom 225%');
    await expectAccessible(guest);
    // It stays after a reload (for a day), and never shows anyone else.
    await guest.reload();
    await expect(guest.getByRole('region', { name: 'Your seat', exact: true })).toContainText(
      'Table 2 · Seat 1',
    );
    await expect(guest.getByText(ann)).toHaveCount(0);

    // The same code again (another browser holding it): already used.
    await twin.goto(`/events/${slug}/seat-finder`);
    await twin.getByLabel('6-digit code').fill(right);
    await twin.getByRole('button', { name: 'Show my seat' }).click();
    await expect(twin.locator('[aria-live="polite"]').getByRole('alert')).toHaveText(
      'This code has already been used. Ask for a new one.',
    );

    // Five wrong codes lock a code; then even the right one is refused.
    await guest.getByRole('button', { name: 'Look up someone else' }).click();
    await guest.getByLabel('Email', { exact: true }).fill(emailOf(ann));
    await guest.getByRole('button', { name: 'Email me a code' }).click();
    await expect(guest.getByRole('status').filter({ hasText: SENT })).toBeVisible();
    const fresh = await mailedCode(page, slug, emailOf(ann));
    const wrong = fresh === '000000' ? '111111' : '000000';
    for (const left of ['4 tries', '3 tries', '2 tries', '1 try']) {
      await guest.getByLabel('6-digit code').fill(wrong);
      await guest.getByRole('button', { name: 'Show my seat' }).click();
      await expect(alert(guest)).toHaveText(`That code isn't right. You have ${left} left.`);
    }
    await guest.getByLabel('6-digit code').fill(wrong);
    await guest.getByRole('button', { name: 'Show my seat' }).click();
    await expect(alert(guest)).toHaveText('Too many wrong codes. Ask for a new code.');
    await guest.getByLabel('6-digit code').fill(fresh);
    await guest.getByRole('button', { name: 'Show my seat' }).click();
    await expect(alert(guest)).toHaveText('Too many wrong codes. Ask for a new code.');
    await expect(guest.getByRole('region', { name: 'Your seat', exact: true })).toHaveCount(0);
    await noSideScroll(guest);
  });

  test('a party that bought seats sees all of them on the map', async ({ page }) => {
    const name = unique('Party Gala');
    const buyer = `Pat ${name}`;
    await signIn(page);
    const { base, slug } = await createGala(page, name);
    await page.goto(`${base}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill('Table seat');
    await page.getByLabel('Price (USD)').fill('0');
    await page.getByLabel('Quantity available').fill('20');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Table seat' })).toBeVisible();
    await createPlan(page, base, 1, 4);
    const prices = page.getByRole('region', { name: 'Prices' });
    await prices.getByRole('checkbox', { name: 'Table 1' }).check();
    await prices.getByLabel('Sells as').selectOption({ label: 'Table seat' });
    await prices.getByRole('button', { name: 'Set price' }).click();
    await expect(prices.getByText('Prices updated.')).toBeVisible();
    await page.getByRole('button', { name: 'Put seats on sale' }).click();
    await expect(page.getByText('On sale', { exact: true })).toBeVisible();
    await openFinder(page, base);

    // One buyer takes two seats at Table 1 (free tickets: straight to the order).
    const { guest } = await newGuest(page);
    await guest.goto(`/events/${slug}`);
    const seats = guest.getByRole('group', { name: 'Table 1' }).getByRole('checkbox');
    await seats.nth(0).check();
    await seats.nth(1).check();
    await guest.getByLabel('Full name').fill(buyer);
    await guest.getByLabel('Email for your tickets').fill(emailOf(buyer));
    await continueToPayment(guest, emailOf(buyer));
    await expect(guest).toHaveURL(/\/orders\//);

    await guest.goto(`/events/${slug}/seat-finder`);
    await guest.getByLabel('Email', { exact: true }).fill(emailOf(buyer));
    await guest.getByRole('button', { name: 'Email me a code' }).click();
    await expect(guest.getByRole('status').filter({ hasText: SENT })).toBeVisible();
    await guest.getByLabel('6-digit code').fill(await mailedCode(page, slug, emailOf(buyer)));
    await guest.getByRole('button', { name: 'Show my seat' }).click();
    const result = guest.getByRole('region', { name: 'Your seats', exact: true });
    await expect(result.getByRole('listitem')).toHaveCount(2);
    await expect(result).toContainText('Table 1 · Seat 1');
    await expect(result).toContainText('Table 1 · Seat 2');
    await expect(guest.getByTestId('venue-map').locator('[data-highlight]')).toHaveCount(2);
    await expect(guest.getByRole('list', { name: 'Venue guide' })).toContainText('Your seats: 1, 2');
    await expectAccessible(guest);
  });

  test('instant name lookup: the organizer opts in; exact names only; past the limit a challenge; viewers cannot change it', async ({
    page,
  }) => {
    const name = unique('Name Gala');
    const zed = `Zed ${name}`;
    await signIn(page);
    const { base, slug } = await createGala(page, name);
    await createPlan(page, base, 2, 4);
    await addGuests(page, base, [zed]);
    await seat(page, base, zed, 'Table 1');
    await openFinder(page, base, 'name');
    await expect(page.getByText('Look-up: full name')).toBeVisible();

    const { guest } = await newGuest(page);
    await guest.goto(`/events/${slug}/seat-finder`);
    const field = guest.getByLabel('Full name');
    const find = guest.getByRole('button', { name: 'Find my seat' });
    await expect(guest.getByLabel('Email', { exact: true })).toHaveCount(0);
    await expectAccessible(guest);
    await find.click();
    await expect(alert(guest)).toHaveText('Enter your full name.');
    // Partial names find no one; the exact name (any case, extra spaces) finds the seat.
    await field.fill('Zed');
    await find.click();
    await expect(guest.getByRole('heading', { name: 'No one found' })).toBeVisible();
    await expect(
      guest.getByText("We couldn't find that name. Check the spelling, or ask a host."),
    ).toBeVisible();
    await field.fill(`  ${zed.toUpperCase()} `);
    await field.press('Enter');
    await expect(guest.getByRole('region', { name: 'Your seat', exact: true })).toContainText(
      'Table 1 · Seat 1',
    );
    await expect(guest.getByTestId('venue-map').locator('[data-highlight]')).toHaveCount(1);
    await expectAccessible(guest);

    // Past 30 lookups a minute from this device: a challenge instead of a block.
    const challenge = guest.getByRole('group', { name: "Please confirm you're a person" });
    let tries = 2;
    while (!(await challenge.isVisible()) && tries < 70) {
      await field.fill(`Nobody ${tries}`);
      await Promise.all([guest.waitForResponse((r) => r.request().method() === 'POST'), find.click()]);
      tries++;
    }
    await expect(challenge).toBeVisible();
    expect(tries).toBeGreaterThan(30);
    await expectAccessible(guest);
    await field.fill(zed);
    await find.click();
    await expect(challenge).toBeVisible();
    await expect(guest.getByRole('region', { name: 'Your seat', exact: true })).toHaveCount(0);
    await challenge.getByLabel("I'm a person (test check)").check();
    await find.click();
    await expect(guest.getByRole('region', { name: 'Your seat', exact: true })).toContainText(
      'Table 1 · Seat 1',
    );

    // A viewer sees the settings but can't change them; a stale owner page is refused.
    const viewer = (await newGuest(page)).guest;
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/seating/finder`);
    await expect(viewer.getByText('You can see these settings but not change them.')).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await expect(viewer.getByRole('link', { name: 'Print seat-finder poster' })).toBeVisible();
    await expectAccessible(viewer);
    await page.goto(`${base}/seating/finder`);
    await signIn(page, VIEWER);
    await page.getByLabel('With a code sent to their email (recommended)').check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(alert(page)).toHaveText("You don't have access to this.");
    await viewer.reload();
    await expect(viewer.getByText('Look-up: full name')).toBeVisible();
  });

  test('the wedding "Seat finder" menu item leads to the seat finder settings', async ({ page }) => {
    await signIn(page, WEDDING_OWNER);
    await page.goto(`${WEDDING}/seat-finder`);
    await expect(page).toHaveURL(new RegExp(`${WEDDING}/seating/finder$`));
    await expect(page.getByRole('heading', { name: 'Seat finder', level: 1 })).toBeVisible();
    await expectAccessible(page);
  });
});

let zxingReady: Promise<unknown> | null = null;
/** Read the poster's QR back with zxing (the scanner's decoder): rasterise its unit squares. */
async function decodeQr(d: string): Promise<string | undefined> {
  zxingReady ??= (async () => {
    const entry = createRequire(import.meta.url).resolve('zxing-wasm/reader');
    const wasm = readFileSync(join(dirname(entry), '..', '..', 'reader', 'zxing_reader.wasm'));
    await prepareZXingModule({
      overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) },
      fireImmediately: true,
    });
  })();
  await zxingReady;
  const squares = [...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  const size = Math.max(...squares.flat()) + 5;
  const scale = 4;
  const width = size * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const [x, y] of squares)
    for (let dy = 0; dy < scale; dy++)
      for (let dx = 0; dx < scale; dx++) {
        const i = ((y * scale + dy) * width + x * scale + dx) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
  const [hit] = await readBarcodes({ data, width, height: width, colorSpace: 'srgb' } as ImageData, {
    formats: ['QRCode'],
    maxNumberOfSymbols: 1,
  });
  return hit?.text;
}
