import { createECDH } from 'node:crypto';
import { addGuestCommand } from '@yayatoh/attendees';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { announcementMailer, sendAnnouncementCommand } from '@yayatoh/messaging';
import {
  b64url,
  createNotifier,
  decryptPayload,
  dispatchDue,
  eraseSubjectPushDevicesTx,
  generateVapidKeys,
  memoryTransports,
  myPushDevicesQuery,
  registerPushTokenCommand,
  removePushTokenCommand,
  routedPushTransport,
  sendTestNotificationCommand,
  suppressEmailTx,
  type Transports,
  verifyVapidAuthorization,
  webPushTransport,
} from '@yayatoh/notifications';
import {
  orderPushDevices,
  registerOrderPushCommand,
  removeOrderPushCommand,
  startCheckoutCommand,
} from '@yayatoh/orders';
import { consumeEvent, eventKey, markAddressErasedTx, recentEventsTx } from '@yayatoh/platform';
import { setSuspensionCommand } from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

const ORIGIN = 'https://app.yayatoh.test';
// 17:00 UTC: noon in Chicago (the event's zone), 02:00 the next day in Tokyo.
const NOON = () => new Date('2030-03-01T17:00:00Z');
const vapid = { keys: generateVapidKeys(), subject: 'mailto:ops@yayatoh.test', dev: false };
const notifier = createNotifier();
let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let free: { id: string };

/** A browser: its P-256 key pair and auth secret, and the subscription it would hand us. */
function browser(host = 'https://fcm.googleapis.com/fcm/send/') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = b64url.encode(crypto.getRandomValues(new Uint8Array(16)));
  const endpoint = `${host}${uuidv7()}`;
  return {
    endpoint,
    privateKey: b64url.encode(ecdh.getPrivateKey()),
    auth,
    subscription: { endpoint, keys: { p256dh: b64url.encode(ecdh.getPublicKey()), auth } },
  };
}
type Browser = ReturnType<typeof browser>;

/**
 * An RFC 8030 push service in memory: checks the VAPID JWT, answers with the scripted statuses
 * (201 by default) and keeps what it accepted so tests can decrypt it with the browser's keys.
 */
function pushService(opts: { delayMs?: number; onSend?: (endpoint: string) => Promise<void> } = {}) {
  const accepted: Array<{ endpoint: string; body: Uint8Array; headers: Record<string, string> }> = [];
  const script = new Map<string, number[]>();
  const fetch = async (url: string, init: RequestInit) => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    await opts.onSend?.(url);
    const headers = init.headers as Record<string, string>;
    const claims = verifyVapidAuthorization(headers.Authorization ?? null, {
      publicKey: vapid.keys.publicKey,
      audience: new URL(url).origin,
    });
    if (!claims) return new Response(null, { status: 401 });
    const status = script.get(url)?.shift() ?? 201;
    if (status === 201) accepted.push({ endpoint: url, body: init.body as Uint8Array, headers });
    return new Response(null, {
      status,
      headers: status === 429 ? { 'Retry-After': '600' } : { Location: `${url}/m/${accepted.length}` },
    });
  };
  const memory = memoryTransports();
  const transports: Transports = {
    email: memory.transports.email,
    // App tokens (the fixture's FCM token) go to the memory fake; browsers to the real adapter.
    push: routedPushTransport(
      { webpush: webPushTransport({ vapid, appOrigin: ORIGIN, fetch }) },
      memory.transports.push,
    ),
  };
  const read = (who: Browser) =>
    accepted
      .filter((x) => x.endpoint === who.endpoint)
      .map((x) =>
        JSON.parse(decryptPayload({ body: x.body, uaPrivateKey: who.privateKey, auth: who.auth }).toString()),
      );
  return { transports, accepted, script, read };
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const e = await executeCommand(
    createEventCommand,
    {
      name: 'Pier Lights',
      timezone: 'America/Chicago',
      startsAt: '2030-06-01T23:00:00Z',
      endsAt: '2030-06-02T03:00:00Z',
    },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  free = await executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'Free', priceMinor: 0, quantityTotal: 500 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
});
afterAll(closePools);

