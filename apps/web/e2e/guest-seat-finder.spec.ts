import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type GuestSeatScenario, guestSeatScenario } from '@yayatoh/testing';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { expectAccessible, expectAccessibleBothModes, passHumanCheck, signIn } from './helpers.ts';

// axe runs in light and dark on every screen (twice the checks): these journeys get more time.
test.describe.configure({ timeout: 120_000 });

/**
 * M4.4a guest seat finder. A party's own link (the QR code on its invitation, permanent as the
 * party moves) shows its table highlighted on the venue map and its tablemates as the host named
 * them; PIN mode (exact full name + the invitation's PIN) answers with tables and counts only.
 * Acceptance: unauthenticated lookups never show names; there is no enumeration. Plus the host's
 * seat-page QR code and settings, closed and empty states, keyboard only, axe, Arabic RTL.
 */

const VIEWER = 'jordan@lakeside.test';
const ORG = '/o/lakeside-events';
const NAMES = ['Luis', 'Ana', 'Mei', 'Ada', 'López', 'García', 'Okafor'];

test.afterAll(async () => {
  await closePools();
});

let orgId: string | null = null;
async function scenario(opts: Parameters<typeof guestSeatScenario>[1] = {}): Promise<GuestSeatScenario> {
  orgId ??= (await resolveOrgSlug('lakeside-events'))?.orgId ?? null;
  if (!orgId) throw new Error('no lakeside-events org (seed?)');
  return guestSeatScenario(orgId, opts);
}

const seatPage = (token: string, locale = '') => `${locale}/rsvp/${encodeURIComponent(token)}/seat`;
const finder = (s: GuestSeatScenario, locale = '') => `${locale}/events/${s.eventSlug}/seat-finder`;

/** Click a form's submit button and wait for its Server Action to answer. */
async function submit(page: Page, button: Locator) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), button.click()]);
}

async function expectNoGuestNames(page: Page) {
  const text = await page.getByRole('main').innerText();
  for (const n of NAMES) expect(text, n).not.toContain(n);
}

