import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { decryptPayload } from '@yayatoh/notifications';
import {
  ageSession,
  confirmStepUp,
  continueToPayment,
  expectAccessible,
  expectPicked,
  newUser,
  personaCode,
  pickOption,
  signIn,
} from './helpers.ts';

/**
 * Staff mode in the Scan PWA (M3.4a): live counts, the device board and alerts; offline with
 * "last updated" and a queue that syncs exactly once; supervisor mode (move, sync, revoke with
 * step-up); kiosk mode with a PIN exit; staff web push; viewers denied. Each test makes its own
 * event happening now (unique per project and run), with two entrances.
 */

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

interface Setup {
  readonly base: string;
  readonly name: string;
  readonly codes: string[];
}

/** An event happening now with North and South gates and `tickets` bought by one guest. */
async function eventNow(
  page: Page,
  browser: Browser,
  prefix: string,
  tickets: number,
  /** An org whose owner is already signed in on `page` (default: the seeded Lakeside owner). */
  org?: string,
): Promise<Setup> {
  const name = `${prefix} ${stamp()}`;
  if (!org) await signIn(page);
  const slug = org ?? 'lakeside-events';
  await page.goto(`/o/${slug}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await pickOption(page.getByLabel('Time zone'), 'America/Chicago');
  await page.getByLabel('Starts', { exact: true }).fill(chicago(-1));
  await page.getByLabel('Ends', { exact: true }).fill(chicago(3));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${slug}/e/[a-z0-9-]+$`));
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
  const email = `staff+${stamp()}@example.test`;
  await guest.goto(`/events/${base.split('/').pop()}`);
  await pickOption(guest.getByLabel('Quantity — Door pass'), String(tickets));
  await guest.getByLabel('Full name').fill(`Stella ${stamp()}`);
  await guest.getByLabel('Email for your tickets').fill(email);
  await continueToPayment(guest, email);
  await expect(guest).toHaveURL(/\/orders\//);
  const codes = (await guest.locator('.tracking-\\[0\\.2em\\]').allTextContents()).map((c) => c.trim());
  expect(codes).toHaveLength(tickets);
  await guestContext.close();

  await page.goto(`${base}/onsite`);
  const setup = page.getByRole('region', { name: 'Entrances and zones' });
  for (const gate of ['North gate', 'South gate']) {
    await setup.getByLabel('Name', { exact: true }).fill(gate);
    await pickOption(setup.getByLabel('Type'), { label: 'Entrance' });
    await setup.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(setup.getByRole('listitem').filter({ hasText: gate })).toBeVisible();
  }
  return { base, name, codes };
}