/** A buyer's order (the manage token is their credential) and a place on the guest list. */
async function buyer(email: string) {
  const r = await executeCommand(
    startCheckoutCommand,
    { eventId, items: [{ ticketTypeId: free.id, quantity: 1 }], buyer: { email, name: `Guest ${email}` } },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  await executeCommand(addGuestCommand, { eventId, name: `Guest ${email}`, email }, a.ctx(), ports).catch(
    () => undefined,
  );
  return r.manageToken as string;
}

const optIn = (token: string, who: Browser, extra: { timeZone?: string } = {}) =>
  executeCommand(
    registerOrderPushCommand,
    { token, subscription: { ...who.subscription, label: 'Chrome · Android', ...extra } },
    createCtx({ orgId: a.org.id }),
    ports,
  );

async function announce(subject: string, channels: ('email' | 'push')[] = ['email', 'push']) {
  return executeCommand(
    sendAnnouncementCommand,
    { eventId, subject, body: 'Lot B is closed.\nUse lot C.', channels },
    a.ctx({ idempotencyKey: uuidv7() }),
    ports,
  );
}

async function fanOut() {
  const events = await withTenant(systemCtx(a.org.id), (tx) =>
    recentEventsTx(tx, a.org.id, ['announcement.sent'], 3_600_000),
  );
  const sub = announcementMailer({ notifier, appOrigin: ORIGIN });
  for (const e of events) if (sub.events.includes(eventKey(e))) await consumeEvent(sub, e);
}

/** The announcement's push rows for these people (earlier tests' opted-in buyers get it too). */
const pushRows = async (prefix: string, people: readonly string[]) =>
  (
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{
        id: string;
        status: string;
        reason: string | null;
        recipient_email: string;
        send_after: Date;
      }>(
        sql`select id, status, reason, recipient_email, send_after from notifications.messages
            where channel = 'push' and dedupe_key like ${`${prefix}%`} order by recipient_email`,
      ),
    )
  ).filter((r) => people.includes(r.recipient_email));

const deliveries = (messageId: string) =>
  withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{
      status: string;
      http_status: number | null;
      attempts: number;
      push_token_id: string | null;
    }>(
      sql`select status, http_status, attempts, push_token_id from notifications.push_deliveries
          where message_id = ${messageId} order by created_at`,
    ),
  );

