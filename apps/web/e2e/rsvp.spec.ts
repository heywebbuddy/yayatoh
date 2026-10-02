import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type RsvpScenario, rsvpScenario } from '@yayatoh/testing';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { expectAccessible, passHumanCheck, signIn } from './helpers.ts';

/**
 * M4.1d: the RSVP flow. A party answers on its own mobile-first page, reached by its link, the
 * QR code of the same link, or the paper fallback (exact full name + PIN, rate limited with the
 * human check). Household answers with a plus-one, a decline, the deadline lock and the host's
 * reopen; the host's link/QR/PIN tools; viewers see states only; keyboard only, axe, Arabic.
 */

const VIEWER = 'jordan@lakeside.test';
const ORG = '/o/lakeside-events';

test.afterAll(async () => {
  await closePools();
});

let orgId: string | null = null;
/** A fresh wedding in Lakeside Events (owner pani@, viewer jordan@) with two parties and links. */
async function wedding(opts: { deadline?: Date | null; nameLookup?: boolean } = {}): Promise<RsvpScenario> {
  orgId ??= (await resolveOrgSlug('lakeside-events'))?.orgId ?? null;
  if (!orgId) throw new Error('no lakeside-events org (seed?)');
  return rsvpScenario(orgId, opts);
}

const link = (token: string, locale = '') => `${locale}/rsvp/${encodeURIComponent(token)}`;
const console_ = (s: RsvpScenario) => `${ORG}/e/${s.eventSlug}`;
const pair = (page: Page, name: string) => page.getByRole('group', { name, exact: true });

/** Click a form's submit button and wait for its Server Action to answer. */
async function submit(page: Page, button: Locator) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), button.click()]);
}

async function answer(page: Page, name: string, choice: 'Attending' | "Can't attend") {
  await pair(page, name).getByText(choice, { exact: true }).click();
}

/** Opens a disclosure (by its summary text) and returns its region. */
async function open(page: Page, summary: string): Promise<Locator> {
  const region = page.getByRole('region', { name: summary, exact: true });
  if (!(await region.isVisible())) await page.getByText(summary, { exact: true }).click();
  await expect(region).toBeVisible();
  return region;
}

