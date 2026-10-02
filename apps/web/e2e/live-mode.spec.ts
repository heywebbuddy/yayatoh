import { type Browser, expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { localKeyVault, setKeyVault } from '@yayatoh/platform';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { quietDevice, revokeDevice } from '@yayatoh/testing';
import { continueToPayment, expectAccessible, newUser, signIn } from './helpers.ts';

/**
 * Command Center live mode (M3.3a): the live feed updating as the door scans (filters, pause and
 * resume by keyboard), check-in speed with its table alternative, the duplicate/invalid monitor,
 * capacity gauges, staff presence, a device going offline raising the alert, TV mode through a
 * display link (and its revocation), the door role without revenue, and the viewer read-only.
 * Each test makes its own event happening now (unique per project and run).
 */

const kms = process.env.LOCAL_KMS_KEY;
if (kms) setKeyVault(localKeyVault(kms));

test.afterAll(async () => {
  await closePools();
});

const ORG = 'lakeside-events';
const VIEWER = 'jordan@lakeside.test';

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

const stamp = () => `${test.info().project.name.split('-')[0]}${Date.now()}`;

/** An event happening now with a North gate (holds 2) and a South gate, and `tickets` sold. */
async function liveEvent(page: Page, browser: Browser, prefix: string, tickets: number) {
  const name = `${prefix} ${stamp()}`;
  await signIn(page);
  await page.goto(`/o/${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Time zone').selectOption('America/Chicago');
  await page.getByLabel('Starts', { exact: true }).fill(chicago(-1));
  await page.getByLabel('Ends', { exact: true }).fill(chicago(3));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${ORG}/e/[a-z0-9-]+$`));
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill('Door pass');
  await page.getByLabel('Price (USD)').fill('0');
  await page.getByLabel('Quantity available').fill(String(tickets));
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Door pass' })).toBeVisible();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const email = `live+${stamp()}@example.test`;
  await guest.goto(`/events/${base.split('/').pop()}`);
  await guest.getByLabel('Quantity — Door pass').selectOption(String(tickets));
  await guest.getByLabel('Full name').fill(`Lina ${stamp()}`);
  await guest.getByLabel('Email for your tickets').fill(email);
  await continueToPayment(guest, email);
  await expect(guest).toHaveURL(/\/orders\//);
  const codes = (await guest.locator('.tracking-\\[0\\.2em\\]').allTextContents()).map((c) => c.trim());
  expect(codes).toHaveLength(tickets);
  await guestContext.close();

  await page.goto(`${base}/onsite`);
  const setup = page.getByRole('region', { name: 'Entrances and zones' });
  // Capacity is validated: a whole number from 1, or empty.
  await setup.getByLabel('Name', { exact: true }).fill('North gate');
  await setup.getByLabel('Type').selectOption({ label: 'Entrance' });
  await setup.getByLabel('Capacity (optional)').fill('0');
  await setup.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(setup.getByText('Enter a whole number from 1 to 1,000,000, or leave it empty.')).toBeVisible();
  // The form starts over after a refusal (as with a bad location).
  await setup.getByLabel('Name', { exact: true }).fill('North gate');
  await setup.getByLabel('Capacity (optional)').fill('2');
  await setup.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(setup.getByRole('listitem').filter({ hasText: 'North gate' })).toContainText('holds 2');
  await setup.getByLabel('Name', { exact: true }).fill('South gate');
  await setup.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(setup.getByRole('listitem').filter({ hasText: 'South gate' })).toBeVisible();
  return { base, slug: base.split('/').pop() as string, name, codes };
}

/** A door screen in its own browser (signed in as `email`), standing at `gate`. */
async function doorScreen(browser: Browser, base: string, gate: string, email?: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  await page.goto(`${base}/onsite`);
  await page.getByLabel('Scanning at').selectOption({ label: gate });
  return { context, page };
}

async function scan(door: Page, code: string) {
  const field = door.getByLabel('Ticket code');
  await field.fill(code);
  await field.press('Enter');
  await expect(door.getByRole('status').filter({ has: door.locator('[data-result]') })).toBeVisible();
  // The next scan starts from a fresh field.
  await expect(field).toHaveValue('');
}

async function openCommandCenter(page: Page, base: string) {
  await page.goto(`${base}/command-center`);
  await expect(page.getByRole('heading', { level: 1, name: 'Command Center' })).toBeVisible();
  await expect(page.getByTestId('command-center')).toHaveAttribute('data-mode', 'live');
}

/** The feed's scan and device entries (the shared org's alerts for the event show there too). */
const feed = (page: Page) => page.getByTestId('cc-feed').locator('li:not([data-kind="alert"])');
const shown = (page: Page) =>
  page
    .getByTestId('command-center')
    .locator('[data-testid^="cc-widget-"]')
    .evaluateAll((els) => els.map((e) => (e.getAttribute('data-testid') ?? '').replace('cc-widget-', '')));

test.describe('Command Center live mode (M3.3a)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('the live feed follows the door; filters, pause and resume by keyboard; speed, issues, capacity, presence; Arabic RTL', async ({
    page,
    browser,
  }) => {
    const { base, codes } = await liveEvent(page, browser, 'Live feed', 4);
    await openCommandCenter(page, base);
    expect(await shown(page)).toEqual([
      'checkins',
      'alerts',
      'liveFeed',
      'checkinSpeed',
      'capacity',
      'scanIssues',
      'devices',
      'deviceBoard',
      'staffPresence',
      'assistance',
      'seatFill',
      'sales',
      'tickets',
      'timeline',
    ]);
    await expect(page.getByTestId('cc-live')).toHaveAttribute('data-live', 'live', { timeout: 15_000 });
    const feedWidget = page.getByTestId('cc-widget-liveFeed');
    // No scans yet (alerts about the event may already be listed); a filter shows its empty state.
    await expect(feed(page)).toHaveCount(0);
    await feedWidget.getByLabel('Outcome').selectOption('reentry');
    await expect(feedWidget).toContainText('Nothing matches these filters yet.');
    await feedWidget.getByLabel('Outcome').selectOption('');
    // Setting up the entrances on the door screen counted as being at the doors (the whole event).
    await expect(page.getByTestId('cc-presence')).toContainText('On the door screen · Whole event');
    // M3.3b's help queue fills the assistance slot (batch 3g merge): none open yet.
    await expect(page.getByTestId('cc-widget-assistance')).toContainText('No open help requests.');
    await expectAccessible(page);

    // The door scans at the north gate: the feed updates without a reload.
    const door = await doorScreen(browser, base, 'North gate');
    await scan(door.page, codes[0] as string);
    await expect(feed(page).first()).toContainText('Checked in', { timeout: 10_000 });
    await expect(feed(page).first()).toContainText('North gate');
    await scan(door.page, codes[0] as string);
    await expect(feed(page).first()).toContainText('Duplicate: already checked in', { timeout: 10_000 });
    await scan(door.page, 'NOTACODE1');
    await expect(feed(page).first()).toContainText('Refused: not a valid code', { timeout: 10_000 });
    await expect(feed(page)).toHaveCount(3);

    // Speed, the duplicate/invalid monitor and the north gate's gauge follow too.
    await expect(page.getByTestId('cc-issues-summary')).toHaveText('Today: 1 duplicate, 1 refused scan', {
      timeout: 10_000,
    });
    await expect(page.getByTestId('cc-speed-rate')).toHaveText('0.6');
    await expect(
      page.getByTestId('cc-speed-entrances').getByRole('row', { name: /North gate/ }),
    ).toContainText('0.6');
    const north = page.getByTestId('cc-capacity-areas').getByRole('row', { name: /North gate/ });
    await expect(north).toContainText('Below 95%');
    await expect(north.getByRole('cell').nth(0)).toHaveText('1');
    await expect(page.getByTestId('cc-capacity-venue')).toContainText('1 in, of 4');

    // Filter by outcome with the keyboard: only duplicates; then by entrance; then everything.
    const outcome = feedWidget.getByLabel('Outcome');
    await outcome.focus();
    await outcome.selectOption('duplicate');
    await expect(feed(page)).toHaveCount(1);
    await expect(feed(page).first()).toContainText('Duplicate');
    await outcome.selectOption('');
    await feedWidget.getByLabel('Entrance').selectOption({ label: 'South gate' });
    await expect(feedWidget).toContainText('Nothing matches these filters yet.');
    await feedWidget.getByLabel('Entrance').selectOption('');
    await expect(feed(page)).toHaveCount(3);

    // Pause (keyboard): a new scan doesn't move the feed, the status says there's news; resume.
    const pause = page.getByTestId('cc-feed-pause');
    await pause.focus();
    await page.keyboard.press('Enter');
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('cc-feed-state')).toHaveText("Paused. The feed isn't updating.");
    await scan(door.page, codes[1] as string);
    await expect(page.getByTestId('cc-feed-state')).toHaveText(
      "Paused. There's new activity: resume to see it.",
      {
        timeout: 10_000,
      },
    );
    await expect(feed(page)).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Resume' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(feed(page)).toHaveCount(4);
    await expect(page.getByTestId('cc-feed-state')).toHaveText('');

    // The chart's table alternative, by keyboard.
    const toggle = page.getByTestId('cc-widget-checkinSpeed').getByText('Show as a table');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByTestId('cc-widget-checkinSpeed').getByRole('columnheader', { name: 'Checked in' }),
    ).toBeVisible();

    // The duplicate links to its order; the refusal names no ticket.
    const recent = page.getByTestId('cc-issues-recent');
    await expect(recent.getByRole('link', { name: 'Open the order' })).toHaveCount(1);
    await recent.getByRole('link', { name: 'Open the order' }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/orders/[0-9a-f-]{36}$`));

    // Staff presence: the door screen's member is at the north gate (after a reload).
    await openCommandCenter(page, base);
    await expect(page.getByTestId('cc-presence')).toContainText('On the door screen · North gate');
    await expectAccessible(page);

    // Arabic, right to left.
    await page.goto(`/ar${base}/command-center`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('cc-widget-liveFeed')).toContainText('النشاط المباشر');
    await expect(page.getByTestId('cc-widget-checkinSpeed')).toContainText('سرعة تسجيل الدخول');
    await expectAccessible(page);
    await door.context.close();
  });

  test('a device goes offline: the board, the feed and the alert follow live', async ({ page, browser }) => {
    const { base, codes } = await liveEvent(page, browser, 'Live device', 2);
    // Enroll a device from the door screen and let it report in with its app version.
    const label = `Door ${stamp()}`;
    await page.goto(`${base}/onsite`);
    await page.getByLabel('Device name').fill(label);
    await page.getByRole('button', { name: 'Add device' }).click();
    const link = (await page.getByTestId('scan-link').getAttribute('href')) ?? '';
    const token = decodeURIComponent(/k=([^&]+)/.exec(link)?.[1] ?? '');
    const eventId = /e=([0-9a-f-]{36})/.exec(link)?.[1] ?? '';
    const beat = await page.request.post('/api/v1/devices/heartbeat', {
      headers: { authorization: `Bearer ${token}` },
      data: { batteryPct: 64, queueDepth: 3, clockOffsetMs: 0, eventId, appVersion: '2.1.0' },
    });
    expect(beat.status()).toBe(200);
    // It scans one ticket online.
    const scanned = await page.request.post('/api/v1/checkins', {
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': `e2e-${stamp()}-01` },
      data: { eventId, code: codes[0] },
    });
    expect(scanned.status()).toBe(200);

    await openCommandCenter(page, base);
    const board = page.getByTestId('cc-device-board');
    const row = board.getByRole('listitem').filter({ hasText: label });
    await expect(row).toContainText('Online');
    await expect(row).toContainText('app 2.1.0');
    await expect(row).toContainText('last scan');
    await expect(
      page.getByTestId('cc-speed-devices').getByRole('row', { name: new RegExp(label) }),
    ).toBeVisible();
    await expect(feed(page).filter({ hasText: `${label} came online` })).toHaveCount(1);
    await expect(page.getByTestId('cc-live')).toHaveAttribute('data-live', 'live', { timeout: 15_000 });

    // The device stops reporting; 91 s later the watchdog notices (the worker; here the dev drain).
    const org = await resolveOrgSlug(ORG);
    expect(await quietDevice(org?.orgId as string, label, 91)).toBe(1);
    const drained = await page.request.post('/api/dev/outbox/drain', { form: { org: ORG } });
    expect(drained.status()).toBe(200);
    // No reload: the alert, the feed and the board follow over their channels.
    await expect(page.getByTestId('cc-widget-alerts')).toContainText(/check-in devices? (is|are) offline/, {
      timeout: 15_000,
    });
    await expect(feed(page).filter({ hasText: `${label} went offline` })).toHaveCount(1, { timeout: 15_000 });
    await expect(row).toContainText('Offline', { timeout: 15_000 });
    await expectAccessible(page);
    // The alerts page lists it too, critical while the event is live.
    await page.goto(`/o/${ORG}/alerts`);
    await expect(
      page.getByRole('heading', { level: 2, name: /check-in devices? (is|are) offline/ }).first(),
    ).toBeVisible();

    // Revoke the device so the org's other tests don't count it.
    expect(await revokeDevice(org?.orgId as string, label)).toBe(1);
  });

  test('TV mode: a display link opens the read-only board without a session, updates, and stops when turned off', async ({
    page,
    browser,
  }) => {
    const { base, codes } = await liveEvent(page, browser, 'Live TV', 3);
    await openCommandCenter(page, base);
    await page.getByRole('link', { name: 'TV mode' }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/command-center/tv$`));
    await expect(page.getByRole('heading', { level: 1, name: 'TV mode' })).toBeVisible();
    await expect(page.getByText('No screen links yet')).toBeVisible();
    await expectAccessible(page);

    // Keyboard only: an empty name is refused, then a named link is created (shown once).
    const label = page.getByLabel('Screen name');
    await page.getByRole('button', { name: 'Create link' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Give the screen a name (up to 60 characters).')).toBeVisible();
    await label.focus();
    await page.keyboard.type('Lobby screen');
    await page.keyboard.press('Enter');
    const tvLink = page.getByTestId('tv-link');
    await expect(tvLink).toBeVisible();
    const url = (await tvLink.getAttribute('href')) ?? '';
    expect(url).toMatch(/\/tv\/yytv_[A-Za-z0-9_-]{43}$/);
    await expect(page.getByTestId('tv-links')).toContainText('Lobby screen');
    await page.reload();
    await expect(page.getByTestId('tv-link')).toHaveCount(0);

    // The venue screen: no session, large read-only board, no money and no names.
    const screenContext = await browser.newContext();
    const screen = await screenContext.newPage();
    const res = await screen.goto(url);
    expect(res?.headers()['x-robots-tag']).toContain('noindex');
    expect(res?.headers()['content-security-policy']).toContain("style-src-attr 'none'");
    await expect(screen.getByTestId('tv-board')).toBeVisible();
    await expect(screen.getByRole('heading', { level: 1 })).toContainText('Live TV');
    await expect(screen.getByTestId('tv-checkins-today')).toHaveText('0');
    await expect(screen.getByTestId('tv-board')).not.toContainText('$');
    await expect(screen.getByTestId('tv-board')).not.toContainText('Lina');
    await expect(screen.getByRole('button')).toHaveCount(1);
    await expectAccessible(screen);

    // A scan at the door shows on the screen at its next refresh.
    const door = await doorScreen(browser, base, 'North gate');
    await scan(door.page, codes[0] as string);
    await expect(screen.getByTestId('tv-checkins-today')).toHaveText('1', { timeout: 15_000 });
    await expect(screen.getByTestId('tv-entrances')).toContainText('North gate');

    // Arabic, right to left (its own screen: the locale sticks to a browser).
    const arContext = await browser.newContext();
    const ar = await arContext.newPage();
    await ar.goto(url.replace('/tv/', '/ar/tv/'));
    await expect(ar.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(ar.getByText('مباشر من المداخل')).toBeVisible();
    await expectAccessible(ar);
    await arContext.close();

    // Turned off: the screen says so at its next refresh, and so does a reload.
    await page.getByRole('button', { name: 'Turn off Lobby screen' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tv-links')).toContainText('Turned off');
    await expect(screen.getByRole('heading', { name: 'This screen link is off' })).toBeVisible({
      timeout: 15_000,
    });
    await screen.reload();
    await expect(screen.getByRole('heading', { name: 'This screen link is off' })).toBeVisible();
    const token = url.split('/tv/')[1] as string;
    expect((await screen.request.get(`/api/tv/${token}`)).status()).toBe(404);
    expect((await screen.request.get('/api/tv/yytv_bogus')).status()).toBe(404);
    await screenContext.close();
    await door.context.close();
  });

  test('the door layout shows no revenue in live mode; the viewer is read-only', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    const { base, slug, codes } = await liveEvent(page, browser, 'Live door', 2);
    // A team member (viewer) made door staff for this event.
    const doorContext = await browser.newContext();
    const door = await doorContext.newPage();
    const name = `Dana Door ${s}`;
    await newUser(door, { join: [`${ORG}:viewer`], name });
    await page.goto(`${base}/onsite/staff`);
    const add = page.getByRole('region', { name: 'Add door staff' });
    await add.getByLabel('Team member').selectOption({ label: name });
    await add.getByRole('button', { name: 'Add door staff' }).click();
    await expect(add.getByRole('status')).toHaveText('Saved.');
    // The owner scans a ticket twice: a duplicate the door sees without a link into orders.
    const owner = await doorScreen(browser, base, 'South gate');
    await scan(owner.page, codes[0] as string);
    await scan(owner.page, codes[0] as string);

    await openCommandCenter(door, base);
    const cc = door.getByTestId('command-center');
    await expect(cc).toHaveAttribute('data-role', 'door');
    expect(await shown(door)).toEqual([
      'checkins',
      'devices',
      'seatFill',
      'alerts',
      'liveFeed',
      'checkinSpeed',
      'capacity',
      'scanIssues',
      'entrances',
      'deviceBoard',
      'staffPresence',
      'assistance',
      'timeline',
    ]);
    await expect(door.getByTestId('cc-widget-sales')).toHaveCount(0);
    await expect(cc).not.toContainText('$');
    await expect(door.getByTestId('cc-issues-summary')).toHaveText('Today: 1 duplicate, 0 refused scans');
    await expect(door.getByTestId('cc-issues-recent').getByRole('link')).toHaveCount(0);
    await expect(feed(door).first()).toContainText('Duplicate');
    await expectAccessible(door);
    // Directly: live widgets yes, revenue no; the door's issues carry no order ids.
    const issues = await door.request.get(`/api/command-center/${ORG}/${slug}/scanIssues`);
    expect(issues.status()).toBe(200);
    expect(
      (await issues.json()).data.recent.every((r: { orderId: string | null }) => r.orderId === null),
    ).toBe(true);
    expect((await door.request.get(`/api/command-center/${ORG}/${slug}/sales`)).status()).toBe(403);
    const filtered = await door.request.get(`/api/command-center/${ORG}/${slug}/liveFeed?kind=duplicate`);
    expect((await filtered.json()).data.items).toHaveLength(1);
    // The door can see the TV links but can't create or turn them off.
    await door.goto(`${base}/command-center/tv`);
    await expect(door.getByRole('heading', { level: 1, name: 'TV mode' })).toBeVisible();
    await expect(door.getByRole('button', { name: 'Create link' })).toHaveCount(0);
    await expectAccessible(door);

    // The plain viewer: the operations layout, read-only (no mode control, no TV link controls).
    const viewerContext = await browser.newContext();
    const viewer = await viewerContext.newPage();
    await signIn(viewer, VIEWER);
    await openCommandCenter(viewer, base);
    await expect(viewer.getByTestId('command-center')).toHaveAttribute('data-role', 'ops');
    await expect(viewer.getByLabel('Set the mode')).toHaveCount(0);
    await expect(viewer.getByTestId('cc-widget-liveFeed')).toBeVisible();
    await viewer.goto(`${base}/command-center/tv`);
    await expect(viewer.getByRole('button', { name: 'Create link' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /^Turn off/ })).toHaveCount(0);
    await expectAccessible(viewer);
    // A signed-out visitor gets nothing from the widget endpoint.
    const anon = await (await browser.newContext()).newPage();
    expect((await anon.request.get(`/api/command-center/${ORG}/${slug}/liveFeed`)).status()).toBe(401);
    await viewerContext.close();
    await doorContext.close();
    await owner.context.close();
  });
});
