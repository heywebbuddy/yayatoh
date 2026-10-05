import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { continueToPayment, expectAccessible, pickOption, signIn } from './helpers.ts';

/**
 * Guest assistance (M3.3b): a guest asks for help from the seat finder with their ticket's link,
 * staff see it live in the console, take it, start and resolve it (keyboard), the guest sees it
 * resolved; medical shows the emergency guidance first; validation; invalid ticket links refused;
 * viewers read but can't act; door staff ask for help from the Scan PWA and work the queue there.
 * Each test makes its own event happening now (unique per project and run).
 */

const VIEWER = 'jordan@lakeside.test';
const stamp = () => `${test.info().project.name.split('-')[0]}${Date.now()}`;

function chicago(offsetH: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + offsetH * 3_600_000));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

interface Setup {
  readonly base: string;
  readonly slug: string;
  readonly name: string;
  /** The guest's order page (the manage link). */
  readonly orderUrl: string;
}

/** An event happening now with a North gate and one free ticket bought by a guest. */
async function eventNow(page: Page, browser: Browser, prefix: string): Promise<Setup> {
  const name = `${prefix} ${stamp()}`;
  await signIn(page);
  await page.goto('/o/lakeside-events/events/new');
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await pickOption(page.getByLabel('Time zone'), 'America/Chicago');
  await page.getByLabel('Starts', { exact: true }).fill(chicago(-1));
  await page.getByLabel('Ends', { exact: true }).fill(chicago(3));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  const slug = base.split('/').pop() as string;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill('Help pass');
  await page.getByLabel('Price (USD)').fill('0');
  await page.getByLabel('Quantity available').fill('5');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Help pass' })).toBeVisible();
  await page.goto(`${base}/onsite`);
  const setup = page.getByRole('region', { name: 'Entrances and zones' });
  await setup.getByLabel('Name', { exact: true }).fill('North gate');
  await pickOption(setup.getByLabel('Type'), { label: 'Entrance' });
  await setup.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(setup.getByRole('listitem').filter({ hasText: 'North gate' })).toBeVisible();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const email = `help+${stamp()}@example.test`;
  await guest.goto(`/events/${slug}`);
  await pickOption(guest.getByLabel('Quantity — Help pass'), '1');
  await guest.getByLabel('Full name').fill(`Hana ${stamp()}`);
  await guest.getByLabel('Email for your tickets').fill(email);
  await continueToPayment(guest, email);
  await expect(guest).toHaveURL(/\/orders\//);
  const orderUrl = new URL(guest.url()).pathname;
  await guestContext.close();
  return { base, slug, name, orderUrl };
}

/** The guest's browser: from the order page's ticket link to the seat finder's "Need help". */
async function guestAtSeatFinder(
  browser: Browser,
  ev: Setup,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(ev.orderUrl);
  await page.getByRole('link', { name: /Find your seat or ask for help at the event/ }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${ev.slug}/seat-finder\\?ticket=`));
  await expect(page.getByRole('heading', { name: 'Need help?' })).toBeVisible();
  return { context, page };
}

const requestCard = (page: Page, text: string) => page.getByRole('listitem').filter({ hasText: text });

test.describe('Guest assistance (M3.3b)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('guest asks for help from the seat finder; staff see it live, assign and resolve by keyboard; the guest sees it resolved', async ({
    page,
    browser,
  }) => {
    const ev = await eventNow(page, browser, 'Help live');
    // Staff: the queue is open (empty) and following the event's channel.
    await page.goto(`${ev.base}/assistance`);
    await expect(page.getByRole('heading', { name: 'Help requests', level: 1 })).toBeVisible();
    await expect(page.getByText('No open help requests')).toBeVisible();
    await expect(page.getByTestId('assistance-live')).toHaveAttribute('data-live', 'live', {
      timeout: 15_000,
    });
    await expectAccessible(page);

    const guest = await guestAtSeatFinder(browser, ev);
    await expectAccessible(guest.page);
    await guest.page.getByRole('link', { name: 'Ask for help' }).click();
    await expect(guest.page.getByRole('heading', { name: 'Need help?', level: 1 })).toBeVisible();
    await expectAccessible(guest.page);

    // Validation: no reason chosen.
    await guest.page.getByRole('button', { name: 'Ask for help' }).click();
    await expect(
      guest.page.getByRole('alert').filter({ hasText: 'Choose what you need help with.' }),
    ).toBeVisible();

    // Medical shows the emergency guidance first (keyboard: arrow keys move between reasons).
    await guest.page.getByRole('radio', { name: 'Seat problem' }).focus();
    await guest.page.keyboard.press('Space');
    await expect(guest.page.getByText('In an emergency, call for help now')).toHaveCount(0);
    await guest.page.keyboard.press('ArrowDown');
    await guest.page.keyboard.press('ArrowDown');
    await expect(guest.page.getByRole('radio', { name: 'Medical' })).toBeChecked();
    await expect(guest.page.getByText('In an emergency, call for help now')).toBeVisible();
    await expectAccessible(guest.page);

    // Back to a seat problem, with where and a note; submitted by keyboard.
    await guest.page.getByRole('radio', { name: 'Seat problem' }).check();
    const note = `Someone in my seat ${stamp()}`;
    await guest.page.getByLabel('Where are you? (optional)').fill('Row C, seat 12');
    await guest.page.getByLabel('Anything else staff should know? (optional)').fill(note);
    await guest.page.getByRole('button', { name: 'Ask for help' }).focus();
    await guest.page.keyboard.press('Enter');
    await expect(guest.page).toHaveURL(new RegExp(`/events/${ev.slug}/seat-finder/help/`));
    await expect(guest.page.getByRole('heading', { name: /Help request #\d+/ })).toBeVisible();
    await expect(guest.page.getByTestId('guest-help-state')).toContainText('Waiting for staff');
    await expect(guest.page.getByText('You asked about: Seat problem')).toBeVisible();
    await expect(guest.page.getByText(note)).toHaveCount(0);
    await expectAccessible(guest.page);

    // Staff: it appears without a reload, with its SLA timer.
    const card = requestCard(page, note);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('Seat problem');
    await expect(card).toContainText('Normal priority');
    await expect(card).toContainText('Where: Row C, seat 12');
    await expect(card).toContainText(/Hana \S+ · ticket \S+/);
    await expect(card.getByTestId('sla-timer')).toContainText(/Take within \d+:\d\d/);
    await expectAccessible(page);

    // Assign by keyboard: pick a person, then the Assign button.
    const assign = card.getByLabel(/^Assign #\d+ · Seat problem to$/);
    await assign.focus();
    await pickOption(assign, { index: 1 });
    await card.getByRole('button', { name: 'Assign', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(card.getByTestId('assistance-message')).toContainText('is assigned.');
    await expect(card.getByTestId('request-state')).toHaveText('Assigned');
    await expect(card.getByTestId('sla-timer')).toHaveCount(0);

    await card.getByRole('button', { name: /^Start #\d+/ }).focus();
    await page.keyboard.press('Enter');
    await expect(card.getByTestId('request-state')).toHaveText('In progress');
    await guest.page.getByRole('button', { name: 'Refresh status' }).click();
    await expect(guest.page.getByTestId('guest-help-state')).toContainText('A staff member is with you');

    await card.getByLabel(/^Note on #\d+/).fill('Found them a free seat');
    await card.getByRole('button', { name: 'Add note' }).focus();
    await page.keyboard.press('Enter');
    await expect(card.getByTestId('assistance-message')).toContainText('Note added to');
    await card.getByRole('button', { name: /^Resolve #\d+/ }).focus();
    await page.keyboard.press('Enter');
    await expect(requestCard(page, note)).toHaveCount(0);

    // Persisted: the closed tab has it, with its activity.
    await page.reload();
    await page.getByRole('link', { name: 'Closed' }).click();
    const closed = requestCard(page, note);
    await expect(closed.getByTestId('request-state')).toHaveText('Resolved');
    await closed.getByText(/\d+ updates/).click();
    await expect(closed).toContainText('Found them a free seat');
    await expectAccessible(page);

    // The guest sees it resolved.
    await guest.page.getByRole('button', { name: 'Refresh status' }).click();
    await expect(guest.page.getByTestId('guest-help-state')).toContainText('Resolved');

    // Arabic RTL: the guest's status and the queue.
    await guest.page.goto(`/ar${new URL(guest.page.url()).pathname}`);
    await expect(guest.page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(guest.page.getByTestId('guest-help-state')).toContainText('تم الحل');
    await expectAccessible(guest.page);
    await page.goto(`/ar${ev.base}/assistance?status=closed`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'طلبات المساعدة', level: 1 })).toBeVisible();
    await expectAccessible(page);
    await guest.context.close();
  });

  test('invalid ticket links are refused: garbage, another event’s ticket, and an unknown status link', async ({
    page,
    browser,
  }) => {
    const ev = await eventNow(page, browser, 'Help links');
    const other = await eventNow(page, browser, 'Help other');
    const guest = await guestAtSeatFinder(browser, other);
    const otherToken = new URL(guest.page.url()).searchParams.get('ticket') ?? '';

    // Without a link the seat finder explains how to ask.
    await guest.page.goto(`/events/${ev.slug}/seat-finder`);
    await expect(guest.page.getByText('Open the seat finder from the link on your ticket')).toBeVisible();
    // Another event's ticket link on this event: refused, on the seat finder and the help page.
    await guest.page.goto(`/events/${ev.slug}/seat-finder?ticket=${encodeURIComponent(otherToken)}`);
    await expect(
      guest.page.getByRole('alert').filter({ hasText: "This ticket link isn't valid for this event" }),
    ).toBeVisible();
    await expect(guest.page.getByRole('link', { name: 'Ask for help' })).toHaveCount(0);
    await guest.page.goto(`/events/${ev.slug}/seat-finder/help?ticket=${encodeURIComponent(otherToken)}`);
    await expect(guest.page.getByText("This ticket link isn't valid for this event")).toBeVisible();
    await expect(guest.page.getByRole('button', { name: 'Ask for help' })).toHaveCount(0);
    await expectAccessible(guest.page);
    // A forged link.
    await guest.page.goto(`/events/${ev.slug}/seat-finder/help?ticket=not-a-real-link`);
    await expect(guest.page.getByText("This ticket link isn't valid for this event")).toBeVisible();
    // An unknown status link is a 404.
    const res = await guest.page.goto(`/events/${ev.slug}/seat-finder/help/nope~nope`);
    expect(res?.status()).toBe(404);
    // Arabic RTL of the refusal.
    await guest.page.goto(`/ar/events/${ev.slug}/seat-finder/help?ticket=x`);
    await expect(guest.page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(guest.page.getByText('رابط التذكرة هذا غير صالح لهذه الفعالية')).toBeVisible();
    await guest.context.close();
  });

  test('scanner staff ask for help from the Scan PWA; the device takes and resolves; viewers can’t act', async ({
    page,
    browser,
  }) => {
    const ev = await eventNow(page, browser, 'Help door');
    await page.goto(`${ev.base}/onsite`);
    await page.getByLabel('Device name').fill('Gate phone');
    await page.getByRole('button', { name: 'Add device' }).click();
    const link = (await page.getByTestId('scan-link').getAttribute('href')) ?? '';
    const deviceContext = await browser.newContext();
    const device = await deviceContext.newPage();
    await device.goto(link);
    await expect(device.getByRole('heading', { name: ev.name })).toBeVisible();
    await pickOption(device.getByLabel('Scanning at'), { label: 'North gate' });
    const staff = device
      .getByRole('navigation', { name: 'Scanner mode' })
      .getByRole('button', { name: 'Staff', exact: true });
    await staff.focus();
    await device.keyboard.press('Enter');
    await expect(device.getByTestId('staff-help-empty')).toBeVisible();

    // Ask for backup by keyboard.
    await pickOption(device.getByLabel('What do you need?'), 'backup');
    const note = `Long line ${stamp()}`;
    await device.getByLabel('Note (optional)').fill(note);
    await device.getByRole('button', { name: 'Send request' }).focus();
    await device.keyboard.press('Enter');
    await expect(device.getByTestId('staff-help-message')).toContainText(/Help request #\d+ sent\./);
    const mine = device.getByRole('listitem').filter({ hasText: note });
    await expect(mine).toContainText('Backup');
    await expect(mine).toContainText('High priority');
    await expectAccessible(device);

    // The console shows it with the device and entrance.
    await page.goto(`${ev.base}/assistance`);
    const card = requestCard(page, note);
    await expect(card).toContainText('At North gate');
    await expect(card).toContainText('Sent from Gate phone');
    await expect(card).toContainText('From door staff');

    // A viewer reads the queue but has no controls.
    const viewerContext = await browser.newContext();
    const viewer = await viewerContext.newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${ev.base}/assistance`);
    await expect(
      viewer.getByText("You can see the requests; your role can't take or change them."),
    ).toBeVisible();
    await expect(requestCard(viewer, note)).toBeVisible();
    await expect(viewer.getByRole('button', { name: /^Take / })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /^Resolve / })).toHaveCount(0);
    await expectAccessible(viewer);
    await viewerContext.close();

    // The device takes it and resolves it (keyboard); the console follows live.
    await mine.getByRole('button', { name: /^Take #\d+/ }).focus();
    await device.keyboard.press('Enter');
    await expect(device.getByTestId('staff-help-message')).toContainText('You took');
    await expect(card).toContainText('With Gate phone', { timeout: 15_000 });
    await mine.getByRole('button', { name: /^Resolve #\d+/ }).focus();
    await device.keyboard.press('Enter');
    await expect(device.getByTestId('staff-help-empty')).toBeVisible();
    await expect(requestCard(page, note)).toHaveCount(0, { timeout: 15_000 });

    // Arabic RTL on the scanner's staff screen.
    await device.goto('/ar/scan');
    await expect(device.locator('html')).toHaveAttribute('dir', 'rtl');
    await device.getByRole('navigation').getByRole('button').nth(1).click();
    await expect(device.getByRole('heading', { name: 'اطلب المساعدة' })).toBeVisible();
    await expectAccessible(device);
    await deviceContext.close();
  });
});