test.describe('RSVP (M4.1d)', () => {
  test('a household answers by its link: errors named, the plus-one named, saved after a reload', async ({
    page,
  }) => {
    const s = await wedding();
    await page.goto(link(s.garcia.token));
    await expect(page).toHaveTitle(/Your RSVP/);
    await expect(page.getByRole('heading', { name: 'RSVP for The Garcia family', level: 1 })).toBeVisible();
    // Only the party's own guests and the sub-events it is invited to.
    await expect(page.getByText('Mei Chen')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Ceremony', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Reception', exact: true })).toBeVisible();
    await expect(pair(page, 'Ana García, Reception')).toHaveCount(0);
    await expect(page.getByText(/The garden/)).toBeVisible();
    await expectAccessible(page);

    // Nothing chosen: the first missing guest is named.
    await page.getByRole('button', { name: 'Send RSVP' }).click();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Please answer for Luis López for every part of the celebration.' }),
    ).toBeVisible();
    await expectAccessible(page);

    for (const g of ['Luis López, Ceremony', "Luis's guest, Ceremony", 'Ana García, Ceremony'])
      await answer(page, g, 'Attending');
    for (const g of ['Luis López, Reception', "Luis's guest, Reception"]) await answer(page, g, 'Attending');
    // An attending plus-one needs a name.
    await page.getByRole('button', { name: 'Send RSVP' }).click();
    await expect(page.getByText("Enter your guest's first name.")).toBeVisible();
    await expect(page.getByLabel('First name')).toBeFocused();
    await expect(page.getByLabel('First name')).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page);

    await page.getByLabel('First name').fill('Sam');
    await page.getByLabel('Last name (optional)').fill('Lee');
    await page.getByRole('button', { name: 'Send RSVP' }).click();
    await expect(page).toHaveURL(/\?thanks=1$/);
    await expect(
      page.getByRole('status').filter({ hasText: 'Thank you! Your RSVP is saved.' }),
    ).toBeVisible();
    await expectAccessible(page);

    // Persisted: a fresh load shows the answers and the named plus-one.
    await page.goto(link(s.garcia.token));
    await expect(page.getByText(/You answered on/)).toBeVisible();
    await expect(page.getByLabel('First name')).toHaveValue('Sam');
    await expect(pair(page, 'Sam Lee, Reception').getByRole('radio', { name: 'Attending' })).toBeChecked();
    await expect(pair(page, 'Ana García, Ceremony').getByRole('radio', { name: 'Attending' })).toBeChecked();

    // The host sees it: responded, with counts per sub-event, and the history names the source.
    await signIn(page);
    await page.goto(`${console_(s)}/guests`);
    const garcia = page.getByRole('region', { name: 'Garcia', exact: true });
    await expect(garcia.getByTestId(`rsvp-state-${s.garcia.id}`)).toHaveText('Responded');
    await expect(garcia.getByText("Ceremony: 3 attending, 0 can't attend, 0 awaiting")).toBeVisible();
    await expect(garcia.getByText('Sam Lee', { exact: true })).toBeVisible();
    await garcia.getByRole('link', { name: 'Show history of Garcia' }).click();
    await expect(garcia.getByText(/RSVP answered · RSVP/)).toBeVisible();
    await expect(garcia.getByText(/Plus-one named · Sam Lee · RSVP/)).toBeVisible();
    await expectAccessible(page);
  });

  test('a party declines; the host filters the list by RSVP state', async ({ page }) => {
    const s = await wedding();
    await page.goto(link(s.chen.token));
    await expect(page.getByRole('heading', { name: 'RSVP for The Chen family', level: 1 })).toBeVisible();
    // No plus-one, no reception for this party.
    await expect(page.getByRole('heading', { name: 'Your guest' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Reception', exact: true })).toHaveCount(0);
    await answer(page, 'Mei Chen, Ceremony', "Can't attend");
    await page.getByRole('button', { name: 'Send RSVP' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Thank you! Your RSVP is saved.' }),
    ).toBeVisible();

    await signIn(page);
    await page.goto(`${console_(s)}/guests`);
    await page.getByLabel('RSVP', { exact: true }).selectOption({ label: 'Responded' });
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('region', { name: 'Chen', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Garcia', exact: true })).toHaveCount(0);
    await expect(
      page
        .getByRole('region', { name: 'Chen', exact: true })
        .getByText("Ceremony: 0 attending, 1 can't attend, 0 awaiting"),
    ).toBeVisible();
    await page.getByLabel('RSVP', { exact: true }).selectOption({ label: 'Invited' });
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('region', { name: 'Garcia', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Chen', exact: true })).toHaveCount(0);
    await expectAccessible(page);
  });

  test('the host copies the link, prints the QR code (it decodes to the link and opens the page), marks it sent and resets it', async ({
    page,
    context,
  }) => {
    const s = await wedding();
    await signIn(page);
    await page.goto(`${console_(s)}/guests/rsvp`);
    await expect(page.getByRole('heading', { name: 'RSVP', level: 1 })).toBeVisible();
    await expect(page.getByTestId('rsvp-find-url')).toContainText(`/rsvp/find/${s.lookupCode}`);
    await expectAccessible(page);
    await page.getByRole('link', { name: 'Link, QR code and PIN for Garcia' }).click();
    await expect(page.getByRole('heading', { name: 'RSVP: Garcia', level: 1 })).toBeVisible();
    await expect(page.getByTestId('party-rsvp-state')).toHaveText('Invited');

    // The link field and the copy button.
    const field = page.getByLabel('RSVP link for Garcia');
    const url = await field.inputValue();
    expect(url).toContain(`/rsvp/${encodeURIComponent(s.garcia.token)}`);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    await page.getByRole('button', { name: 'Copy link RSVP link for Garcia' }).click();
    await expect(page.getByText('Link copied.')).toBeVisible();

    // The QR code on the invitation card is the same link; the PIN is printed beside it.
    const qr = page.getByTestId('party-rsvp-qr');
    await expect(qr).toHaveAttribute('aria-label', 'QR code to the RSVP page of Garcia');
    expect(await decodeQr((await qr.locator('path').getAttribute('d')) ?? '')).toBe(url);
    await expect(page.getByTestId('party-rsvp-pin')).toHaveText(s.garcia.pin);
    await expect(page.getByTestId('party-rsvp-find-url')).toContainText(`/rsvp/find/${s.lookupCode}`);
    await expectAccessible(page);

    await page.getByRole('button', { name: 'Mark as sent' }).click();
    // The state and its date replace the button.
    await expect(page.getByTestId('party-rsvp-state')).toHaveText('Sent');
    await expect(page.getByRole('button', { name: 'Mark as sent' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('party-rsvp-state')).toHaveText('Sent');

    // Scanning the QR code: the decoded address opens the party's page; the first open is `viewed`.
    const guest = await context.browser()?.newContext();
    if (!guest) throw new Error('no browser');
    const phone = await guest.newPage();
    await phone.goto(new URL(url).pathname);
    await expect(phone.getByRole('heading', { name: 'RSVP for The Garcia family', level: 1 })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('party-rsvp-state')).toHaveText('Viewed');

    // Reset the link: the old link and QR stop working at once; the new one works.
    await page.getByRole('button', { name: 'Reset the link' }).click();
    await expect(page.getByText('New link made. Old links and QR codes no longer work.')).toBeVisible();
    await page.reload();
    const fresh = await page.getByLabel('RSVP link for Garcia').inputValue();
    expect(fresh).not.toBe(url);
    const old = await phone.goto(new URL(url).pathname);
    expect(old?.status()).toBe(404);
    await phone.goto(new URL(fresh).pathname);
    await expect(phone.getByRole('heading', { name: 'RSVP for The Garcia family', level: 1 })).toBeVisible();
    await guest.close();

    // Reset the PIN: a new one is shown.
    await page.getByRole('button', { name: 'Reset the PIN' }).click();
    await expect(page.getByText('New PIN made. The old one no longer works.')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('party-rsvp-pin')).not.toHaveText(s.garcia.pin);
  });

  test('paper fallback: name + PIN; wrong, partial and unknown names and wrong PINs get the same answer', async ({
    page,
  }) => {
    const s = await wedding();
    await page.goto(`/rsvp/find/${s.lookupCode.toLowerCase()}`);
    await expect(page.getByRole('heading', { name: 'Find your invitation', level: 1 })).toBeVisible();
    // The page names no event, no host and no guest.
    await expect(page.getByText(s.eventName)).toHaveCount(0);
    await expectAccessible(page);

    const find = page.getByRole('button', { name: 'Find my invitation' });
    await find.click();
    await expect(page.getByText('Enter your full name.')).toBeVisible();
    await expect(page.getByLabel('Full name')).toBeFocused();
    await page.getByLabel('Full name').fill('Luis López');
    await page.getByLabel('PIN').fill('12');
    await find.click();
    await expect(page.getByText('Enter the 6-digit PIN from your invitation.')).toBeVisible();
    await expectAccessible(page);

    const wrongPin = String((Number(s.garcia.pin) + 1) % 1_000_000).padStart(6, '0');
    const noMatch =
      "We couldn't find an invitation with that name and PIN. Check the spelling of your full name as it appears on the invitation, and the PIN.";
    const answers: string[] = [];
    for (const [name, pin] of <[string, string][]>[
      ['Luis López', wrongPin],
      ['Luis', s.garcia.pin],
      ['Nobody Here', s.garcia.pin],
    ]) {
      await page.getByLabel('Full name').fill(name);
      await page.getByLabel('PIN').fill(pin);
      await submit(page, find);
      const alert = page.getByRole('alert').filter({ hasText: noMatch });
      await expect(alert).toBeVisible();
      answers.push((await page.getByRole('main').innerText()).replace(name, '<name>'));
      // The same answer, whatever was wrong (the field keeps what was typed).
      await expect(page).toHaveURL(new RegExp(`/rsvp/find/${s.lookupCode.toLowerCase()}$`));
    }
    expect(new Set(answers).size).toBe(1);
    await expectAccessible(page);

    // The right full name (any case and spacing) and PIN open the party's page.
    await page.getByLabel('Full name').fill('  ana   GARCÍA ');
    await page.getByLabel('PIN').fill(s.garcia.pin);
    await find.click();
    await expect(page.getByRole('heading', { name: 'RSVP for The Garcia family', level: 1 })).toBeVisible();
    expect(new URL(page.url()).pathname).toContain('/rsvp/');
  });

  test('paper fallback: past the limit the human check appears before another try', async ({ page }) => {
    const s = await wedding();
    await page.goto(`/rsvp/find/${s.lookupCode}`);
    const find = page.getByRole('button', { name: 'Find my invitation' });
    const wrongPin = String((Number(s.chen.pin) + 7) % 1_000_000).padStart(6, '0');
    await page.getByLabel('Full name').fill('Mei Chen');
    await page.getByLabel('PIN').fill(wrongPin);
    for (let i = 0; i < 5; i++) {
      await submit(page, find);
      await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toBeVisible();
    }
    await submit(page, find);
    await expect(page.getByRole('group', { name: 'One more step' })).toBeVisible();
    await expectAccessible(page);
    // Solve it and try with the right PIN.
    await passHumanCheck(page);
    await page.getByLabel('PIN').fill(s.chen.pin);
    await find.click();
    await expect(page.getByRole('heading', { name: 'RSVP for The Chen family', level: 1 })).toBeVisible();
  });

  test('after the deadline the page is read-only; the host reopens one party, it answers, and it locks again', async ({
    page,
    browser,
  }) => {
    const s = await wedding({ deadline: new Date(Date.now() - 3_600_000) });
    const guest = await browser.newContext();
    const phone = await guest.newPage();
    await phone.goto(link(s.garcia.token));
    await expect(phone.getByRole('status').filter({ hasText: 'RSVPs are closed' })).toBeVisible();
    await expect(
      phone.getByText('The RSVP deadline has passed. To change your answers, please contact the hosts.'),
    ).toBeVisible();
    await expect(phone.getByRole('button', { name: 'Send RSVP' })).toHaveCount(0);
    await expect(phone.getByText('Luis López: No answer')).toHaveCount(2);
    await expectAccessible(phone);

    await signIn(page);
    await page.goto(`${console_(s)}/guests`);
    const menu = await open(page, 'RSVP options for Garcia');
    await menu.getByRole('button', { name: 'Reopen RSVP for Garcia' }).click();
    // The party's badge says so (the reopen button goes once it is used).
    await expect(
      page.getByRole('region', { name: 'Garcia', exact: true }).getByText('Reopened'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reopen RSVP for Garcia' })).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole('region', { name: 'Garcia', exact: true }).getByText('Reopened'),
    ).toBeVisible();
    // Chen stays closed.
    const chen = await guest.newPage();
    await chen.goto(link(s.chen.token));
    await expect(chen.getByRole('button', { name: 'Send RSVP' })).toHaveCount(0);

    await phone.reload();
    for (const g of [
      'Luis López, Ceremony',
      "Luis's guest, Ceremony",
      'Ana García, Ceremony',
      'Luis López, Reception',
      "Luis's guest, Reception",
    ])
      await answer(phone, g, "Can't attend");
    await phone.getByRole('button', { name: 'Send RSVP' }).click();
    await expect(
      phone.getByRole('status').filter({ hasText: 'Thank you! Your RSVP is saved.' }),
    ).toBeVisible();
    // Answered: closed again, showing the answers.
    await phone.goto(link(s.garcia.token));
    await expect(phone.getByRole('button', { name: 'Send RSVP' })).toHaveCount(0);
    await expect(phone.getByText("Ana García: Can't attend")).toBeVisible();
    await guest.close();
  });

  test('keyboard only: a household answers and sends with the keyboard', async ({ page }) => {
    const s = await wedding();
    await page.goto(link(s.garcia.token));
    await page.getByLabel('First name').focus();
    await page.keyboard.type('Sam');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Last name (optional)')).toBeFocused();
    await page.keyboard.type('Lee');
    // Each guest's pair is one tab stop: Space picks "Attending", an arrow moves to "Can't attend".
    await page.keyboard.press('Tab');
    await expect(pair(page, 'Luis López, Ceremony').getByRole('radio', { name: 'Attending' })).toBeFocused();
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await expect(pair(page, 'Ana García, Ceremony').getByRole('radio', { name: 'Attending' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(
      pair(page, 'Ana García, Ceremony').getByRole('radio', { name: "Can't attend" }),
    ).toBeChecked();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Send RSVP' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('status').filter({ hasText: 'Thank you! Your RSVP is saved.' }),
    ).toBeVisible();
    await page.goto(link(s.garcia.token));
    await expect(pair(page, 'Sam Lee, Ceremony').getByRole('radio', { name: 'Attending' })).toBeChecked();
    await expect(
      pair(page, 'Ana García, Ceremony').getByRole('radio', { name: "Can't attend" }),
    ).toBeChecked();
  });

  test('a viewer sees RSVP states but no links, QR codes or PINs, and cannot reset PINs', async ({
    page,
  }) => {
    const s = await wedding();
    await signIn(page, VIEWER);
    await page.goto(`${console_(s)}/guests`);
    await expect(page.getByTestId(`rsvp-state-${s.garcia.id}`)).toHaveText('Invited');
    await expect(page.getByText('RSVP options for Garcia')).toHaveCount(0);
    await page.goto(`${console_(s)}/guests/rsvp`);
    await expect(
      page.getByText(
        'You can see RSVP states. Links, QR codes and PINs are shown to people who can edit guests.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save RSVP settings' })).toHaveCount(0);
    await page.getByRole('link', { name: 'RSVP of Garcia' }).click();
    await expect(page.getByRole('heading', { name: 'RSVP: Garcia', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset the PIN' })).toHaveCount(0);
    await expect(page.getByTestId('party-rsvp-pin')).toHaveCount(0);
    await expect(page.getByTestId('party-rsvp-qr')).toHaveCount(0);
    await expect(page.getByText(s.garcia.pin)).toHaveCount(0);
    await expectAccessible(page);
  });

  test('the host sets the deadline and turns name lookup off; the paper address stops working', async ({
    page,
  }) => {
    const s = await wedding();
    await signIn(page);
    await page.goto(`${console_(s)}/guests/rsvp`);
    await page.getByLabel('Deadline (America/Chicago)').fill('2020-01-01T12:00');
    await page
      .getByRole('checkbox', { name: 'Let guests find their invitation by full name and PIN' })
      .uncheck();
    await page.getByRole('button', { name: 'Save RSVP settings' }).click();
    await expect(page.getByText('RSVP settings saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByText(/RSVPs close on January 1, 2020/)).toBeVisible();
    await expect(page.getByText('Finding an invitation by name and PIN is off.')).toBeVisible();
    await expect(page.getByLabel('Deadline (America/Chicago)')).toHaveValue('2020-01-01T12:00');
    await expectAccessible(page);
    const res = await page.goto(`/rsvp/find/${s.lookupCode}`);
    expect(res?.status()).toBe(404);
  });

  test('Arabic: the RSVP page, the lookup page and the host page read right to left', async ({ page }) => {
    const s = await wedding();
    await page.goto(link(s.garcia.token, '/ar'));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(
      page.getByRole('heading', { name: 'الرد على الدعوة: The Garcia family', level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'إرسال الرد' })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar/rsvp/find/${s.lookupCode}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'العثور على دعوتك', level: 1 })).toBeVisible();
    await expectAccessible(page);
    await signIn(page);
    await page.goto(`/ar${console_(s)}/guests/rsvp`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الردود', level: 1 })).toBeVisible();
    await expectAccessible(page);
  });
});

let zxingReady: Promise<unknown> | null = null;
/** Read the card's QR back with zxing (the scanner's decoder): rasterise its unit squares. */
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