test.describe('guest seat finder (M4.4a)', () => {
  test("a party's link shows its table on the map and its tablemates; keyboard only from the RSVP page", async ({
    page,
  }) => {
    const s = await scenario({ finder: 'code' });
    // The RSVP page leads to the table once the party is seated and the finder is open.
    await page.goto(`/rsvp/${encodeURIComponent(s.garcia.token)}`);
    const card = page.getByTestId('rsvp-seat');
    await expect(card.getByRole('heading', { name: 'Find your table' })).toBeVisible();
    await card.getByRole('link', { name: 'Show my table' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/rsvp/${encodeURIComponent(s.garcia.token)}/seat$`));

    await expect(page.getByRole('heading', { name: 'Where The Garcia family sits', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your table', level: 2 })).toBeVisible();
    const place = page.locator(`[data-guest-place="${s.t1}"]`);
    await expect(place).toContainText('Table 1');
    await expect(place.getByTestId('party-guests')).toHaveText('Luis López, Guest of Luis López, Ana García');
    // Tablemates: the other parties at this table, as the host named them; nobody from table 2.
    await expect(place.getByText('Also at this table')).toBeVisible();
    await expect(place.getByTestId('tablemates')).toHaveText('Mei Chen');
    await expect(page.getByRole('main')).not.toContainText('Ada Okafor');
    // The table is highlighted on the map and marked in the venue guide (its text alternative).
    await expect(page.locator(`[data-highlight-item="${s.t1}"]`)).toHaveCount(1);
    await expect(page.locator('[data-highlight-item]')).toHaveCount(1);
    await expect(page.locator(`[data-your-place="${s.t1}"]`)).toContainText('Your table');
    // The map takes the keyboard (+ zooms out of the opening view of the table, 0 the whole room).
    await page.getByRole('application', { name: 'Venue map' }).focus();
    await page.keyboard.press('0');
    await expect(page.getByText('Zoom 100%')).toBeVisible();
    await page.keyboard.press('+');
    await expect(page.getByText('Zoom 150%')).toBeVisible();
    await expectAccessibleBothModes(page);

    // Chen sees the Garcias as tablemates; the page reads the same after a reload.
    await page.goto(seatPage(s.chen.token));
    await page.reload();
    await expect(page.getByTestId('party-guests')).toHaveText('Mei Chen');
    await expect(page.getByTestId('tablemates')).toContainText('Luis López');
    await expect(page.getByTestId('tablemates')).toContainText('Guest of Luis López');
    await expect(page.getByTestId('tablemates')).toContainText('Ana García');
    // Back to the RSVP by keyboard.
    await page.getByRole('link', { name: 'Back to your RSVP' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/rsvp/${encodeURIComponent(s.chen.token)}$`));
  });

  test('until the seat finder opens the page says so; an unseated party is told its table is not set; forged links 404', async ({
    page,
  }) => {
    const closed = await scenario({ finder: null });
    await page.goto(seatPage(closed.garcia.token));
    await expect(page.getByRole('heading', { name: "Seating isn't ready yet" })).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText('Table 1');
    await expect(page.getByRole('main')).not.toContainText('Mei Chen');
    await expectAccessibleBothModes(page);
    // Nothing on the RSVP page either.
    await page.goto(`/rsvp/${encodeURIComponent(closed.garcia.token)}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('rsvp-seat')).toHaveCount(0);

    const unseated = await scenario({ finder: 'code', seat: false });
    await page.goto(seatPage(unseated.garcia.token));
    await expect(page.getByRole('heading', { name: "Your table isn't set yet" })).toBeVisible();
    await expect(page.locator('[data-highlight-item]')).toHaveCount(0);
    await expectAccessible(page);

    const res = await page.goto(seatPage(`${unseated.garcia.token}x`));
    expect(res?.status()).toBe(404);
    const junk = await page.goto(seatPage('not-a-real-party-link-at-all'));
    expect(junk?.status()).toBe(404);
  });

  test('PIN mode: tables and counts only, never a name; every miss reads the same; keyboard only', async ({
    page,
  }) => {
    const s = await scenario({ finder: 'pin', publish: true });
    await page.goto(finder(s));
    await expect(
      page.getByText('Enter your full name as it appears on your invitation and the 6-digit PIN'),
    ).toBeVisible();
    const find = page.getByRole('button', { name: 'Find my table' });
    await expectAccessibleBothModes(page);

    // Validation, inline.
    await submit(page, find);
    await expect(page.getByRole('alert').filter({ hasText: 'Enter your full name.' })).toBeVisible();
    await page.getByLabel('Full name').fill('Luis López');
    await submit(page, find);
    await expect(
      page.getByRole('alert').filter({ hasText: 'Enter the 6-digit PIN from your invitation.' }),
    ).toBeVisible();

    // A wrong PIN, a partial and an unknown name: one answer, the same page. (Kept under the
    // device's five lookups per ten minutes so the right answer below needs no challenge.)
    const wrongPin = String((Number(s.garcia.pin) + 1) % 1_000_000).padStart(6, '0');
    const noMatch = "We couldn't find a table with that name and PIN.";
    const answers: string[] = [];
    for (const [name, pin] of <[string, string][]>[
      ['Luis López', wrongPin],
      ['Luis', s.garcia.pin],
      ['Nobody Here', s.garcia.pin],
    ]) {
      await page.getByLabel('Full name').fill(name);
      await page.getByLabel('PIN from your invitation').fill(pin);
      await submit(page, find);
      await expect(page.getByRole('alert').filter({ hasText: noMatch })).toBeVisible();
      answers.push(await page.getByRole('main').innerText());
    }
    expect(new Set(answers).size).toBe(1);
    await expectNoGuestNames(page);
    await expectAccessible(page);

    // The right name (any case and spacing) and PIN, typed and sent by keyboard.
    await page.getByLabel('Full name').fill('');
    await page.getByLabel('Full name').focus();
    await page.keyboard.type('  ana   GARCÍA ');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('PIN from your invitation')).toBeFocused();
    await page.getByLabel('PIN from your invitation').fill('');
    await page.keyboard.type(s.garcia.pin);
    await page.keyboard.press('Enter');
    const result = page.getByTestId('pin-result');
    await expect(result.getByRole('heading', { name: 'Your table', level: 2 })).toBeVisible();
    await expect(result.locator(`[data-guest-place="${s.t1}"]`)).toContainText('Table 1');
    await expect(result).toContainText('3 of your party sit here');
    await expect(page.locator(`[data-highlight-item="${s.t1}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-your-place="${s.t1}"]`)).toContainText('Your table');
    // Labels only: no guest's name anywhere on the page, not even the party's own.
    await expectNoGuestNames(page);
    await expect(page.getByRole('main')).not.toContainText('Mei Chen');
    await expectAccessibleBothModes(page);

    // Start over by keyboard: the form is back, empty.
    await page.getByRole('button', { name: 'Look up someone else' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Full name')).toHaveValue('');
    await expect(page.getByTestId('pin-result')).toHaveCount(0);
  });

  test('PIN mode: past the limit the human check comes before another try', async ({ page }) => {
    const s = await scenario({ finder: 'pin', publish: true });
    await page.goto(finder(s));
    const find = page.getByRole('button', { name: 'Find my table' });
    const challenge = page.getByRole('group', { name: "Please confirm you're a person" });
    let tries = 0;
    while (!(await challenge.isVisible()) && tries < 12) {
      await page.getByLabel('Full name').fill('Nobody Here');
      await page.getByLabel('PIN from your invitation').fill('123456');
      await submit(page, find);
      tries++;
    }
    await expect(challenge).toBeVisible();
    expect(tries).toBeLessThanOrEqual(7);
    await expectAccessible(page);
    await passHumanCheck(page);
    await page.getByLabel('PIN from your invitation').fill(s.garcia.pin);
    await page.getByLabel('Full name').fill('Mei Chen');
    await submit(page, find);
    await expect(page.getByTestId('pin-result')).toContainText('Table 1');
    await expectNoGuestNames(page);
  });

  test("the host's party page shows the permanent seat-page QR code; settings offer PIN mode; viewers see neither", async ({
    page,
  }) => {
    const s = await scenario({ finder: null });
    await signIn(page);
    const base = `${ORG}/e/${s.eventSlug}`;
    await page.goto(`${base}/guests/rsvp/${s.garcia.id}`);
    const section = page.getByRole('region', { name: 'Seat page QR code' });
    await expect(section).toBeVisible();
    await expect(section.getByTestId('party-seat-closed')).toBeVisible();
    const qr = section.getByTestId('party-seat-qr');
    const url = (await qr.getAttribute('data-url')) ?? '';
    expect(url).toMatch(new RegExp(`/rsvp/${encodeURIComponent(s.garcia.token)}/seat$`));
    expect(await decodeQr((await qr.locator('path').getAttribute('d')) ?? '')).toBe(url);
    await expect(section.getByLabel('Seat page link for Garcia')).toHaveValue(url);
    await expectAccessibleBothModes(page);

    // Seat finder settings: PIN mode by keyboard, saved, kept after a reload; party links pointer.
    await page.goto(`${base}/seating/finder`);
    await expect(page.getByRole('heading', { name: 'Party links' })).toBeVisible();
    await page.getByLabel('Show guests the venue map and seat finder').focus();
    await page.keyboard.press('Space');
    const pin = page.getByRole('radio', { name: 'By full name and the PIN on their invitation' });
    await pin.focus();
    await page.keyboard.press('Space');
    await expect(pin).toBeChecked();
    await page.getByRole('button', { name: 'Save' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Seat finder settings saved.')).toBeVisible();
    await page.reload();
    await expect(pin).toBeChecked();
    await expect(page.getByText('Look-up: full name and invitation PIN')).toBeVisible();
    await expectAccessible(page);
    // The poster tells guests what to type.
    await page.goto(`${finder(s)}/poster`);
    await expect(page.getByText('Enter your full name and the PIN on your invitation.')).toBeVisible();

    // Now open: the closed note is gone and the code still opens the same page.
    await page.goto(`${base}/guests/rsvp/${s.garcia.id}`);
    await expect(page.getByTestId('party-seat-closed')).toHaveCount(0);
    await expect(page.getByTestId('party-seat-qr')).toHaveAttribute('data-url', url);

    // A viewer sees states only: no link, no QR code.
    await page.context().clearCookies();
    await signIn(page, VIEWER);
    await page.goto(`${base}/guests/rsvp/${s.garcia.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('party-seat-qr')).toHaveCount(0);
    await page.goto(`${base}/seating/finder`);
    await expect(
      page.getByRole('radio', { name: 'By full name and the PIN on their invitation' }),
    ).toHaveCount(0);
  });

  test('Arabic: the seat page and PIN mode read right to left', async ({ page }) => {
    const s = await scenario({ finder: 'pin', publish: true });
    await page.goto(seatPage(s.garcia.token, '/ar'));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'أين تجلس The Garcia family', level: 1 })).toBeVisible();
    await expect(page.locator(`[data-guest-place="${s.t1}"]`)).toContainText('الطاولة 1');
    await expect(page.getByText('يجلس أيضًا على هذه الطاولة')).toBeVisible();
    await expectAccessibleBothModes(page);

    await page.goto(finder(s, '/ar'));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('button', { name: 'اعثر على طاولتي' })).toBeVisible();
    await expectAccessibleBothModes(page);
  });
});

let zxingReady: Promise<unknown> | null = null;
/** Read a QR back with zxing (the scanner's decoder): rasterise its unit squares. */
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
