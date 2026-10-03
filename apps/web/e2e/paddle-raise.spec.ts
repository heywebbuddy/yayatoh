import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import {
  continueToPayment,
  expectAccessible,
  expectAccessibleBothModes,
  newUser,
  signIn,
} from './helpers.ts';
import { createGala, publishEvent, unique } from './seating-helpers.ts';

// Each journey buys a table and names its guests first, and axe runs in light and dark.
test.describe.configure({ timeout: 240_000 });

/**
 * M4.8c paddle raise: paddle numbers for a purchased table's guests (bulk) and one at a time, the
 * host console (call a level, running total, undo, close), spotters on phones (keyboard only, a
 * paddle not given at the event refused on the device, duplicates flagged, never dropped), a
 * spotter offline whose entries sync exactly once, the recorder's review turning paddles into
 * pledges, viewers and Arabic RTL. Each test runs on a gala of its own.
 */
const VIEWER = 'jordan@lakeside.test';
const emailOf = (name: string) => `${name.toLowerCase().replace(/\W+/g, '.')}@example.test`;

interface Gala {
  readonly base: string;
  readonly donations: string;
  readonly company: string;
  readonly guests: readonly string[];
}

/** Tickets & Orders: a table ticket of `size` seats. */
async function addTableTicket(page: Page, base: string, name: string, size: number) {
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Price (USD)').fill('400');
  await page.getByLabel('Quantity available').fill('10');
  await page.getByLabel('Seats per table').fill(String(size));
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText(`Table of ${size}`);
}

/** A buyer buys the table (fake provider) and names its guests through the table's link. */
async function buyAndNameTable(
  browser: Browser,
  slug: string,
  ticket: string,
  company: string,
  guests: readonly string[],
) {
  const buyer = `Chair ${company}`;
  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto(`/events/${slug}`);
  await guest.getByLabel(`Quantity — ${ticket}`).selectOption('1');
  await guest.getByLabel('Full name').fill(buyer);
  await guest.getByLabel('Email for your tickets').fill(emailOf(buyer));
  await continueToPayment(guest, emailOf(buyer));
  await guest.getByRole('button', { name: 'Pay now (test)' }).click();
  await expect(guest.getByText('Paid', { exact: true })).toBeVisible();
  await guest
    .getByRole('region', { name: 'Your tables' })
    .getByRole('link', { name: `Name guests at ${ticket} #1` })
    .click();
  await guest.getByLabel('Company or sponsor name').fill(company);
  await guest.getByRole('button', { name: 'Save name' }).click();
  await expect(guest.getByText('Name saved.')).toBeVisible();
  for (const full of guests) {
    const [first, ...last] = full.split(' ');
    await guest.getByLabel('First name').fill(first ?? '');
    await guest.getByLabel('Last name (optional)').fill(last.join(' '));
    await guest.getByRole('button', { name: 'Add guest' }).click();
    await expect(guest.getByText(`${full} has a seat at the table.`)).toBeVisible();
  }
  await context.close();
}

/** Donations: a campaign with two levels. */
async function addCampaignAndLevels(page: Page, donations: string) {
  await page.goto(donations);
  const form = page.getByRole('region', { name: 'Add campaign' });
  await form.getByLabel('Campaign name').fill('Fund-a-need');
  await form.getByLabel('Goal (USD)').fill('50000');
  await form.getByRole('button', { name: 'Add campaign' }).click();
  await expect(form.getByText('Campaign added.')).toBeVisible();
  for (const [name, amount] of [
    ['Fund a classroom', '1000'],
    ['A school day', '250'],
  ] as const) {
    const card = page.getByRole('listitem').filter({ hasText: 'Add a level to Fund-a-need' });
    // The disclosure stays open after the first level.
    if (!(await card.getByLabel('Level name').isVisible()))
      await page.getByText('Add a level to Fund-a-need').click();
    await card.getByLabel('Level name').fill(name);
    await card.getByLabel('Amount (USD)', { exact: true }).fill(amount);
    await card.getByRole('button', { name: 'Add level' }).click();
    await expect(card.getByText(`· ${name}`)).toBeVisible();
  }
}

