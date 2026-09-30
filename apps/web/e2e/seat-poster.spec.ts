import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, newUser, signIn } from './helpers.ts';
import { createGala, publishEvent, unique } from './seating-helpers.ts';

/**
 * M1.5f: the organizer's "find your table" name poster (A–Z with table and seat), and the public
 * seat finder's emailed code with its per-address limit (M1.14 limiter).
 */
const VIEWER = 'jordan@lakeside.test';
const emailOf = (name: string) => `${name.toLowerCase().replace(/\W+/g, '.')}@example.test`;

async function plan(page: Page, base: string) {
  await page.goto(`${base}/seating`);
  await page.getByLabel('Rows').fill('0');
  await page.getByLabel('Seats per row').fill('1');
  await page.getByLabel('Round tables').fill('2');
  await page.getByLabel('Seats per table').fill('4');
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

async function seat(page: Page, base: string, who: string, table: string) {
  await page.goto(`${base}/seating/assign`);
  await page.getByRole('checkbox', { name: who }).check();
  const item = page.getByLabel('Table or row');
  const option = item.locator('option', { hasText: new RegExp(`^${table} — `) });
  await item.selectOption({ label: (await option.textContent()) ?? '' });
  await page.getByRole('button', { name: 'Seat them' }).click();
  await expect(page.getByRole('region', { name: table, exact: true })).toContainText(who);
}

test.describe('seat finder: name poster and emailed codes', () => {
  test('the organizer prints guests A–Z with their tables; a viewer can open it; a scanner cannot; guests find their seat with a code', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    await signIn(page);
    const base = await createGala(page, unique('Poster gala'));
    const slug = base.split('/').pop() as string;
    await publishEvent(page, base);
    await plan(page, base);
    const tag = String(Date.now()).slice(-6);
    const [zoe, adam, mia, noSeat] = [
      `Zoe Zed ${tag}`,
      `Adam Able ${tag}`,
      `Mia Mid ${tag}`,
      `Nia Nowhere ${tag}`,
    ];
    await addGuests(page, base, [zoe, adam, mia, noSeat]);
    await seat(page, base, zoe, 'Table 2');
    await seat(page, base, adam, 'Table 1');
    await seat(page, base, mia, 'Table 1');

    // The poster, from Seating → Seat finder.
    await page.goto(`${base}/seating/finder`);
    await page.getByRole('link', { name: 'Print name list poster' }).click();
    await expect(page.getByRole('heading', { name: 'Find your table', level: 1 })).toBeVisible();
    const rows = page.getByRole('listitem');
    await expect(rows.filter({ hasText: adam })).toContainText(/Table 1 · Seat \d/);
    await expect(rows.filter({ hasText: zoe })).toContainText(/Table 2 · Seat \d/);
    await expect(rows.filter({ hasText: noSeat })).toHaveCount(0);
    await expect(page.getByText('1 guest has no seat yet and is not on the poster.')).toBeVisible();
    // A–Z: Adam, Mia, Zoe (letter headings too).
    const names = (await rows.allInnerTexts()).map((t) => t.split('\n')[0]?.trim() ?? '');
    expect(names.indexOf(adam)).toBeLessThan(names.indexOf(mia));
    expect(names.indexOf(mia)).toBeLessThan(names.indexOf(zoe));
    await expect(page.getByRole('heading', { name: 'A', level: 2 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print poster' })).toBeVisible();
    await expectAccessible(page);
    const posterUrl = page.url();

    // A viewer (attendees:read) can print it; someone without attendee access gets a 404.
    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(posterUrl);
    await expect(viewer.getByRole('listitem').filter({ hasText: zoe })).toBeVisible();
    // Arabic (in the viewer's browser, so the owner's stays in English): right to left.
    await viewer.goto(posterUrl.replace('/o/', '/ar/o/'));
    await expect(viewer.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(viewer.getByRole('listitem').filter({ hasText: adam })).toContainText('الطاولة 1');
    await expectAccessible(viewer);
    const scanner = await (await browser.newContext()).newPage();
    await newUser(scanner, { join: ['lakeside-events:scanner'] });
    const refused = await scanner.request.get(posterUrl);
    expect(refused.status()).toBe(404);
    expect(await refused.text()).not.toContain(zoe);

    // Guests: the public finder with an emailed code (the M1.7e flow, now also limited per address).
    await page.goto(`${base}/seating/finder`);
    await page.getByLabel('Show guests the venue map and seat finder').check();
    await page.getByLabel('With a code sent to their email (recommended)').check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Seat finder settings saved.')).toBeVisible();
    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/events/${slug}/seat-finder`);
    await guest.getByLabel('Email', { exact: true }).fill(emailOf(zoe));
    await guest.getByRole('button', { name: 'Email me a code' }).click();
    await expect(guest.getByLabel('6-digit code')).toBeVisible();
    const res = await guest.request.get(
      `/api/dev/seat-finder-code?event=${encodeURIComponent(slug)}&email=${encodeURIComponent(emailOf(zoe))}`,
    );
    const code = ((await res.json()) as { code: string }).code;
    await guest.getByLabel('6-digit code').fill(code);
    await guest.getByRole('button', { name: 'Show my seat' }).click();
    await expect(guest.getByRole('region', { name: 'Your seat', exact: true })).toContainText('Table 2');
    await expectAccessible(guest);
  });

  test('past five codes for one address, the finder asks the guest to wait (same answer for any address)', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    await signIn(page);
    const base = await createGala(page, unique('Limit gala'));
    const slug = base.split('/').pop() as string;
    await publishEvent(page, base);
    await plan(page, base);
    await page.goto(`${base}/seating/finder`);
    await page.getByLabel('Show guests the venue map and seat finder').check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Seat finder settings saved.')).toBeVisible();
    // Not on the list: the limit applies all the same, so it reveals nothing.
    const address = `limit.${Date.now()}.${test.info().project.name}@example.test`;
    for (let i = 0; i < 6; i++) {
      // Each try from its own browser (device), so only the per-address limit can stop it.
      const guest = await (await browser.newContext()).newPage();
      await guest.goto(`/events/${slug}/seat-finder`);
      await guest.getByLabel('Email', { exact: true }).fill(address);
      await guest.getByRole('button', { name: 'Email me a code' }).click();
      if (i < 5) {
        await expect(guest.getByLabel('6-digit code')).toBeVisible();
      } else {
        await expect(
          guest
            .getByRole('alert')
            .filter({ hasText: /Too many codes asked for\. Try again in \d+ minutes?\./ }),
        ).toBeVisible();
        await expectAccessible(guest);
      }
      await guest.context().close();
    }
    // The checkout helper reads codes from the same dev mailbox; nothing was mailed to this address.
    const peek = await page.request.get(`/api/dev/last-code?to=${encodeURIComponent(address)}`);
    expect(((await peek.json()) as { code: string | null }).code).toBeNull();
  });
});
