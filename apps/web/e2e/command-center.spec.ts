import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { continueToPayment, expectAccessible, newUser, signIn } from './helpers.ts';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const VIEWER = 'jordan@lakeside.test';

/** `YYYY-MM-DDTHH:mm` wall-clock time in Chicago, `offsetH` hours from now (for datetime-local). */
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

const stamp = () => `${Date.now()}${test.info().project.name.split('-')[0]}`;

/** A Chicago event from `startH` to `endH` hours from now, published, with a free pass (and `n` sold). */
async function newEvent(
  page: Page,
  browser: Browser,
  name: string,
  startH: number,
  endH: number,
  n = 0,
  org = 'lakeside-events',
) {
  await page.goto(`/o/${org}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Time zone').selectOption('America/Chicago');
  await page.getByLabel('Starts', { exact: true }).fill(chicago(startH));
  await page.getByLabel('Ends', { exact: true }).fill(chicago(endH));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${org}/e/[a-z0-9-]+$`));
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill('Door pass');
  await page.getByLabel('Price (USD)').fill('0');
  await page.getByLabel('Quantity available').fill('10');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Door pass' })).toBeVisible();
  let codes: string[] = [];
  if (n > 0) {
    const guestContext = await browser.newContext();
    const guest = await guestContext.newPage();
    const email = `cc+${stamp()}@example.test`;
    await guest.goto(`/events/${base.split('/').pop()}`);
    await guest.getByLabel('Quantity — Door pass').selectOption(String(n));
    await guest.getByLabel('Full name').fill(`Guest ${name}`);
    await guest.getByLabel('Email for your tickets').fill(email);
    await continueToPayment(guest, email);
    await expect(guest).toHaveURL(/\/orders\//);
    codes = (await guest.locator('.tracking-\\[0\\.2em\\]').allTextContents()).map((c) => c.trim());
    expect(codes).toHaveLength(n);
    await guestContext.close();
  }
  return { base, slug: base.split('/').pop() as string, codes };
}

/** The widgets shown, in order. */
const shown = (page: Page) =>
  page
    .getByTestId('command-center')
    .locator('[data-testid^="cc-widget-"]')
    .evaluateAll((els) => els.map((e) => (e.getAttribute('data-testid') ?? '').replace('cc-widget-', '')));

async function openCommandCenter(page: Page, base: string) {
  await page.goto(`${base}/command-center`);
  await expect(page.getByRole('heading', { level: 1, name: 'Command Center' })).toBeVisible();
}

/** Moves the Command Center's clock (dev only) so that "now" is `at`. */
async function setClock(context: BrowserContext, at: number | null) {
  await context.clearCookies({ name: 'yy_dev_clock_offset' });
  if (at !== null)
    await context.addCookies([
      {
        name: 'yy_dev_clock_offset',
        value: String(Math.round(at - Date.now())),
        url: `http://localhost:${PORT}`,
      },
    ]);
}