/** A published gala of the Lakeside owner with a purchased table of named guests and a campaign. */
async function gala(page: Page, browser: Browser, opts: { guests?: number } = {}): Promise<Gala> {
  const name = unique('Paddle Gala');
  const tag = name.replace(/^Paddle Gala /, '');
  const ticket = `Table of 4 ${test.info().project.name.split('-')[0]}`;
  const company = `Acme ${tag}`;
  const guests = ['Ada', 'Grace', 'Hedy']
    .slice(0, opts.guests ?? 3)
    .map((g) => `${g} Donor${tag.replace(/\D/g, '')}`);
  await signIn(page);
  const base = await createGala(page, name);
  await addTableTicket(page, base, ticket, 4);
  await publishEvent(page, base);
  const slug = base.split('/').pop() as string;
  await buyAndNameTable(browser, slug, ticket, company, guests);
  const donations = `${base}/donations`;
  await addCampaignAndLevels(page, donations);
  return { base, donations, company, guests };
}

/** Bulk: one paddle per guest of purchased tables, from 100. */
async function givePaddles(page: Page, g: Gala) {
  await page.goto(`${g.donations}/paddles`);
  const bulk = page.getByRole('region', { name: 'Give paddles in bulk' });
  await bulk.getByRole('button', { name: 'Give paddles' }).click();
  await expect(bulk.getByText('Paddles given.')).toBeVisible();
}

/** A box-office member of Lakeside (may scan, can't run the console) on their own phone. */
async function spotter(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await newUser(page, { join: ['lakeside-events:box_office'] });
  return { context, page };
}

const paddleInput = (page: Page, label = 'Paddle number') => page.getByLabel(label, { exact: true });

/** Type a number and press Enter, keyboard only. */
async function spot(page: Page, number: string, label?: string) {
  await paddleInput(page, label).focus();
  await page.keyboard.type(number);
  await page.keyboard.press('Enter');
}