describe('web push: guest buyers opt in from the order page', () => {
  it('stores the subscription for the buyer, lists devices without endpoints, and refuses bad input', async () => {
    const token = await buyer('opt@example.test');
    const phone = browser();
    const { deviceId } = await optIn(token, phone, { timeZone: 'Europe/Paris' });
    // Subscribing again from the same browser refreshes the same row.
    expect((await optIn(token, phone)).deviceId).toBe(deviceId);
    const list = await orderPushDevices(token);
    expect(list).toEqual([
      expect.objectContaining({ id: deviceId, platform: 'webpush', label: 'Chrome · Android' }),
    ]);
    expect(Object.keys(list?.[0] ?? {}).sort()).toEqual([
      'id',
      'label',
      'lastSeenAt',
      'platform',
      'ref',
      'since',
    ]);
    expect(JSON.stringify(list)).not.toContain(phone.endpoint);
    expect(JSON.stringify(list)).not.toContain(phone.auth);

    const ctx = createCtx({ orgId: a.org.id });
    await expect(
      executeCommand(
        registerOrderPushCommand,
        { token: 'x'.repeat(43), subscription: browser().subscription },
        ctx,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    // Only real push services: no SSRF through a crafted endpoint.
    await expect(optIn(token, browser('https://169.254.169.254/latest/'))).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'endpoint' },
    });
    const bad = browser();
    await expect(
      executeCommand(
        registerOrderPushCommand,
        { token, subscription: { ...bad.subscription, keys: { p256dh: 'A'.repeat(87), auth: bad.auth } } },
        ctx,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    // Another org cannot use this org's manage link.
    await expect(
      executeCommand(
        registerOrderPushCommand,
        { token, subscription: browser().subscription },
        createCtx({ orgId: b.org.id }),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('caps devices per person and removes by id or endpoint (own devices only)', async () => {
    const token = await buyer('many@example.test');
    const other = await buyer('other@example.test');
    const first = browser();
    await optIn(token, first);
    for (let i = 1; i < 10; i++) await optIn(token, browser());
    await expect(optIn(token, browser())).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'too_many_devices' },
    });
    const list = (await orderPushDevices(token)) ?? [];
    expect(list).toHaveLength(10);
    const ctx = createCtx({ orgId: a.org.id });
    // Someone else's manage link can't remove this buyer's device.
    await expect(
      executeCommand(removeOrderPushCommand, { token: other, deviceId: list[0]?.id }, ctx, ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await executeCommand(removeOrderPushCommand, { token, deviceId: list[0]?.id }, ctx, ports);
    expect(
      await executeCommand(removeOrderPushCommand, { token, endpoint: first.endpoint }, ctx, ports),
    ).toEqual({ removed: true });
    expect(await orderPushDevices(token)).toHaveLength(8);
    await optIn(token, browser());
  });
});

describe('web push: announcements', () => {
  it('fans out once per opted-in person even when the job and the dispatcher are duplicated', async () => {
    const token = await buyer('ana.push@example.test');
    await buyer('ben.nopush@example.test');
    const ana = browser();
    await optIn(token, ana);
    const sent = await announce('Parking update');
    // The relay delivers the event twice; three dispatchers run at once against a slow service.
    await Promise.all([fanOut(), fanOut()]);
    const svc = pushService({ delayMs: 50 });
    await Promise.all(
      [1, 2, 3].map(() =>
        dispatchDue(a.org.id, { transports: svc.transports, appOrigin: ORIGIN, now: NOON }),
      ),
    );
    await dispatchDue(a.org.id, { transports: svc.transports, appOrigin: ORIGIN, now: NOON });

    const rows = await pushRows(`announcement:${sent.id}:`, [
      'ana.push@example.test',
      'ben.nopush@example.test',
    ]);
    // Ben never opted in: no push row at all (he still gets the email).
    expect(rows.map((r) => [r.recipient_email, r.status])).toEqual([['ana.push@example.test', 'sent']]);
    const payloads = svc.read(ana);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual({
      title: 'Parking update',
      body: 'Lot B is closed.\nUse lot C.',
      url: expect.stringMatching(new RegExp(`^${ORIGIN}/messages/[0-9a-f-]{36}~`)),
      tag: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/),
      lang: 'en',
      dir: 'ltr',
    });
    // Nothing personal beyond what the notification shows.
    expect(JSON.stringify(payloads[0])).not.toContain('ana.push@example.test');
    const [h] = svc.accepted.filter((x) => x.endpoint === ana.endpoint).map((x) => x.headers);
    expect(h).toMatchObject({ TTL: '86400', Urgency: 'normal', 'Content-Encoding': 'aes128gcm' });
    expect(h?.Topic).toBe(payloads[0].tag);
    // The delivery log: one row, sent.
    expect((await deliveries(rows[0]?.id ?? '')).map((d) => d.status)).toEqual(['sent']);
  });

  it('holds push in the device’s quiet hours (its own timezone) while email follows the event’s', async () => {
    const token = await buyer('night.owl@example.test');
    const tokyo = browser();
    await optIn(token, tokyo, { timeZone: 'Asia/Tokyo' });
    const sent = await announce('Late news');
    await fanOut();
    const svc = pushService();
    await dispatchDue(a.org.id, { transports: svc.transports, appOrigin: ORIGIN, now: NOON });
    const [row] = await pushRows(`announcement:${sent.id}:`, ['night.owl@example.test']);
    expect(row).toMatchObject({ status: 'queued', reason: 'quiet_hours' });
    // Released at 08:00 in Tokyo (23:00 UTC).
    expect(new Date(row?.send_after ?? 0).toISOString()).toBe('2030-03-01T23:00:00.000Z');
    expect(svc.read(tokyo)).toHaveLength(0);
    await dispatchDue(a.org.id, {
      transports: svc.transports,
      appOrigin: ORIGIN,
      now: () => new Date('2030-03-01T23:00:00Z'),
    });
    expect(svc.read(tokyo)).toHaveLength(1);
  });

  it('pause_messaging holds push; an unsubscribe or block from event updates stops it', async () => {
    const token = await buyer('paused@example.test');
    const tokenQuiet = await buyer('quiet@example.test');
    const p = browser();
    const q = browser();
    await optIn(token, p);
    await optIn(tokenQuiet, q);
    const sent = await announce('Paused news', ['push']);
    await fanOut();
    await withTenant(systemCtx(a.org.id), (tx) =>
      suppressEmailTx(tx, a.org.id, 'quiet@example.test', 'event_updates', 'block'),
    );
    const pause = (paused: boolean) =>
      executeCommand(
        setSuspensionCommand,
        { kind: 'pause_messaging', paused, reason: paused ? 'review' : 'cleared' },
        systemCtx(a.org.id),
        ports,
      );
    await pause(true);
    const svc = pushService();
    try {
      // New announcements are refused while paused.
      await expect(announce('Refused')).rejects.toMatchObject({ code: 'invalid_state' });
      await dispatchDue(a.org.id, { transports: svc.transports, appOrigin: ORIGIN, now: NOON });
      const held = await pushRows(`announcement:${sent.id}:`, ['paused@example.test', 'quiet@example.test']);
      expect(held.map((r) => [r.recipient_email, r.status, r.reason])).toEqual([
        ['paused@example.test', 'queued', 'messaging_paused'],
        ['quiet@example.test', 'queued', 'messaging_paused'],
      ]);
      expect(svc.accepted).toHaveLength(0);
    } finally {
      await pause(false);
    }
    await dispatchDue(a.org.id, {
      transports: svc.transports,
      appOrigin: ORIGIN,
      now: () => new Date(NOON().getTime() + 20 * 60_000),
    });
    const after = await pushRows(`announcement:${sent.id}:`, ['paused@example.test', 'quiet@example.test']);
    expect(after.map((r) => [r.recipient_email, r.status, r.reason])).toEqual([
      ['paused@example.test', 'sent', null],
      ['quiet@example.test', 'suppressed', 'unsubscribed'],
    ]);
    expect(svc.read(p)).toHaveLength(1);
    expect(svc.read(q)).toHaveLength(0);
  });

  it('an erased address (M1.14e) gets no push either, and its erasure removes the buyer’s devices', async () => {
    const token = await buyer('erased.push@example.test');
    const e = browser();
    await optIn(token, e);
    const sent = await announce('After erasure', ['push']);
    await fanOut();
    // Platform-wide erased-address list (as a DSAR erasure in another org would leave it).
    await withTenant(systemCtx(b.org.id), (tx) => markAddressErasedTx(tx, 'erased.push@example.test'));
    const svc = pushService();
    await dispatchDue(a.org.id, { transports: svc.transports, appOrigin: ORIGIN, now: NOON });
    const rows = await pushRows(`announcement:${sent.id}:`, ['erased.push@example.test']);
    expect(rows.map((r) => [r.status, r.reason])).toEqual([['suppressed', 'erased']]);
    expect(svc.read(e)).toHaveLength(0);
    // The org's own DSAR erasure deletes the buyer's devices (endpoint and keys are personal data).
    await withTenant(systemCtx(a.org.id), (tx) => eraseSubjectPushDevicesTx(tx, 'erased.push@example.test'));
    expect(await orderPushDevices(token)).toEqual([]);
  });

  it('prunes an expired subscription (410); a rate-limited device is retried later without repeating the others', async () => {
    const token = await buyer('two.devices@example.test');
    const gone = browser();
    const laptop = browser();
    const busy = browser();
    await optIn(token, gone);
    await optIn(token, laptop);
    await optIn(token, busy);
    const sent = await announce('Retry me', ['push']);
    await fanOut();
    const svc = pushService();
    svc.script.set(gone.endpoint, [410]);
    svc.script.set(busy.endpoint, [429]);
    await dispatchDue(a.org.id, { transports: svc.transports, appOrigin: ORIGIN, now: NOON });
    const [row] = await pushRows(`announcement:${sent.id}:`, ['two.devices@example.test']);
    expect(row).toMatchObject({ status: 'queued', reason: 'retrying' });
    // Retry-After 600 s beats the 2-minute backoff.
    expect(new Date(row?.send_after ?? 0).getTime()).toBe(NOON().getTime() + 600_000);
    expect((await deliveries(row?.id ?? '')).map((d) => [d.status, d.http_status]).sort()).toEqual([
      ['expired', 410],
      ['retrying', 429],
      ['sent', null],
    ]);
    const devices = await orderPushDevices(token);
    expect(devices).toHaveLength(2); // the expired subscription is pruned from the list
    await dispatchDue(a.org.id, {
      transports: svc.transports,
      appOrigin: ORIGIN,
      now: () => new Date(NOON().getTime() + 600_000),
    });
    const [done] = await pushRows(`announcement:${sent.id}:`, ['two.devices@example.test']);
    expect(done?.status).toBe('sent');
    expect(svc.read(laptop)).toHaveLength(1);
    expect(svc.read(busy)).toHaveLength(1);
    expect(svc.read(gone)).toHaveLength(0);
    expect(
      (await deliveries(done?.id ?? '')).find((d) => d.status === 'sent' && d.attempts === 2),
    ).toBeTruthy();
  });

  it('a removed device keeps its delivery log rows (the reference is cleared)', async () => {
    const token = await buyer('removed@example.test');
    const d = browser();
    const { deviceId } = await optIn(token, d);
    const sent = await announce('Before removal', ['push']);
    await fanOut();
    const svc = pushService();
    await dispatchDue(a.org.id, { transports: svc.transports, appOrigin: ORIGIN, now: NOON });
    await executeCommand(removeOrderPushCommand, { token, deviceId }, createCtx({ orgId: a.org.id }), ports);
    const [row] = await pushRows(`announcement:${sent.id}:`, ['removed@example.test']);
    expect(await deliveries(row?.id ?? '')).toEqual([
      expect.objectContaining({ status: 'sent', push_token_id: null }),
    ]);
  });
});

describe('web push: a device removed during the send', () => {
  it('logs the vanished device with the reference cleared and still delivers to the others', async () => {
    const token = await buyer('race@example.test');
    const phone = browser();
    const laptop = browser();
    const { deviceId: phoneId } = await optIn(token, phone);
    const { deviceId: laptopId } = await optIn(token, laptop);
    // Another buyer's message in the same batch must go out too.
    const bystanderToken = await buyer('race.bystander@example.test');
    const bystander = browser();
    await optIn(bystanderToken, bystander);
    const sent = await announce('Mid-send removal', ['push']);
    await fanOut();
    // The dispatcher has read the buyer's devices; while it talks to the push service the buyer
    // removes the device from another tab (its own transaction, committed at once).
    const removed = new Map([
      [phone.endpoint, phoneId],
      [laptop.endpoint, laptopId],
    ]);
    let removedId: string | null = null;
    const svc = pushService({
      onSend: async (url) => {
        const id = removed.get(url);
        if (!id || removedId) return;
        removedId = id;
        await executeCommand(
          removeOrderPushCommand,
          { token, deviceId: id },
          createCtx({ orgId: a.org.id }),
          ports,
        );
      },
    });
    await expect(
      dispatchDue(a.org.id, { transports: svc.transports, appOrigin: ORIGIN, now: NOON }),
    ).resolves.toMatchObject({ failed: 0 });
    expect(removedId).not.toBeNull();

    const rows = await pushRows(`announcement:${sent.id}:`, [
      'race@example.test',
      'race.bystander@example.test',
    ]);
    expect(rows.map((r) => [r.recipient_email, r.status])).toEqual([
      ['race.bystander@example.test', 'sent'],
      ['race@example.test', 'sent'],
    ]);
    expect(svc.read(phone)).toHaveLength(1);
    expect(svc.read(laptop)).toHaveLength(1);
    expect(svc.read(bystander)).toHaveLength(1);
    const kept = removedId === phoneId ? laptopId : phoneId;
    const log = await deliveries(rows.find((r) => r.recipient_email === 'race@example.test')?.id ?? '');
    expect(log.map((d) => [d.status, d.push_token_id]).sort()).toEqual(
      [
        ['sent', kept],
        ['sent', null],
      ].sort(),
    );
    expect(await orderPushDevices(token)).toEqual([expect.objectContaining({ id: kept })]);
  });
});

describe('web push: members', () => {
  it('a member opts a browser in, gets a test notification by push, and manages only their own devices', async () => {
    const mine = browser();
    const { deviceId } = await executeCommand(
      registerPushTokenCommand,
      { platform: 'webpush', subscription: { ...mine.subscription, label: 'Firefox · Linux' } },
      a.ctx(),
      ports,
    );
    const viewerDevice = browser();
    const viewer = await executeCommand(
      registerPushTokenCommand,
      { platform: 'webpush', subscription: viewerDevice.subscription },
      userCtx(a.viewerId, a.org.id),
      ports,
    );
    expect((await executeQuery(myPushDevicesQuery, {}, a.ctx(), ports)).map((d) => d.id)).toContain(deviceId);
    expect((await executeQuery(myPushDevicesQuery, {}, a.ctx(), ports)).map((d) => d.id)).not.toContain(
      viewer.deviceId,
    );
    await expect(
      executeCommand(removePushTokenCommand, { deviceId: viewer.deviceId }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    // A system actor has no devices of its own.
    await expect(
      executeCommand(
        registerPushTokenCommand,
        { platform: 'webpush', subscription: browser().subscription },
        systemCtx(a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });

    await executeCommand(sendTestNotificationCommand, {}, a.ctx(), ports);
    const svc = pushService();
    await dispatchDue(a.org.id, { transports: svc.transports, appOrigin: ORIGIN, now: NOON });
    const [test] = svc.read(mine);
    expect(test).toMatchObject({ title: 'Test notification', body: 'Notifications are working.' });
    expect(test.url).toBe(`${ORIGIN}/o/${a.org.slug}/notifications/preferences`);
    expect(svc.accepted.find((x) => x.endpoint === mine.endpoint)?.headers).toMatchObject({
      Urgency: 'high',
      TTL: '300',
    });
    expect(svc.read(viewerDevice)).toHaveLength(0);

    // Member alerts go to push only when opted in (preference on and a device).
    await withTenant(systemCtx(a.org.id), (tx) =>
      notifier.notifyMembers(tx, {
        kind: 'messaging.contact_replied',
        params: { name: 'Cy', eventName: 'Pier Lights' },
        dedupeKey: `push-member:${uuidv7()}`,
        href: '/messages',
      }),
    );
    await dispatchDue(a.org.id, { transports: svc.transports, appOrigin: ORIGIN, now: NOON });
    expect(svc.read(mine).map((p) => p.title)).toContain('New message from Cy');

    expect(await executeCommand(removePushTokenCommand, { endpoint: mine.endpoint }, a.ctx(), ports)).toEqual(
      { removed: true },
    );
    // Only the fixture's devices are left.
    const left = await executeQuery(myPushDevicesQuery, {}, a.ctx(), ports);
    expect(left.map((d) => d.id)).not.toContain(deviceId);
    expect(left.map((d) => d.label ?? d.platform).sort()).toEqual(['Fixture browser', 'fcm']);
  });

  it('isolation: org B sees none of org A’s devices or deliveries', async () => {
    const counts = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ tokens: number; deliveries: number }>(
        sql`select (select count(*)::int from notifications.push_tokens where org_id = ${a.org.id}) as tokens,
                   (select count(*)::int from notifications.push_deliveries where org_id = ${a.org.id}) as deliveries`,
      ),
    );
    expect(counts[0]).toEqual({ tokens: 0, deliveries: 0 });
    expect(await executeQuery(myPushDevicesQuery, {}, b.ctx(), ports)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Chrome · Android' })]),
    );
  });
});