test.describe('Command Center (M3.2a)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('the owner sees the full planning layout; rearranging by keyboard persists after reload; Arabic RTL', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const { base } = await newEvent(page, browser, `CC Plan ${stamp()}`, 72, 76);
    // From the event's navigation.
    await page.goto(base);
    const nav = page.getByRole('link', { name: 'Command Center', exact: true }).first();
    if (!(await nav.isVisible())) await page.locator('summary').filter({ hasText: 'Open menu' }).click();
    await nav.click();
    await expect(page).toHaveURL(new RegExp(`${base}/command-center$`));
    const cc = page.getByTestId('command-center');
    await expect(cc).toHaveAttribute('data-role', 'owner');
    await expect(cc).toHaveAttribute('data-mode', 'planning');
    await expect(page.getByText('Owner view')).toBeVisible();
    await expect(page.getByTestId('cc-mode')).toHaveText('Planning');
    await expect(page.getByText(/^Pre-show starts /)).toBeVisible();
    // M5.9a: a conference's planning layout adds session fill, exhibitors and sponsors.
    expect(await shown(page)).toEqual([
      'readiness',
      'sales',
      'tickets',
      'alerts',
      'sessionFill',
      'exhibitorActivity',
      'sponsorActivity',
      'timeline',
    ]);
    // Revenue in the org currency, minor units formatted; readiness with deep links to fix it.
    await expect(page.getByTestId('cc-sales-total')).toHaveText('$0.00');
    await expect(page.getByTestId('cc-tickets-sold')).toHaveText('0');
    await expect(page.getByTestId('cc-widget-tickets')).toContainText('of 10');
    const blocking = page.getByTestId('cc-blocking');
    await expect(blocking.getByRole('link', { name: 'Venue added' })).toHaveAttribute(
      'href',
      `${base}/details`,
    );
    await expect(page.getByTestId('cc-widget-alerts')).toContainText('No open alerts.');
    await expect(page.getByTestId('cc-widget-timeline')).toContainText('Pre-show starts');
    await expectAccessible(page);

    // Keyboard only: open customizing, move Tickets up, hide Timeline.
    await page.getByRole('button', { name: 'Customize layout' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Move Tickets sold up' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Layout saved.' })).toHaveText(
      'Tickets sold moved to position 2. Layout saved.',
    );
    // Focus stays on the control that was used.
    await expect(page.getByRole('button', { name: 'Move Tickets sold up' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Layout saved.' })).toHaveText(
      'Tickets sold moved to position 1. Layout saved.',
    );
    await expect(page.getByRole('button', { name: 'Move Tickets sold down' })).toBeFocused();
    await page.getByRole('button', { name: 'Hide Coming up' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Layout saved.' })).toHaveText(
      'Coming up hidden. Layout saved.',
    );
    await expect(page.getByRole('button', { name: 'Show Coming up' })).toBeFocused();
    expect(await shown(page)).toEqual([
      'tickets',
      'readiness',
      'sales',
      'alerts',
      'sessionFill',
      'exhibitorActivity',
      'sponsorActivity',
    ]);
    await expectAccessible(page);

    // Persisted for this member and event.
    await page.reload();
    await expect(page.getByTestId('command-center')).toHaveAttribute('data-mode', 'planning');
    expect(await shown(page)).toEqual([
      'tickets',
      'readiness',
      'sales',
      'alerts',
      'sessionFill',
      'exhibitorActivity',
      'sponsorActivity',
    ]);
    await page.getByRole('button', { name: 'Customize layout' }).click();
    await expect(
      page.getByRole('region', { name: 'Hidden widgets' }).getByRole('button', { name: 'Show Coming up' }),
    ).toBeVisible();

    // Show it again (keyboard), then back to the default.
    await page.getByRole('button', { name: 'Show Coming up' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Coming up shown. Layout saved.')).toBeVisible();
    expect(await shown(page)).toEqual([
      'tickets',
      'readiness',
      'sales',
      'alerts',
      'sessionFill',
      'exhibitorActivity',
      'sponsorActivity',
      'timeline',
    ]);
    await page.getByRole('button', { name: 'Reset to default' }).click();
    await expect(page.getByText('Layout reset to default.')).toBeVisible();
    await page.reload();
    // M5.9a: a conference's planning layout adds session fill, exhibitors and sponsors.
    expect(await shown(page)).toEqual([
      'readiness',
      'sales',
      'tickets',
      'alerts',
      'sessionFill',
      'exhibitorActivity',
      'sponsorActivity',
      'timeline',
    ]);

    // Arabic, right to left.
    await page.goto(`/ar${base}/command-center`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'مركز القيادة' })).toBeVisible();
    await expect(page.getByTestId('cc-mode')).toHaveText('التخطيط');
    await expectAccessible(page);
  });

  test('the door layout shows no revenue, and a direct call to the revenue loader is refused', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    const { base, slug } = await newEvent(page, browser, `CC Door ${s}`, -1, 3, 2);

    // A team member (viewer) made door staff for this event.
    const doorContext = await browser.newContext();
    const door = await doorContext.newPage();
    const name = `Dora Door ${s}`;
    await newUser(door, { join: ['lakeside-events:viewer'], name });
    await page.goto(`${base}/onsite/staff`);
    const add = page.getByRole('region', { name: 'Add door staff' });
    await add.getByLabel('Team member').selectOption({ label: name });
    await add.getByRole('button', { name: 'Add door staff' }).click();
    await expect(add.getByRole('status')).toHaveText('Saved.');

    await openCommandCenter(door, base);
    const cc = door.getByTestId('command-center');
    await expect(cc).toHaveAttribute('data-role', 'door');
    await expect(cc).toHaveAttribute('data-mode', 'live');
    await expect(door.getByText('Door view')).toBeVisible();
    expect(await shown(door)).toEqual([
      'checkins',
      'devices',
      'seatFill',
      'alerts',
      // M5.9a: a conference's session rooms, live.
      'sessionAttendance',
      // M3.3a live mode: the feed, speed, capacity, the duplicate/invalid monitor.
      'liveFeed',
      'checkinSpeed',
      'capacity',
      'scanIssues',
      'entrances',
      'deviceBoard',
      // M3.3a: staff presence; M3.3b's guest-assistance queue.
      'staffPresence',
      'assistance',
      'timeline',
    ]);
    // Batch 3d merge: M3.4a's staff views (live counts per entrance, the device board) for the door.
    await expect(door.getByTestId('cc-entrances-today')).toHaveText('0 of 2 checked in today');
    await expect(door.getByTestId('cc-widget-deviceBoard')).toBeVisible();
    await expect(door.getByTestId('cc-widget-sales')).toHaveCount(0);
    await expect(door.getByText('Sales', { exact: true })).toHaveCount(0);
    await expect(cc).not.toContainText('$');
    // Door staff can't set the mode.
    await expect(door.getByLabel('Set the mode')).toHaveCount(0);
    // Customizing can't bring revenue back.
    await door.getByRole('button', { name: 'Customize layout' }).click();
    await expect(door.getByRole('button', { name: /Show Sales/ })).toHaveCount(0);
    await expectAccessible(door);

    // Direct loader calls: revenue refused for the door, check-ins allowed; the owner gets both.
    const refused = await door.request.get(`/api/command-center/lakeside-events/${slug}/sales`);
    expect(refused.status()).toBe(403);
    expect(await refused.text()).not.toContain('lines');
    expect((await door.request.get(`/api/command-center/lakeside-events/${slug}/checkins`)).status()).toBe(
      200,
    );
    expect((await door.request.get(`/api/command-center/lakeside-events/${slug}/bogus`)).status()).toBe(404);
    const owner = await page.request.get(`/api/command-center/lakeside-events/${slug}/sales`);
    expect(owner.status()).toBe(200);
    expect(await owner.json()).toMatchObject({
      widget: 'sales',
      data: { lines: [{ currency: 'USD', total: 0 }] },
    });
    // Another org's owner and a signed-out visitor get nothing.
    const other = await (await browser.newContext()).newPage();
    await signIn(other, 'maya@rosewood.test');
    expect((await other.request.get(`/api/command-center/lakeside-events/${slug}/sales`)).status()).toBe(404);
    const anon = await (await browser.newContext()).newPage();
    expect((await anon.request.get(`/api/command-center/lakeside-events/${slug}/sales`)).status()).toBe(401);

    // A plain viewer gets the read-only operations layout (no mode control); a scanner has none.
    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await openCommandCenter(viewer, base);
    await expect(viewer.getByTestId('command-center')).toHaveAttribute('data-role', 'ops');
    await expect(viewer.getByLabel('Set the mode')).toHaveCount(0);
    const scanner = await (await browser.newContext()).newPage();
    await newUser(scanner, { join: ['lakeside-events:scanner'] });
    expect((await scanner.request.get(`${base}/command-center`)).status()).toBe(404);
    await scanner.goto('/o/lakeside-events/command-center');
    await expect(scanner.getByText('No Command Center for your role')).toBeVisible();
    await expectAccessible(scanner);

    // Hiding every widget leaves the empty state, with the way back.
    await door.goto(`${base}/command-center`);
    await door.getByRole('button', { name: 'Customize layout' }).click();
    for (const title of [
      'Check-ins',
      'Devices online',
      'Seat fill',
      'Alerts',
      'Session rooms',
      'Live feed',
      'Check-in speed',
      'Capacity',
      'Duplicates and refused scans',
      'Entrances',
      'Device board',
      'Staff at the doors',
      'Guest assistance',
      'Coming up',
    ]) {
      await door.getByRole('button', { name: `Hide ${title}` }).click();
      await expect(door.getByText(`${title} hidden. Layout saved.`)).toBeVisible();
    }
    await expect(door.getByText('No widgets shown')).toBeVisible();
    await expectAccessible(door);
    await door.reload();
    await expect(door.getByText('No widgets shown')).toBeVisible();

    // Arabic for the door layout.
    await door.goto(`/ar${base}/command-center`);
    await expect(door.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(door.getByText('عرض البوابة')).toBeVisible();
    await expect(door.getByText('لا توجد أدوات ظاهرة')).toBeVisible();
    await expectAccessible(door);
    await doorContext.close();
  });

  test('the mode follows a mocked clock, and a manual mode wins until cleared (org overview too)', async ({
    page,
    browser,
    context,
  }) => {
    const name = `CC Clock ${stamp()}`;
    // A fresh org, so its overview lists only this test's events.
    const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const org = owner.orgSlug as string;
    const { base } = await newEvent(page, browser, name, 30, 34, 0, org);
    await openCommandCenter(page, base);
    await expect(page.getByTestId('cc-mode')).toHaveText('Planning');
    const panel = page.locator('[data-next-change]');
    const preShowAt = Date.parse((await panel.getAttribute('data-next-change')) ?? '');
    expect(preShowAt).toBeGreaterThan(Date.now());

    // Four seconds before the pre-show: still planning, then the page moves on by itself.
    await setClock(context, preShowAt - 4_000);
    await page.reload();
    await expect(page.getByTestId('cc-mode')).toHaveText('Planning');
    await expect(page.getByTestId('command-center')).toHaveAttribute('data-mode', 'pre_show', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('cc-mode')).toHaveText('Pre-show');
    await expect(page.getByText(/^Live mode starts /)).toBeVisible();

    // An hour after the start: live, check-ins first. Three hours after the end: wrap-up.
    const startsAt = preShowAt + 24 * 3_600_000;
    await setClock(context, startsAt + 3_600_000);
    await page.reload();
    await expect(page.getByTestId('cc-mode')).toHaveText('Live');
    expect((await shown(page))[0]).toBe('checkins');
    await expectAccessible(page);
    await setClock(context, startsAt + 7 * 3_600_000);
    await page.reload();
    await expect(page.getByTestId('cc-mode')).toHaveText('Wrap-up');
    expect((await shown(page))[0]).toBe('sales');

    // Back to the real clock; set the mode by hand, keyboard only.
    await setClock(context, null);
    await page.reload();
    await expect(page.getByTestId('cc-mode')).toHaveText('Planning');
    const select = page.getByLabel('Set the mode');
    await expect(select.locator('option:checked')).toHaveText('Automatic (Planning)');
    await select.focus();
    await select.selectOption('live');
    await page.getByRole('button', { name: 'Set mode' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Mode updated.')).toBeVisible();
    await expect(page.getByTestId('cc-mode')).toHaveText('Live');
    await expect(page.getByText('Set by hand. Automatic would be: Planning.')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('cc-mode')).toHaveText('Live');
    await expectAccessible(page);

    // The org overview lists it as live, set by hand; it links to its Command Center.
    await page.goto(`/o/${org}/command-center`);
    await expect(page.getByRole('heading', { level: 1, name: 'Command Center' })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row.getByTestId('cc-overview-mode')).toContainText('Live');
    await expect(row).toContainText('Set by hand');
    await expectAccessible(page);
    await page.getByRole('row').filter({ hasText: name }).getByRole('link', { name }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/command-center$`));

    // Back to automatic.
    await page.getByLabel('Set the mode').selectOption('auto');
    await page.getByRole('button', { name: 'Set mode' }).click();
    await expect(page.getByText('Mode updated.')).toBeVisible();
    await expect(page.getByTestId('cc-mode')).toHaveText('Planning');
    await expect(page.getByText(/^Set by hand/)).toHaveCount(0);

    // The overview in Arabic, right to left.
    await page.goto(`/ar/o/${org}/command-center`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'مركز القيادة' })).toBeVisible();
    await expectAccessible(page);
  });

  test('the live check-in count updates when a ticket is scanned', async ({ page, browser }) => {
    await signIn(page);
    const { base, codes } = await newEvent(page, browser, `CC Live ${stamp()}`, -1, 3, 2);
    await openCommandCenter(page, base);
    await expect(page.getByTestId('command-center')).toHaveAttribute('data-mode', 'live');
    await expect(page.getByTestId('cc-live')).toHaveAttribute('data-live', 'live', { timeout: 15_000 });
    await expect(page.getByText('Live updates on')).toBeVisible();
    await expect(page.getByTestId('cc-checkins-today')).toHaveText('0');
    await expect(page.getByTestId('cc-checkins-total')).toHaveText('0 of 2 tickets checked in');

    // Another browser at the door scans one ticket.
    const doorContext = await browser.newContext();
    const door = await doorContext.newPage();
    await signIn(door);
    await door.goto(`${base}/onsite`);
    const field = door.getByLabel('Ticket code');
    await field.fill(codes[0] as string);
    await field.press('Enter');
    await expect(door.getByRole('status').filter({ has: door.locator('[data-result]') })).toContainText(
      'Welcome in',
    );

    // No reload: the widget re-reads over the check-in channel.
    await expect(page.getByTestId('cc-checkins-today')).toHaveText('1', { timeout: 10_000 });
    await expect(page.getByTestId('cc-checkins-total')).toHaveText('1 of 2 tickets checked in');
    await expectAccessible(page);
    await doorContext.close();
  });
});