test.describe('paddle raise (M4.8c)', () => {
  test('paddle numbers: bulk by table, one at the desk, every validation message, take back, viewers read', async ({
    page,
    browser,
  }) => {
    const g = await gala(page, browser);
    await page.goto(`${g.donations}/paddles`);
    await expect(page.getByRole('heading', { name: 'Paddle numbers', level: 1 })).toBeVisible();
    await expect(page.getByText('No paddles given yet')).toBeVisible();
    await expectAccessibleBothModes(page);

    // One at a time: nobody chosen.
    const one = page.getByRole('region', { name: 'Give one paddle' });
    await one.getByRole('button', { name: 'Give paddle' }).click();
    await expect(one.getByText('Choose a guest or a party.')).toBeVisible();
    // Bulk with a start number out of range.
    const bulk = page.getByRole('region', { name: 'Give paddles in bulk' });
    await expect(bulk.getByLabel('Who')).toHaveValue('tables');
    await bulk.getByLabel('First number (optional)').fill('0');
    await bulk.getByRole('button', { name: 'Give paddles' }).click();
    await expect(bulk.getByText('Enter a paddle number from 1 to 99999.')).toBeVisible();
    await expect(bulk.getByLabel('First number (optional)')).toHaveAttribute('aria-invalid', 'true');
    await bulk.getByLabel('First number (optional)').fill('');
    await bulk.getByRole('button', { name: 'Give paddles' }).click();
    await expect(bulk.getByText('Paddles given.')).toBeVisible();
    const list = page.getByRole('table', { name: 'Paddles' });
    for (const [i, guest] of g.guests.entries())
      await expect(list.getByRole('row').filter({ hasText: guest })).toContainText(String(100 + i));
    await expect(page.getByText('3 paddles given')).toBeVisible();
    // Again: nobody left at the tables.
    await bulk.getByRole('button', { name: 'Give paddles' }).click();
    await expect(bulk.getByText('Everyone in that group already has a paddle.')).toBeVisible();

    // The whole table's party gets its own paddle: a taken number first, then the next free one.
    await one.getByLabel('Guest or party').selectOption({ label: `Table: ${g.company}` });
    await one.getByLabel('Paddle number (optional)').fill('101');
    await one.getByRole('button', { name: 'Give paddle' }).click();
    await expect(one.getByText('That paddle number is already given.')).toBeVisible();
    await one.getByLabel('Paddle number (optional)').fill('');
    await one.getByRole('button', { name: 'Give paddle' }).click();
    await expect(one.getByText('Paddle given.')).toBeVisible();
    await expect(list.getByRole('row').filter({ hasText: `${g.company} (whole party)` })).toContainText(
      '103',
    );
    // Take it back; the list keeps the guests' paddles after a reload.
    await list.getByRole('button', { name: 'Take back paddle 103' }).click();
    // The row goes with it (its form and message with it).
    await expect(list.getByRole('row').filter({ hasText: '(whole party)' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('3 paddles given')).toBeVisible();
    await expect(list.getByRole('row').filter({ hasText: g.company })).toHaveCount(3);
    await expectAccessibleBothModes(page);

    // A viewer reads the list, gets no forms, no spotter page, and the sync is refused.
    const vctx = await browser.newContext();
    const viewer = await vctx.newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${g.donations}/paddles`);
    await expect(
      viewer.getByText('You can see the paddles. Ask an organizer to give or take back paddles.'),
    ).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Give paddles' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /Take back/ })).toHaveCount(0);
    await viewer.goto(`${g.donations}/paddle-raise`);
    await expect(
      viewer.getByText('You can watch the raise. Ask an organizer to run the console.'),
    ).toBeVisible();
    await expect(viewer.getByRole('button', { name: /^Call / })).toHaveCount(0);
    const spotPage = await viewer.goto(`${g.donations}/paddle-raise/spot`);
    expect(spotPage?.status()).toBe(404);
    const sync = await viewer.request.post(`${g.donations}/paddle-raise/sync`, {
      headers: { 'content-type': 'application/json' },
      data: {
        entries: [
          {
            clientId: '00000000-0000-4000-8000-000000000001',
            callId: '00000000-0000-4000-8000-000000000002',
            paddle: 100,
            recordedAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(sync.status()).toBe(403);
    await vctx.close();
  });

  test('the room: call a level, spotters record by keyboard, duplicates flagged, undo, close, recorder confirms', async ({
    page,
    browser,
  }) => {
    const g = await gala(page, browser);
    await givePaddles(page, g);
    await page.goto(`${g.donations}/paddle-raise`);
    await expect(page.getByRole('heading', { name: 'Paddle raise', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No level is being called' })).toBeVisible();
    await expect(page.locator('section[data-live]')).toHaveAttribute('data-live', 'live', {
      timeout: 15_000,
    });
    await expectAccessibleBothModes(page);

    // The spotter's phone, before any level: waiting; a number typed now is refused.
    const s = await spotter(browser);
    await s.page.goto(`${g.donations}/paddle-raise/spot`);
    await expect(s.page.getByRole('heading', { name: 'Spot paddles', level: 1 })).toBeVisible();
    await expect(s.page.getByTestId('spot-level')).toHaveText('Waiting for the host to call a level');
    await expect(paddleInput(s.page)).toBeFocused();
    await spot(s.page, '100');
    await expect(s.page.locator('#paddle-error')).toHaveText('No level is being called. Wait for the host.');
    await expectAccessibleBothModes(s.page);

    // The host calls the top level, keyboard only.
    const call = page.getByRole('button', { name: 'Call $1,000.00 · Fund a classroom' });
    await call.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('raise-answer')).toHaveText('Level called.');
    await expect(page.getByTestId('calling-level')).toHaveText('$1,000.00 · Fund a classroom');
    // The spotter's phone shows it live; unknown and malformed numbers are refused on the device.
    await expect(s.page.getByTestId('spot-level')).toHaveText('$1,000.00 · Fund a classroom', {
      timeout: 15_000,
    });
    await paddleInput(s.page).fill('');
    await spot(s.page, '999');
    await expect(s.page.locator('#paddle-error')).toHaveText(
      "Paddle 999 isn't given at this event. Check the number.",
    );
    await expect(paddleInput(s.page)).toHaveAttribute('aria-invalid', 'true');
    await paddleInput(s.page).fill('');
    await spot(s.page, '1a');
    await expect(s.page.locator('#paddle-error')).toHaveText('Enter a paddle number from 1 to 99999.');
    await paddleInput(s.page).fill('');
    // Two paddles, then the first one again: kept and flagged, never dropped.
    await spot(s.page, '100');
    await expect(s.page.getByTestId('spot-notice')).toHaveText('Paddle 100 recorded.');
    await spot(s.page, '101');
    await spot(s.page, '100');
    const recent = s.page.getByRole('region', { name: 'Your last entries' }).getByRole('listitem');
    await expect(recent.first()).toContainText('Already recorded — flagged for the recorder');
    await expect(recent.nth(1)).toContainText('Paddle 101');
    await expect(recent.nth(1)).toContainText('Recorded');
    await expect(s.page.getByTestId('spot-pending')).toHaveText('Everything sent.');
    // The console's running total, live.
    await expect(page.getByTestId('level-running')).toHaveText('2 paddles · $2,000.00');
    await expect(page.getByText('1 duplicate for the recorder to check')).toBeVisible();
    await expectAccessibleBothModes(page);

    // Undo sets the newest waiting paddle aside (the duplicate); then the level closes.
    await page.getByRole('button', { name: 'Undo last step' }).click();
    await expect(page.getByTestId('raise-answer')).toHaveText('Paddle 100 set aside.');
    await expect(page.getByText('1 duplicate for the recorder to check')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close Fund a classroom' }).click();
    await expect(page.getByTestId('raise-answer')).toHaveText('Level closed.');
    await expect(page.getByRole('heading', { name: 'No level is being called' })).toBeVisible();
    await expect(s.page.getByTestId('spot-level')).toHaveText('Waiting for the host to call a level', {
      timeout: 15_000,
    });
    await expect(page.getByRole('table', { name: 'Levels called' }).getByRole('row').nth(1)).toContainText(
      '$2,000.00',
    );

    // The recorder: two recorded paddles become pledges with their holders' names.
    await page.getByRole('link', { name: 'Review (2 to check)' }).click();
    await expect(page.getByRole('heading', { name: 'Review pledges', level: 1 })).toBeVisible();
    const level = page.getByRole('region', { name: '$1,000.00 · Fund a classroom' });
    await expect(
      level
        .getByRole('row')
        .filter({ hasText: g.guests[0] ?? '' })
        .first(),
    ).toBeVisible();
    await expectAccessibleBothModes(page);
    await level.getByRole('button', { name: 'Confirm 2 recorded paddles' }).click();
    await expect(page.getByTestId('raise-answer')).toHaveText('2 pledges confirmed.');
    await expect(page.getByTestId('review-totals')).toContainText('$2,000.00');
    await expect(level.getByRole('row').filter({ hasText: g.guests[1] ?? '' })).toContainText('Pledge');
    // A mistaken paddle: set aside, its pledge cancelled; it stays so after a reload.
    await level.getByRole('button', { name: 'Set aside paddle 101' }).click();
    await expect(page.getByTestId('raise-answer')).toHaveText('Paddle 101 set aside and its pledge cancelled.');
    await page.reload();
    await expect(
      page
        .getByRole('region', { name: '$1,000.00 · Fund a classroom' })
        .getByRole('row')
        .filter({ hasText: g.guests[1] ?? '' }),
    ).toContainText('Set aside');
    await expect(page.getByTestId('review-totals')).toContainText('$1,000.00');
    await expectAccessible(page);
    await s.context.close();
  });

  test('an offline spotter: entries wait on the phone and sync exactly once when it is back', async ({
    page,
    browser,
  }) => {
    const g = await gala(page, browser);
    await givePaddles(page, g);
    await page.goto(`${g.donations}/paddle-raise`);
    await page.getByRole('button', { name: 'Call $250.00 · A school day' }).click();
    await expect(page.getByTestId('calling-level')).toHaveText('$250.00 · A school day');

    const s = await spotter(browser);
    await s.page.goto(`${g.donations}/paddle-raise/spot`);
    await expect(s.page.getByTestId('spot-level')).toHaveText('$250.00 · A school day', { timeout: 15_000 });
    await s.context.setOffline(true);
    for (const n of ['100', '101', '102']) await spot(s.page, n);
    await expect(s.page.getByTestId('spot-notice')).toHaveText('Paddle 102 recorded.');
    await expect(s.page.getByTestId('spot-pending')).toHaveText('3 entries waiting to send');
    await expect(s.page.getByText('Offline — saving on this phone')).toBeVisible();
    await expect(
      s.page.getByRole('region', { name: 'Your last entries' }).getByText('Waiting to send'),
    ).toHaveCount(3);
    await expectAccessible(s.page);
    // Nothing reached the console while the phone was offline.
    await page.reload();
    await expect(page.getByTestId('level-running')).toHaveText('No paddles yet · $0.00');

    // Back online: everything goes, once.
    await s.context.setOffline(false);
    await expect(s.page.getByTestId('spot-pending')).toHaveText('Everything sent.', { timeout: 20_000 });
    await expect(page.getByTestId('level-running')).toHaveText('3 paddles · $750.00', { timeout: 15_000 });
    // The same entries sent again (a lost answer) are recorded once: their first answer comes back.
    const replay = await s.page.evaluate(async (url) => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('yy-paddles:')) ?? '';
      const q = JSON.parse(localStorage.getItem(key) ?? '{}') as { settled?: unknown[] };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entries: (q.settled ?? []).map((e) => ({ ...(e as object), outcome: undefined })),
        }),
      });
      return (await res.json()) as { results: { outcome: { status: string } }[] };
    }, `${g.donations}/paddle-raise/sync`);
    expect(replay.results.map((r) => r.outcome.status)).toEqual(['recorded', 'recorded', 'recorded']);
    await s.page.reload();
    await expect(
      s.page.getByRole('region', { name: 'Your last entries' }).getByText('Recorded', { exact: true }),
    ).toHaveCount(3);
    await page.reload();
    await expect(page.getByTestId('level-running')).toHaveText('3 paddles · $750.00');
    await s.context.close();
  });

  test('Arabic (RTL): paddle numbers, the console and the spotter view', async ({ page }) => {
    await signIn(page);
    const base = await createGala(page, unique('Paddle RTL'));
    await page.goto(`/ar${base}/donations/paddles`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'أرقام المضارب', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'فتح الطاولات والرعاة' })).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.goto(`/ar${base}/donations/paddle-raise`);
    await expect(page.getByRole('heading', { name: 'رفع المضارب', level: 1 })).toBeVisible();
    await expect(page.getByText('لا توجد مستويات تبرع بعد')).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.goto(`/ar${base}/donations/paddle-raise/spot`);
    await expect(page.getByRole('heading', { name: 'تسجيل المضارب', level: 1 })).toBeVisible();
    await expect(page.getByTestId('spot-level')).toHaveText('بانتظار إعلان المضيف لمستوى');
    await spot(page, '7', 'رقم المضرب');
    await expect(page.locator('#paddle-error')).toHaveText('لا يوجد مستوى معلن. انتظر المضيف.');
    await expectAccessibleBothModes(page);
  });
});
