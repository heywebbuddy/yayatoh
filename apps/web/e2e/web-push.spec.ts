import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { decryptPayload } from '@yayatoh/notifications';
import { continueToPayment, expectAccessible, newUser, OPEN_HOUSE, pickOption, signIn } from './helpers.ts';

/**
 * Web push (M1.10e). Headless Chromium has no connection to a real push service, so the page's
 * `PushManager.subscribe` is replaced by one that returns a subscription whose endpoint is the dev
 * fake push service on this origin, with keys generated here. Everything after that is real: the
 * service worker registration, the permission, our server actions, the dispatcher, RFC 8291
 * encryption and the VAPID signature (the fake service checks it). The test decrypts what the fake
 * service received with the browser's private key.
 */
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

/** A browser context whose PushManager hands out the fake subscription. */
async function pushContext(
  browser: { newContext: (o?: object) => Promise<BrowserContext> },
  fake: FakeBrowser,
  opts: { grant?: boolean } = {},
) {
  const context = await browser.newContext(opts.grant === false ? {} : { permissions: ['notifications'] });
  await context.addInitScript(
    ({ id, p256dh, auth }) => {
      if (!('PushManager' in window)) return;
      const endpoint = `${location.origin}/api/dev/push-service/${id}`;
      const KEY = 'e2e-fake-push';
      const make = (serverKey: number[]) => ({
        endpoint,
        expirationTime: null,
        options: { userVisibleOnly: true, applicationServerKey: new Uint8Array(serverKey).buffer },
        getKey: () => null,
        toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh, auth } }),
        unsubscribe: async () => {
          localStorage.removeItem(KEY);
          return true;
        },
      });
      PushManager.prototype.subscribe = async function subscribe(options?: PushSubscriptionOptionsInit) {
        const key = Array.from(new Uint8Array(options?.applicationServerKey as ArrayBuffer));
        localStorage.setItem(KEY, JSON.stringify(key));
        return make(key) as unknown as PushSubscription;
      };
      PushManager.prototype.getSubscription = async function getSubscription() {
        const saved = localStorage.getItem(KEY);
        return saved ? (make(JSON.parse(saved)) as unknown as PushSubscription) : null;
      };
    },
    { id: fake.id, p256dh: fake.p256dh, auth: fake.auth },
  );
  return context;
}

interface Payload {
  title: string;
  body: string;
  url: string | null;
  tag: string;
  lang: string;
  dir: string;
}

/** What the fake push service received for this browser, decrypted as the browser would. */
async function received(
  page: Page,
  fake: FakeBrowser,
): Promise<Array<{ payload: Payload; ttl: string; urgency: string }>> {
  const res = await page.request.get(`/api/dev/push-service/${fake.id}`);
  expect(res.ok()).toBe(true);
  const entries = (await res.json()) as Array<{
    body: string;
    ttl: string;
    urgency: string;
    contentEncoding: string;
  }>;
  return entries.map((e) => {
    expect(e.contentEncoding).toBe('aes128gcm');
    const plain = decryptPayload({
      body: Buffer.from(e.body, 'base64url'),
      uaPrivateKey: fake.privateKey,
      auth: fake.auth,
    });
    return { payload: JSON.parse(plain.toString('utf8')) as Payload, ttl: e.ttl, urgency: e.urgency };
  });
}

async function drain(page: Page, org = 'lakeside-events') {
  const res = await page.request.post('/api/dev/outbox/drain', { form: { org } });
  expect(res.ok()).toBe(true);
}

/** A guest buys one ticket to the open house and lands on their order page. */
async function buyTicket(guest: Page, pass: string, email: string) {
  await guest.goto('/events/lakeside-open-house');
  await pickOption(guest.getByLabel(`Quantity — ${pass}`), '1');
  await guest.getByLabel('Full name').fill(`Pia ${email.split('@')[0]}`);
  await guest.getByLabel('Email for your tickets').fill(email);
  await continueToPayment(guest, email);
  await guest.getByRole('button', { name: /^Pay/ }).click();
  await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);
  return new URL(guest.url()).pathname;
}

/** The organizer sends a push-only announcement for the open house. */
async function announce(page: Page, subject: string, body: string) {
  await page.goto(`${OPEN_HOUSE}/marketing`);
  const composer = page.getByRole('form', { name: 'New announcement' });
  await composer.getByLabel('Subject').fill(subject);
  await composer.getByLabel('Message').fill(body);
  await composer.getByRole('checkbox', { name: 'Email' }).uncheck();
  await composer.getByRole('checkbox', { name: 'Push' }).check();
  await composer.getByRole('button', { name: 'Preview' }).click();
  const preview = page.getByRole('form', { name: 'Announcement preview' });
  await preview.getByRole('button', { name: /^Send to \d+ (person|people)$/ }).click();
  await expect(
    page.getByText(/^Sent to \d+ (person|people)\. Delivery continues in the background\.$/),
  ).toBeVisible();
}