/** Enroll a device from the door screen; returns its setup link. */
async function addDevice(page: Page, base: string, label: string): Promise<string> {
  await page.goto(`${base}/onsite`);
  await page.getByLabel('Device name').fill(label);
  await page.getByRole('button', { name: 'Add device' }).click();
  const link = await page.getByTestId('scan-link').getAttribute('href');
  expect(link).toMatch(/\/scan#e=[0-9a-f-]{36}&k=yyd_/);
  return link ?? '';
}

/** A device: its own browser context (no session), set up from its link. */
async function openDevice(browser: Browser, link: string, eventName: string, context?: BrowserContext) {
  const ctx = context ?? (await browser.newContext());
  const device = await ctx.newPage();
  await device.goto(link);
  await expect(device.getByRole('heading', { name: eventName })).toBeVisible();
  return { context: ctx, page: device };
}

const scanField = (p: Page) => p.getByLabel('Ticket code');
const resultPanel = (p: Page) => p.getByRole('status').filter({ has: p.locator('[data-result]') });
async function scan(p: Page, code: string) {
  await scanField(p).fill(code);
  await scanField(p).press('Enter');
}
const view = (p: Page, name: 'Scan' | 'Staff' | 'Supervisor') =>
  p.getByRole('navigation', { name: 'Scanner mode' }).getByRole('button', { name, exact: true });

/** Feedback times measured by the PWA (`yy-scan-feedback`), in ms. */
const feedbackTimes = (p: Page) =>
  p.evaluate(() => performance.getEntriesByName('yy-scan-feedback').map((e) => e.duration));

test.describe('Scan PWA staff mode (M3.4a)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('staff mode: counts update live over the realtime channel, the device board, alerts; keyboard; Arabic RTL', async ({
    page,
    browser,
  }) => {
    const ev = await eventNow(page, browser, 'Staff live', 3);
    const watcher = await openDevice(browser, await addDevice(page, ev.base, 'Watcher'), ev.name);
    const gate = await openDevice(browser, await addDevice(page, ev.base, 'Gate phone'), ev.name);

    // Keyboard only: the mode buttons are real buttons in a labelled navigation.
    const staffButton = view(watcher.page, 'Staff');
    await staffButton.focus();
    await watcher.page.keyboard.press('Enter');
    await expect(staffButton).toHaveAttribute('aria-pressed', 'true');
    const counts = watcher.page.getByTestId('staff-checked-in');
    await expect(counts).toHaveText('0 of 3 checked in today');
    await expect(watcher.page.getByText('No alerts right now.')).toBeVisible();
    const board = watcher.page.getByRole('list', { name: 'Devices at this event' });
    await expect(board.getByRole('listitem').filter({ hasText: 'Watcher · this device' })).toContainText(
      'Online',
    );
    await expect(board.getByRole('listitem').filter({ hasText: 'Gate phone' })).toContainText('Online');
    await expect(watcher.page.getByTestId('staff-updated')).toContainText('Last updated');
    await expectAccessible(watcher.page);

    // The gate scans at North gate: the watcher's counts follow without a reload.
    await pickOption(gate.page.getByLabel('Scanning at'), { label: 'North gate' });
    await scan(gate.page, ev.codes[0] as string);
    await expect(resultPanel(gate.page)).toContainText('Confirmed by the server');
    await expect(counts).toHaveText('1 of 3 checked in today', { timeout: 10_000 });
    const byEntrance = watcher.page.getByRole('list', { name: 'By entrance' });
    await expect(byEntrance.getByRole('listitem').filter({ hasText: 'North gate' })).toContainText('1');
    await expect(watcher.page.getByRole('list', { name: 'By date' }).getByRole('listitem')).toHaveCount(1);
    await expect(board.getByRole('listitem').filter({ hasText: 'Gate phone' })).toContainText('North gate');

    // Arabic: the same screen right to left.
    await watcher.page.goto('/ar/scan');
    await expect(watcher.page.locator('html')).toHaveAttribute('dir', 'rtl');
    await watcher.page.getByRole('navigation').getByRole('button').nth(1).click();
    await expect(watcher.page.getByTestId('staff-checked-in')).toContainText('1');
    await expectAccessible(watcher.page);
    await watcher.context.close();
    await gate.context.close();
  });

  test('offline: staff mode shows the last update; scans queue with feedback under 300 ms and sync exactly once', async ({
    page,
    browser,
  }) => {
    const ev = await eventNow(page, browser, 'Staff offline', 4);
    const d = await openDevice(browser, await addDevice(page, ev.base, 'Offline phone'), ev.name);
    await view(d.page, 'Staff').click();
    await expect(d.page.getByTestId('staff-checked-in')).toHaveText('0 of 4 checked in today');
    await expect(d.page.getByTestId('staff-updated')).toContainText('Live');

    await d.context.setOffline(true);
    await d.page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(d.page.getByTestId('staff-updated')).toContainText('Offline — showing the last update');
    await expect(d.page.getByTestId('staff-updated')).toContainText('Last updated');
    await expect(d.page.getByTestId('staff-checked-in')).toHaveText('0 of 4 checked in today');
    await expectAccessible(d.page);

    await view(d.page, 'Scan').click();
    for (const code of ev.codes.slice(0, 3)) {
      await scan(d.page, code);
      await expect(resultPanel(d.page)).toContainText('will be confirmed when synced');
    }
    await expect(d.page.getByTestId('scan-queue')).toHaveText('3 scans waiting to sync');
    await scan(d.page, ev.codes[0] as string);
    await expect(resultPanel(d.page)).toContainText('Already checked in');
    await expect(d.page.getByTestId('scan-queue')).toHaveText('4 scans waiting to sync');
    // Feedback from the local verdict: every scan under 300 ms (the real-device check is the drill).
    // The measure is taken on the frame after the verdict is painted: wait for the fourth.
    await expect.poll(async () => (await feedbackTimes(d.page)).length).toBeGreaterThanOrEqual(4);
    const times = await feedbackTimes(d.page);
    for (const ms of times) expect(ms).toBeLessThan(300);

    // Back online: the queue drains; asking again (online events racing) sends nothing twice.
    await d.context.setOffline(false);
    await d.page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('online'));
    });
    await expect(d.page.getByTestId('scan-queue')).toHaveText('All scans synced', { timeout: 15_000 });
    await d.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await view(d.page, 'Staff').click();
    await expect(d.page.getByTestId('staff-checked-in')).toHaveText('3 of 4 checked in today', {
      timeout: 15_000,
    });
    await page.goto(`${ev.base}/onsite`);
    await expect(page.getByText('3 of 4 tickets checked in today')).toBeVisible();
    await d.context.close();
  });

  test('supervisor mode: move a device, force a sync, revoke with step-up (keyboard); the device follows at once', async ({
    page,
    browser,
  }) => {
    const ev = await eventNow(page, browser, 'Supervise', 2);
    const side = `Side door ${stamp()}`;
    const phoneLink = await addDevice(page, ev.base, 'Boss phone');
    const gate = await openDevice(browser, await addDevice(page, ev.base, side), ev.name);
    // The supervisor's own phone: a device, plus the owner signed in on it.
    const phone = await openDevice(browser, phoneLink, ev.name);
    await view(phone.page, 'Supervisor').click();
    await expect(
      phone.page.getByText('Supervisor mode needs a supervisor signed in on this phone.'),
    ).toBeVisible();
    await expect(phone.page.getByRole('link', { name: 'Sign in as a supervisor' })).toHaveAttribute(
      'href',
      /\/sign-in\?next=%2Fscan$/,
    );
    await signIn(phone.page);
    await phone.page.goto('/scan');
    await view(phone.page, 'Supervisor').click();
    const card = phone.page
      .getByRole('listitem')
      .filter({ has: phone.page.getByRole('heading', { name: side }) });
    await expect(card).toContainText('Online');
    await expectAccessible(phone.page);

    // Move by keyboard: select the gate, then the Move button.
    await pickOption(card.getByLabel(`Move ${side} to`), { label: 'South gate' });
    await card.getByRole('button', { name: 'Move', exact: true }).focus();
    await phone.page.keyboard.press('Enter');
    await expect(phone.page.getByTestId('supervisor-message')).toHaveText(`${side} will scan at South gate.`);
    await expect(gate.page.getByTestId('scan-notice')).toHaveText(
      'A supervisor moved this device to South gate.',
      {
        timeout: 15_000,
      },
    );
    await expectPicked(gate.page.getByLabel('Scanning at'), /[0-9a-f-]{36}/);

    await card.getByRole('button', { name: 'Sync now' }).click();
    await expect(phone.page.getByTestId('supervisor-message')).toHaveText(`Sync requested for ${side}.`);
    await expect(gate.page.getByTestId('scan-notice')).toHaveText(
      'A supervisor asked for a sync: this device is up to date.',
      { timeout: 15_000 },
    );

    // Revoke asks for confirmation, then step-up (the session is old); the device wipes itself.
    await ageSession(phone.page);
    await card.getByRole('button', { name: 'Revoke' }).click();
    await expect(card).toContainText(`Revoke ${side}? Its key stops working at once`);
    await card.getByRole('button', { name: 'Yes, revoke' }).click();
    await confirmStepUp(phone.page, personaCode());
    await expect(phone.page.getByTestId('supervisor-message')).toHaveText(`${side} was revoked.`);
    await expect(gate.page.getByRole('heading', { name: 'This scanner was wiped' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(phone.page.getByRole('heading', { name: side })).toHaveCount(0);
    // Its key no longer opens the staff screen.
    const api = await gate.page.request.get('/api/scan/staff?eventId=00000000-0000-0000-0000-000000000000', {
      headers: { authorization: `Bearer yyd_${'x'.repeat(43)}` },
    });
    expect(api.status()).toBe(401);
    await phone.context.close();
    await gate.context.close();
  });

  test('kiosk mode: started by a supervisor, self check-in with large targets, works offline, PIN to exit; Arabic', async ({
    page,
    browser,
  }) => {
    const ev = await eventNow(page, browser, 'Kiosk', 3);
    const lobby = `Lobby kiosk ${stamp()}`;
    const phoneLink = await addDevice(page, ev.base, 'Host phone');
    const kiosk = await openDevice(browser, await addDevice(page, ev.base, lobby), ev.name);
    const phone = await openDevice(browser, phoneLink, ev.name);
    await signIn(phone.page);
    await phone.page.goto('/scan');
    await view(phone.page, 'Supervisor').click();
    const card = phone.page
      .getByRole('listitem')
      .filter({ has: phone.page.getByRole('heading', { name: lobby }) });
    await pickOption(card.getByLabel(`Kiosk entrance for ${lobby}`), { label: 'North gate' });
    await card.getByLabel(`Kiosk PIN for ${lobby}`).fill('12');
    await card.getByRole('button', { name: 'Start kiosk' }).click();
    await expect(card.getByText('Enter a PIN of 4 to 8 digits.')).toBeVisible();
    await expect(card.getByLabel(`Kiosk PIN for ${lobby}`)).toHaveAttribute('aria-invalid', 'true');
    await card.getByLabel(`Kiosk PIN for ${lobby}`).fill('2468');
    await card.getByRole('button', { name: 'Start kiosk' }).click();
    await expect(phone.page.getByTestId('supervisor-message')).toHaveText(`${lobby} is now a kiosk.`);

    // The kiosk switches over by itself.
    const k = kiosk.page;
    await expect(k.getByRole('heading', { name: `Welcome to ${ev.name}` })).toBeVisible({ timeout: 15_000 });
    await expect(k.getByText('North gate', { exact: true })).toBeVisible();
    await expect(k.getByRole('navigation', { name: 'Scanner mode' })).toHaveCount(0);
    const field = k.getByLabel('Scan your ticket or type its code');
    await expect(field).toBeFocused();
    const box = await k.getByRole('button', { name: 'Check in' }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    await expectAccessible(k);
    await field.fill(ev.codes[0] as string);
    await field.press('Enter');
    const result = k.locator('[data-kiosk-result]');
    await expect(result).toHaveText(/You're checked in\. Enjoy!/);
    await field.fill(ev.codes[0] as string);
    await field.press('Enter');
    await expect(result).toHaveText(/This ticket is already checked in\./);
    await field.fill('NOTACODE');
    await field.press('Enter');
    await expect(result).toHaveText(/Please see a member of staff\./);

    // Arabic kiosk.
    await k.goto('/ar/scan');
    await expect(k.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(k.locator('[data-kiosk]')).toBeVisible();
    await expectAccessible(k);
    await k.goto('/scan');

    // Offline: still checks in from the offline snapshot.
    await kiosk.context.setOffline(true);
    const f2 = k.getByLabel('Scan your ticket or type its code');
    await f2.fill(ev.codes[1] as string);
    await f2.press('Enter');
    await expect(k.locator('[data-kiosk-result]')).toHaveText(/You're checked in\. Enjoy!/);

    // Staff exit by keyboard: a wrong PIN is refused, the right one unlocks (offline too).
    await k.getByRole('button', { name: 'Staff: exit kiosk' }).focus();
    await k.keyboard.press('Enter');
    const pin = k.getByLabel('Staff PIN');
    await expect(pin).toBeFocused();
    await pin.fill('1111');
    await k.keyboard.press('Enter');
    await expect(k.locator('#kiosk-pin-error')).toHaveText('Wrong PIN. 4 tries left.');
    await expect(pin).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(k);
    await pin.fill('2468');
    await k.keyboard.press('Enter');
    await expect(k.getByRole('navigation', { name: 'Scanner mode' })).toBeVisible();
    await expect(k.getByTestId('scan-queue')).toHaveText('1 scan waiting to sync');
    await kiosk.context.setOffline(false);
    await k.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(k.getByTestId('scan-queue')).toHaveText('All scans synced', { timeout: 15_000 });
    // The exit reached the server: the supervisor sees a scanner again.
    await phone.page.reload();
    await view(phone.page, 'Supervisor').click();
    await expect(
      phone.page.getByRole('listitem').filter({ has: phone.page.getByRole('heading', { name: lobby }) }),
    ).toContainText('Start kiosk', { timeout: 15_000 });
    await kiosk.context.close();
    await phone.context.close();
  });

  test('a viewer is denied supervisor mode; the device key alone opens nothing else', async ({
    page,
    browser,
  }) => {
    const ev = await eventNow(page, browser, 'Denied', 1);
    const d = await openDevice(browser, await addDevice(page, ev.base, 'Viewer phone'), ev.name);
    await signIn(d.page, 'jordan@lakeside.test');
    await d.page.goto('/scan');
    await view(d.page, 'Supervisor').click();
    await expect(d.page.getByTestId('supervisor-denied')).toHaveText(
      "Your role can't supervise this event's devices. Ask an organizer.",
    );
    await expect(d.page.getByRole('button', { name: 'Sync now' })).toHaveCount(0);
    await expect(d.page.getByRole('button', { name: 'Revoke' })).toHaveCount(0);
    await expectAccessible(d.page);
    // Staff routes need the device key (no key, a forged one: 401).
    expect((await d.page.request.get(`/api/scan/staff?eventId=${randomUUID()}`)).status()).toBe(401);
    expect(
      (
        await d.page.request.post('/api/scan/kiosk/exit', {
          headers: { authorization: `Bearer yyd_${'y'.repeat(43)}` },
          data: { startedAt: new Date().toISOString() },
        })
      ).status(),
    ).toBe(401);
    await d.context.close();
  });

  test('staff web push: opt in on the device; a near-capacity alert arrives in its language', async ({
    page,
    browser,
  }) => {
    // Its own org (batch 3d merge): the drain below then sends only this org's messages. In the
    // shared Lakeside org it also dispatched the whole suite's backlog (alert emails for every
    // upcoming e2e event since M3.2b), which outran the test's time under a full run.
    const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const org = owner.orgSlug as string;
    const ev = await eventNow(page, browser, 'Staff push', 1, org);
    const link = await addDevice(page, ev.base, 'Alert phone');
    const fake = fakeBrowser();
    const context = await pushContext(browser, fake);
    const d = await openDevice(browser, link, ev.name, context);
    await view(d.page, 'Staff').click();
    await expect(d.page.getByTestId('staff-push-status')).toHaveText('Alerts are off for this device.');
    await d.page.getByRole('button', { name: 'Turn on alerts' }).click();
    await expect(d.page.getByRole('status').filter({ hasText: 'Alerts turned on.' })).toBeVisible();
    await expect(d.page.getByTestId('staff-push-status')).toHaveText('Alerts are on for this device.');
    // Everyone expected is in: capacity near → a push to this device, once.
    await view(d.page, 'Scan').click();
    await scan(d.page, ev.codes[0] as string);
    await expect(resultPanel(d.page)).toContainText('Confirmed by the server');
    await view(d.page, 'Staff').click();
    await expect(d.page.locator('[data-alert="capacity_near"]')).toHaveText(
      'Nearly full: 100% of expected guests are in',
    );
    const drain = async () =>
      expect((await page.request.post('/api/dev/outbox/drain', { form: { org } })).ok()).toBe(true);
    await drain();
    await expect.poll(async () => (await received(page, fake)).length, { timeout: 15_000 }).toBe(1);
    await drain();
    const got = await received(page, fake);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      title: 'Nearly full',
      body: '100% of expected guests are in.',
      lang: 'en',
    });
    await d.page.getByRole('button', { name: 'Turn off alerts' }).click();
    await expect(d.page.getByTestId('staff-push-status')).toHaveText('Alerts are off for this device.');
    await context.close();
  });
});

// --- Fake push service (see web-push.spec.ts) ----------------------------------------------------

interface FakeBrowser {
  readonly id: string;
  readonly privateKey: string;
  readonly p256dh: string;
  readonly auth: string;
}

function fakeBrowser(): FakeBrowser {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    id: `e2e${randomUUID().replace(/-/g, '')}`,
    privateKey: ecdh.getPrivateKey().toString('base64url'),
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}

/** A context whose PushManager hands out a subscription on the dev fake push service. */
async function pushContext(browser: Browser, fake: FakeBrowser) {
  const context = await browser.newContext({ permissions: ['notifications'] });
  await context.addInitScript(
    ({ id, p256dh, auth }) => {
      if (!('PushManager' in window)) return;
      const endpoint = `${location.origin}/api/dev/push-service/${id}`;
      const KEY = 'e2e-fake-staff-push';
      const make = () => ({
        endpoint,
        expirationTime: null,
        options: { userVisibleOnly: true },
        getKey: () => null,
        toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh, auth } }),
        unsubscribe: async () => {
          localStorage.removeItem(KEY);
          return true;
        },
      });
      PushManager.prototype.subscribe = async function subscribe() {
        localStorage.setItem(KEY, '1');
        return make() as unknown as PushSubscription;
      };
      PushManager.prototype.getSubscription = async function getSubscription() {
        return localStorage.getItem(KEY) ? (make() as unknown as PushSubscription) : null;
      };
    },
    { id: fake.id, p256dh: fake.p256dh, auth: fake.auth },
  );
  return context;
}

async function received(
  page: Page,
  fake: FakeBrowser,
): Promise<{ title: string; body: string; lang: string }[]> {
  const res = await page.request.get(`/api/dev/push-service/${fake.id}`);
  expect(res.ok()).toBe(true);
  const entries = (await res.json()) as { body: string }[];
  return entries.map(
    (e) =>
      JSON.parse(
        decryptPayload({
          body: Buffer.from(e.body, 'base64url'),
          uaPrivateKey: fake.privateKey,
          auth: fake.auth,
        }).toString('utf8'),
      ) as { title: string; body: string; lang: string },
  );
}