test.describe('web push', () => {
  test('a buyer opts in from the order page, gets an announcement as a push, and turns it off', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const stamp = `${Date.now()}${test.info().project.name.slice(0, 1)}`;
    const pass = `Push pass ${stamp}`;
    await signIn(page);
    await page.goto(`${OPEN_HOUSE}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill(pass);
    await page.getByLabel('Price (USD)').fill('5');
    await page.getByLabel('Quantity available').fill('5');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: pass })).toBeVisible();

    const fake = fakeBrowser();
    const guest = await (await pushContext(browser, fake)).newPage();
    const orderUrl = await buyTicket(guest, pass, `push+${stamp}@example.test`);
    const push = guest.getByRole('region', { name: 'Push notifications' });
    await expect(push.getByText('Notifications are off for this device.')).toBeVisible();
    await expect(push.getByText('No devices get notifications yet.')).toBeVisible();
    await expect(push.getByText(/^Get updates from Lakeside Events about this event/)).toBeVisible();
    await expectAccessible(guest);

    // Keyboard only: focus the button and press Enter.
    const turnOn = push.getByRole('button', { name: 'Turn on notifications', exact: true });
    await turnOn.focus();
    await guest.keyboard.press('Enter');
    await expect(push.getByRole('status')).toHaveText(
      'Notifications are on. Updates will arrive on this device.',
    );
    const devices = push.getByRole('list', { name: 'Your devices' });
    await expect(devices.getByRole('listitem')).toHaveCount(1);
    await expect(devices.getByRole('listitem')).toContainText('Chrome · ');
    await expect(devices.getByRole('listitem')).toContainText('(this device)');
    await expect(push.getByRole('button', { name: 'Turn off on this device', exact: true })).toBeVisible();
    // The service worker is registered for its own scope (it controls no page).
    expect(
      await guest.evaluate(
        async () => (await navigator.serviceWorker.getRegistration('/push/'))?.scope ?? null,
      ),
    ).toMatch(/\/push\/$/);
    await expectAccessible(guest);

    // Persisted: after a reload the device is still on.
    await guest.reload();
    await expect(push.getByText('Notifications are on for this device.')).toBeVisible();
    await expect(devices.getByRole('listitem')).toHaveCount(1);

    // Arabic, right to left.
    await guest.goto(`/ar${orderUrl}`);
    await expect(guest.locator('html')).toHaveAttribute('dir', 'rtl');
    const pushAr = guest.getByRole('region', { name: 'الإشعارات الفورية' });
    await expect(pushAr.getByText('الإشعارات مفعّلة على هذا الجهاز.')).toBeVisible();
    await expect(pushAr.getByRole('button', { name: 'إيقافها على هذا الجهاز' })).toBeVisible();
    await expectAccessible(guest);
    // Visiting /ar remembers Arabic; back to English for the rest.
    await guest.context().clearCookies({ name: 'NEXT_LOCALE' });

    // The organizer announces (push only); the fake push service receives it, encrypted for us.
    const subject = `Gate change ${stamp}`;
    await announce(page, subject, 'Use the north gate tonight.');
    await drain(page);
    let mine: Awaited<ReturnType<typeof received>> = [];
    await expect
      .poll(async () => {
        mine = (await received(page, fake)).filter((r) => r.payload.title === subject);
        return mine.length;
      })
      .toBe(1);
    const [got] = mine;
    expect(got?.payload).toEqual({
      title: subject,
      body: 'Use the north gate tonight.',
      url: expect.stringMatching(/^http:\/\/localhost:\d+\/messages\/[0-9a-f-]{36}~/),
      tag: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/),
      lang: 'en',
      dir: 'ltr',
    });
    expect(got?.ttl).toBe('86400');
    expect(got?.urgency).toBe('normal');
    // A second drain (a duplicated job) sends nothing more.
    await drain(page);
    expect((await received(page, fake)).filter((r) => r.payload.title === subject)).toHaveLength(1);

    // Turn it off on this device: the list empties and the next announcement doesn't arrive.
    await guest.goto(orderUrl);
    await push.getByRole('button', { name: 'Turn off on this device', exact: true }).click();
    await expect(push.getByRole('status')).toHaveText('Notifications are off for this device.');
    await expect(push.getByText('No devices get notifications yet.')).toBeVisible();
    await expect(push.getByRole('button', { name: 'Turn on notifications', exact: true })).toBeVisible();
    await expectAccessible(guest);
    const after = `After off ${stamp}`;
    await announce(page, after, 'You should not see this.');
    await drain(page);
    expect((await received(page, fake)).filter((r) => r.payload.title === after)).toHaveLength(0);
  });

  test('a buyer who blocks notifications is told how to allow them and gets nothing', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const stamp = `${Date.now()}${test.info().project.name.slice(0, 1)}`;
    const pass = `Blocked pass ${stamp}`;
    await signIn(page);
    await page.goto(`${OPEN_HOUSE}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill(pass);
    await page.getByLabel('Price (USD)').fill('5');
    await page.getByLabel('Quantity available').fill('5');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: pass })).toBeVisible();

    const fake = fakeBrowser();
    const context = await pushContext(browser, fake, { grant: false });
    // The person answers "Block" in the browser's prompt (Playwright can't click browser UI).
    await context.addInitScript(() => {
      let answer: NotificationPermission = 'default';
      Object.defineProperty(Notification, 'permission', { get: () => answer });
      Notification.requestPermission = async () => {
        answer = 'denied';
        return answer;
      };
    });
    const guest = await context.newPage();
    await buyTicket(guest, pass, `blocked+${stamp}@example.test`);
    const push = guest.getByRole('region', { name: 'Push notifications' });
    await push.getByRole('button', { name: 'Turn on notifications', exact: true }).click();
    await expect(push.getByRole('alert')).toContainText(
      "Notifications are blocked for this site. Allow them in your browser's site settings",
    );
    await expect(push.getByText('No devices get notifications yet.')).toBeVisible();
    await expectAccessible(guest);

    const subject = `Not for you ${stamp}`;
    await announce(page, subject, 'Only opted-in people get this.');
    await drain(page);
    expect(await received(page, fake)).toHaveLength(0);
  });

  test('a member turns push on in notification settings, gets a test push, and removes the device', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const fake = fakeBrowser();
    const context = await pushContext(browser, fake);
    const page = await context.newPage();
    await newUser(page, { join: ['lakeside-events:manager'] });

    // The inbox page offers the opt-in too (without the device list).
    await page.goto('/o/lakeside-events/notifications');
    const inboxPush = page.getByRole('region', { name: 'Push notifications' });
    await expect(inboxPush.getByRole('button', { name: 'Turn on notifications', exact: true })).toBeVisible();
    await expect(inboxPush.getByRole('list', { name: 'Your devices' })).toHaveCount(0);
    await expectAccessible(page);

    await page.goto('/o/lakeside-events/notifications/preferences');
    const push = page.getByRole('region', { name: 'Push notifications' });
    await expect(push.getByText('No devices get notifications yet.')).toBeVisible();
    await push.getByRole('button', { name: 'Turn on notifications', exact: true }).click();
    await expect(push.getByRole('status')).toHaveText(
      'Notifications are on. Updates will arrive on this device.',
    );
    const devices = push.getByRole('list', { name: 'Your devices' });
    await expect(devices.getByRole('listitem')).toHaveCount(1);
    await expectAccessible(page);

    // "Send me a test notification" reaches this device as a push.
    await page.getByRole('button', { name: 'Send me a test notification' }).click();
    await expect(page.getByText('Test notification sent. Check the bell.')).toBeVisible();
    await drain(page);
    await expect.poll(async () => (await received(page, fake)).length).toBe(1);
    const [test1] = await received(page, fake);
    expect(test1?.payload).toMatchObject({
      title: 'Test notification',
      body: 'Notifications are working.',
      url: expect.stringMatching(/\/o\/lakeside-events\/notifications\/preferences$/),
    });
    expect(test1?.urgency).toBe('high');

    // Arabic, right to left.
    await page.goto('/ar/o/lakeside-events/notifications/preferences');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const pushAr = page.getByRole('region', { name: 'الإشعارات الفورية' });
    await expect(pushAr.getByRole('list', { name: 'أجهزتك' }).getByRole('listitem')).toHaveCount(1);
    await expectAccessible(page);
    await context.clearCookies({ name: 'NEXT_LOCALE' });

    // Remove it from the list (keyboard).
    await page.goto('/o/lakeside-events/notifications/preferences');
    const remove = devices.getByRole('button', { name: /^Remove Chrome · / });
    await remove.focus();
    await page.keyboard.press('Enter');
    await expect(push.getByRole('status')).toHaveText('Device removed.');
    await expect(push.getByText('No devices get notifications yet.')).toBeVisible();
    await expect(push.getByRole('button', { name: 'Turn on notifications', exact: true })).toBeVisible();
    await page.reload();
    await expect(push.getByText('No devices get notifications yet.')).toBeVisible();
    await expectAccessible(page);

    // Another test notification now reaches no device.
    await page.getByRole('button', { name: 'Send me a test notification' }).click();
    await expect(page.getByText('Test notification sent. Check the bell.')).toBeVisible();
    await drain(page);
    expect(await received(page, fake)).toHaveLength(1);
  });

  test('a viewer cannot send announcements; the fake push service is dev-only and checks VAPID', async ({
    page,
  }) => {
    await signIn(page, 'jordan@lakeside.test');
    expect((await page.goto(`${OPEN_HOUSE}/marketing`))?.status()).toBe(404);
    // An unsigned push is refused like a real push service would (401).
    const res = await page.request.post('/api/dev/push-service/e2eunsigned1', {
      headers: { 'content-encoding': 'aes128gcm' },
      data: Buffer.from('x'),
    });
    expect(res.status()).toBe(401);
    // Pages allow service workers from this origin only; the worker script is never cached stale.
    const csp =
      (await page.request.get('/events/lakeside-open-house')).headers()['content-security-policy'] ?? '';
    expect(csp).toContain("worker-src 'self' blob:");
    const sw = await page.request.get('/push-sw.js');
    expect(sw.headers()['cache-control']).toBe('no-cache');
    expect(sw.headers()['content-type']).toContain('javascript');
  });
});
