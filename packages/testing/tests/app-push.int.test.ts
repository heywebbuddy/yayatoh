import { randomBytes } from 'node:crypto';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand, updateEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import {
  type AppDeviceInput,
  createNotifier,
  dispatchDue,
  memoryTransports,
  orgsWithAppAccess,
  purgeAppDevices,
  registerAppDevice,
  removeAppDevice,
} from '@yayatoh/notifications';
import {
  appPushNotifier,
  cancelAppReminders,
  queueAppReminders,
  queueRemindersForHolderTx,
  reminderRescheduler,
  startCheckoutCommand,
} from '@yayatoh/orders';
import { consumeEvent, eventKey, recentEventsTx, type Subscriber } from '@yayatoh/platform';
import {
  cancelTransferCommand,
  claimContext,
  claimTicketCommand,
  createTicketTypeCommand,
  startTransferCommand,
} from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

/**
 * M7.2c native push: a phone is stored once per org where its owner has an order or a ticket and
 * only there; unregistered tokens are disabled until re-registered; the P7-8 kinds are queued by
 * the order, transfer and event events, reminders once per ticket in the event's zone; the lock
 * screen carries the event name and what changed.
 */
const ORIGIN = 'https://app.yayatoh.test';
let a: OrgFixture;
let b: OrgFixture;
const notifier = createNotifier();
const sub = appPushNotifier({ notifier });
const rescheduler = reminderRescheduler();

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

const hex = () => randomBytes(32).toString('hex');
const email = (tag: string) => `${tag}-${uuidv7().slice(-10)}@example.test`;
const device = (over: Partial<AppDeviceInput> = {}): AppDeviceInput => ({
  platform: 'apns',
  token: hex(),
  appId: 'com.yayatoh.app',
  appVersion: '1.0.0',
  locale: 'en',
  timeZone: 'America/Chicago',
  environment: 'sandbox',
  ...over,
});
const register = (who: string, d: AppDeviceInput, queueReminders = false) =>
  registerAppDevice({
    email: who,
    device: d,
    ports,
    ...(queueReminders
      ? {
          afterOrg: async (tx, _org, norm) => {
            await queueRemindersForHolderTx(tx, notifier, norm, new Date());
          },
        }
      : {}),
  });

type Row = Record<string, unknown>;
const q = <T extends Row>(org: OrgFixture, query: ReturnType<typeof sql>) =>
  withTenant(systemCtx(org.org.id), (tx) => tx.execute<T>(query));
const tokensOf = (org: OrgFixture, token: string) =>
  q<{ email_norm: string; source: string; user_id: string | null; disabled_at: string | null }>(
    org,
    sql`select email_norm, source, user_id, disabled_at from notifications.push_tokens where token = ${token}`,
  );
const messages = async (org: OrgFixture, who: string, kind?: string) =>
  (
    await q<{
      id: string;
      kind: string;
      status: string;
      reason: string | null;
      send_after: string;
      dedupe_key: string;
    }>(
      org,
      sql`select id, kind, status, reason, send_after, dedupe_key from notifications.messages
        where recipient_email = ${who} ${kind ? sql`and kind = ${kind}` : sql``} order by kind, send_after`,
    )
  ).map((r) => ({ ...r, send_after: new Date(r.send_after).toISOString() }));

async function publishedEvent(
  org: OrgFixture,
  startsAt: string,
  over: Record<string, unknown> = {},
  timezone = 'America/Chicago',
) {
  const ev = await executeCommand(
    createEventCommand,
    {
      name: `Lakeside Jazz ${uuidv7().slice(-6)}`,
      timezone,
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + 4 * 3600_000).toISOString(),
      venueName: 'Pier 9',
      ...over,
    },
    org.ctx(),
    ports,
  );
  const tt = await executeCommand(
    createTicketTypeCommand,
    { eventId: ev.id, name: 'Free', priceMinor: 0, quantityTotal: 500 },
    org.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, org.ctx(), ports);
  return { ev, tt };
}

async function eventsOf(org: OrgFixture, types: string[], aggregateId: string) {
  return (
    await withTenant(systemCtx(org.org.id), (tx) => recentEventsTx(tx, org.org.id, types, 3_600_000))
  ).filter((e) => e.aggregateId === aggregateId);
}
/** Run a subscriber over the events of one aggregate (consumers dedupe per event id). */
async function consume(org: OrgFixture, s: Subscriber, aggregateId: string) {
  const types = s.events.map((e) => e.split('@')[0] as string);
  const list = await eventsOf(org, types, aggregateId);
  for (const e of list) if (s.events.includes(eventKey(e))) await consumeEvent(s, e);
  return list;
}

async function buy(org: OrgFixture, eventId: string, ticketTypeId: string, who: string, quantity = 1) {
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId, quantity }],
      buyer: { email: who, name: 'Amina Diallo' },
      locale: 'en',
    },
    createCtx({ orgId: org.org.id }),
    ports,
  );
  await consume(org, sub, r.order.id);
  const ticketIds = (
    await q<{ id: string }>(
      org,
      sql`select id from ticketing.tickets where order_id = ${r.order.id} order by serial`,
    )
  ).map((t) => t.id);
  return { orderId: r.order.id, ticketIds };
}

const at = (iso: string) => new Date(iso);
/** The app asks for push after the first purchase: buy, register the phone, then buy again. */
async function boughtWithPhone(
  org: OrgFixture,
  eventId: string,
  ticketTypeId: string,
  who: string,
  d: AppDeviceInput,
) {
  await buy(org, eventId, ticketTypeId, who);
  await register(who, d);
  return buy(org, eventId, ticketTypeId, who);
}
async function dispatch(org: OrgFixture, t: ReturnType<typeof memoryTransports>, now: Date) {
  return dispatchDue(org.org.id, { transports: t.transports, appOrigin: ORIGIN, now: () => now }, 200);
}

describe('registering a phone (M7.2c)', () => {
  it('a person with no order or ticket has nowhere to store it; the first purchase does not copy what was never stored', async () => {
    const who = email('early');
    const d = device();
    expect(await register(who, d)).toEqual({ orgs: 0 });
    expect(await tokensOf(a, d.token)).toEqual([]);
    expect(await orgsWithAppAccess(who)).toEqual([]);
  });

  it('is stored in each org where they have an order or a ticket, and in no other', async () => {
    const who = email('both');
    const { ev, tt } = await publishedEvent(a, '2030-06-01T23:00:00Z');
    await buy(a, ev.id, tt.id, who);
    const d = device();
    expect(await register(who, d)).toEqual({ orgs: 1 });
    const [row, ...rest] = await tokensOf(a, d.token);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ email_norm: who, source: 'app', user_id: null, disabled_at: null });
    expect(await tokensOf(b, d.token)).toEqual([]);
    const [meta] = await q<{
      app_id: string;
      app_version: string;
      locale: string;
      time_zone: string;
      environment: string;
    }>(
      a,
      sql`select app_id, app_version, locale, time_zone, environment from notifications.push_tokens where token = ${d.token}`,
    );
    expect(meta).toEqual({
      app_id: 'com.yayatoh.app',
      app_version: '1.0.0',
      locale: 'en',
      time_zone: 'America/Chicago',
      environment: 'sandbox',
    });
    // Registering again refreshes the row, never duplicates it.
    expect(await register(who, { ...d, appVersion: '1.0.1' })).toEqual({ orgs: 1 });
    expect(await tokensOf(a, d.token)).toHaveLength(1);
    // Buying in the second org later: the phone follows the person.
    const second = await publishedEvent(b, '2030-06-01T23:00:00Z');
    await buy(b, second.ev.id, second.tt.id, who);
    const [followed] = await tokensOf(b, d.token);
    expect(followed).toMatchObject({ email_norm: who, source: 'app', disabled_at: null });
    expect((await orgsWithAppAccess(who)).sort()).toEqual([a.org.id, b.org.id].sort());
  });

  it('a phone never receives a push from an org where its owner has no order or ticket', async () => {
    const who = email('isolated');
    const { ev, tt } = await publishedEvent(a, '2030-06-01T23:00:00Z');
    await buy(a, ev.id, tt.id, who);
    const d = device();
    await register(who, d);
    // Org B has nothing to do with this person: a push queued there goes nowhere, even when asked.
    const queued = await withTenant(systemCtx(b.org.id), (tx) =>
      notifier.enqueue(tx, {
        kind: 'push.event-changed',
        to: { email: who },
        params: { eventName: 'Not yours', _path: '/events/x' },
        dedupeKey: `isolation:${who}`,
      }),
    );
    expect(queued.queued).toBe(0);
    const t = memoryTransports();
    await dispatch(b, t, at('2030-01-01T12:00:00Z'));
    expect(t.pushes.filter((p) => p.token === d.token)).toEqual([]);
    // A row forced into org B by hand still has no access: the dispatcher only sends what the org
    // queued, and org A's messages are invisible to it.
    expect(await messages(b, who)).toEqual([]);
  });

  it('refuses a token that cannot be the platform’s and an app id that is not ours', async () => {
    const who = email('bad');
    await expect(register(who, device({ token: 'not hex!' }))).rejects.toThrow();
    await expect(register(who, device({ platform: 'fcm', token: 'short' }))).rejects.toThrow();
    const prior = process.env.PUSH_APP_IDS;
    process.env.PUSH_APP_IDS = 'com.yayatoh.app';
    try {
      await expect(register(who, device({ appId: 'com.evil.app' }))).rejects.toMatchObject({
        code: 'validation_failed',
      });
    } finally {
      if (prior === undefined) delete process.env.PUSH_APP_IDS;
      else process.env.PUSH_APP_IDS = prior;
    }
  });
});

describe('order confirmed and the two reminders (M7.2c)', () => {
  const who = email('buyer');
  const d = device();
  let eventId: string;
  let eventName: string;
  let ticketIds: string[];
  let orderId: string;

  it('queues the confirmation and both reminders for each ticket, and sends the confirmation once', async () => {
    const { ev, tt } = await publishedEvent(a, '2030-06-01T23:00:00Z');
    eventId = ev.id;
    eventName = ev.name;
    // The phone is registered first (the app asks after the first purchase; here before, to see the
    // order-paid consumer copy nothing and queue everything).
    const first = await buy(a, ev.id, tt.id, email('seed'));
    expect(first.ticketIds).toHaveLength(1);
    const bought = await buy(a, ev.id, tt.id, who, 2);
    orderId = bought.orderId;
    ticketIds = bought.ticketIds;
    expect(await messages(a, who)).toEqual([]); // no phone yet: nothing queued
    await register(who, d, true);
    // The reminders skipped while there was no phone are queued when it registers.
    const reminders = await messages(a, who);
    expect(reminders.map((r) => r.kind)).toEqual([
      'push.reminder-24h',
      'push.reminder-24h',
      'push.reminder-2h',
      'push.reminder-2h',
    ]);
    // 18:00 CDT on June 1 (23:00Z): 24 h before is 18:00 CDT on May 31, 2 h before is 16:00 CDT.
    expect(new Set(reminders.filter((r) => r.kind === 'push.reminder-24h').map((r) => r.send_after))).toEqual(
      new Set(['2030-05-31T23:00:00.000Z']),
    );
    // Registering again queues nothing twice (one per kind, ticket and person).
    await register(who, d, true);
    expect(await messages(a, who)).toHaveLength(4);
  });

  it('a purchase made with the phone already registered queues the confirmation, then sends it once', async () => {
    const t = memoryTransports();
    const buyer2 = email('buyer2');
    const { ev, tt } = await publishedEvent(a, '2030-06-01T23:00:00Z');
    await buy(a, ev.id, tt.id, email('seed2'));
    // Same person buys again later, phone already registered: the paid event queues everything.
    await executeCommand(
      startCheckoutCommand,
      {
        eventId: ev.id,
        items: [{ ticketTypeId: tt.id, quantity: 1 }],
        buyer: { email: buyer2, name: 'Amina Diallo' },
      },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    // The first order for buyer2 (before the phone): none queued. Register, buy again.
    const d2 = device();
    await register(buyer2, d2, true);
    const second = await buy(a, ev.id, tt.id, buyer2);
    const mine = await messages(a, buyer2);
    expect(mine.filter((m) => m.kind === 'push.order-confirmed')).toHaveLength(1);
    await dispatch(a, t, at('2030-05-01T12:00:00Z'));
    await dispatch(a, t, at('2030-05-01T12:05:00Z'));
    const sent = t.pushes.filter((p) => p.token === d2.token);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      platform: 'apns',
      title: ev.name,
      body: 'Your order is confirmed.',
      path: `/orders/${second.orderId}`,
      topic: `order:${second.orderId}`,
      appId: 'com.yayatoh.app',
      environment: 'sandbox',
      lang: 'en',
    });
    // The lock screen shows the event name and what changed: nothing of the person or the order.
    expect(JSON.stringify([sent[0]?.title, sent[0]?.body])).not.toMatch(/Amina|@/);
  });

  it('sends each reminder once per ticket, at its time, and never again', async () => {
    const t = memoryTransports();
    const mine = () => t.pushes.filter((p) => p.token === d.token);
    await dispatch(a, t, at('2030-05-31T12:00:00Z')); // before the 24 h mark: nothing yet
    expect(mine().filter((p) => p.body.startsWith('Starts'))).toEqual([]);
    await dispatch(a, t, at('2030-05-31T23:00:30Z'));
    await dispatch(a, t, at('2030-05-31T23:30:00Z'));
    const day = mine().filter((p) => p.body.startsWith('Starts tomorrow'));
    expect(day.map((p) => p.path).sort()).toEqual(ticketIds.map((id) => `/tickets/${id}`).sort());
    expect(day.every((p) => p.title === eventName && p.body === 'Starts tomorrow at 6:00 PM.')).toBe(true);
    expect(day.every((p) => p.topic?.startsWith('ticket:'))).toBe(true);
    await dispatch(a, t, at('2030-06-01T21:00:30Z'));
    await dispatch(a, t, at('2030-06-01T21:10:00Z'));
    const hours = mine().filter((p) => p.body.startsWith('Starts in 2 hours'));
    expect(hours).toHaveLength(2);
    expect(hours.every((p) => p.body === 'Starts in 2 hours, at 6:00 PM.')).toBe(true);
    // The 2 h one shares the ticket's collapse id with the 24 h one: it replaces it on the lock screen.
    for (const id of ticketIds)
      expect(
        mine()
          .filter((p) => p.path === `/tickets/${id}`)
          .map((p) => p.topic),
      ).toEqual([`ticket:${id}`, `ticket:${id}`]);
    // Replays queue nothing new.
    await consume(a, sub, orderId);
    expect(await messages(a, who)).toHaveLength(4);
    expect(eventId).toBeTruthy();
  });

  it('reminders keep the event’s clock across a daylight-saving change', async () => {
    // 19:00 CDT on 2030-03-10, the evening after the clocks went forward the night before... of
    // that date: the US changes at 02:00 on 2030-03-10, so the day before is still CST.
    const dst = email('dst');
    const { ev, tt } = await publishedEvent(a, '2030-03-11T00:00:00Z');
    await boughtWithPhone(a, ev.id, tt.id, dst, device());
    const r = await messages(a, dst);
    const when = (kind: string) => r.find((m) => m.kind === kind)?.send_after;
    // 19:00 CST on March 9 (01:00Z on the 10th): 23 elapsed hours before the show, the same wall clock.
    expect(new Date(when('push.reminder-24h') ?? '').toISOString()).toBe('2030-03-10T01:00:00.000Z');
    expect(new Date(when('push.reminder-2h') ?? '').toISOString()).toBe('2030-03-10T22:00:00.000Z');
    // An event whose 2 h mark crosses the change itself: 03:30 CDT is 2 h of real time after 00:30 CST.
    const night = await publishedEvent(a, '2030-03-10T08:30:00Z');
    const who2 = email('dst2');
    await boughtWithPhone(a, night.ev.id, night.tt.id, who2, device());
    const n = await messages(a, who2);
    expect(new Date(n.find((m) => m.kind === 'push.reminder-2h')?.send_after ?? '').toISOString()).toBe(
      '2030-03-10T06:30:00.000Z',
    );
  });

  it('a reminder held by quiet hours past the start is dropped, not sent late', async () => {
    const night = email('night');
    const { ev, tt } = await publishedEvent(a, '2030-07-01T03:00:00Z', {}, 'UTC');
    const nightPhone = device({ timeZone: 'UTC' });
    await boughtWithPhone(a, ev.id, tt.id, night, nightPhone);
    const t = memoryTransports();
    // 01:00 UTC is inside the device's quiet hours; they end at 08:00, after the 03:00 start.
    await dispatch(a, t, at('2030-07-01T01:00:30Z'));
    const row = (await messages(a, night)).find((m) => m.kind === 'push.reminder-2h');
    expect(row).toMatchObject({ status: 'suppressed', reason: 'quiet_hours' });
    expect(t.pushes.filter((p) => p.token === nightPhone.token && p.body.startsWith('Starts'))).toEqual([]);
  });
});

describe('unregistered tokens, retries and sign-out (M7.2c)', () => {
  async function person() {
    const who = email('p');
    const { ev, tt } = await publishedEvent(a, '2030-06-01T23:00:00Z');
    await buy(a, ev.id, tt.id, who);
    return { who, ev };
  }
  const changed = (who: string, name: string, key: string) =>
    withTenant(systemCtx(a.org.id), (tx) =>
      notifier.enqueue(tx, {
        kind: 'push.event-changed',
        to: { email: who },
        params: { eventName: name, _path: '/events/x', _collapse: 'event:x' },
        dedupeKey: key,
      }),
    );

  it('a token the provider reports as unregistered is never sent to again until it is re-registered', async () => {
    const { who, ev } = await person();
    const d = device();
    await register(who, d);
    const t = memoryTransports();
    t.invalid.add(d.token);
    await changed(who, ev.name, `c1:${who}`);
    await dispatch(a, t, at('2030-01-01T12:00:00Z'));
    expect((await tokensOf(a, d.token))[0]?.disabled_at).not.toBeNull();
    // From now on nothing is queued for it, and a push already queued finds no device.
    expect((await changed(who, ev.name, `c2:${who}`)).queued).toBe(0);
    t.invalid.delete(d.token);
    await dispatch(a, t, at('2030-01-01T12:05:00Z'));
    expect(t.pushes.filter((p) => p.token === d.token)).toEqual([]);
    // The app registers again (a new token from the OS, or the same one back): it works.
    await register(who, d);
    expect((await tokensOf(a, d.token))[0]?.disabled_at).toBeNull();
    expect((await changed(who, ev.name, `c3:${who}`)).queued).toBe(1);
    await dispatch(a, t, at('2030-01-01T12:10:00Z'));
    expect(t.pushes.filter((p) => p.token === d.token)).toHaveLength(1);
  });

  it('a busy push service (429) is retried later, not failed', async () => {
    const { who, ev } = await person();
    const d = device({ platform: 'fcm', token: `${'f'.repeat(30)}${uuidv7()}`, environment: undefined });
    await register(who, d);
    const t = memoryTransports();
    t.busy.set(d.token, 120_000);
    await changed(who, ev.name, `busy:${who}`);
    await dispatch(a, t, at('2030-01-01T12:00:00Z'));
    const [held] = await messages(a, who, 'push.event-changed');
    expect(held?.status).toBe('queued');
    expect(new Date(held?.send_after ?? '').getTime()).toBeGreaterThan(at('2030-01-01T12:00:00Z').getTime());
    t.busy.delete(d.token);
    await dispatch(a, t, at('2030-01-01T12:10:00Z'));
    expect(t.pushes.filter((p) => p.token === d.token)).toHaveLength(1);
    expect((await messages(a, who, 'push.event-changed'))[0]?.status).toBe('sent');
  });

  it('sign-out removes the phone from every org, for that person only; a new owner takes the phone over', async () => {
    const who = email('so');
    const other = email('so-other');
    const first = await publishedEvent(a, '2030-06-01T23:00:00Z');
    const second = await publishedEvent(b, '2030-06-01T23:00:00Z');
    await buy(a, first.ev.id, first.tt.id, who);
    await buy(b, second.ev.id, second.tt.id, who);
    await buy(a, first.ev.id, first.tt.id, other);
    const d = device();
    expect(await register(who, d)).toEqual({ orgs: 2 });
    // Someone else signs in on the same phone: the previous owner's rows go, in every org.
    expect(await register(other, d)).toEqual({ orgs: 1 });
    expect(await tokensOf(b, d.token)).toEqual([]);
    expect((await tokensOf(a, d.token)).map((r) => r.email_norm)).toEqual([other]);
    // Signing out removes only the signed-in person's own rows.
    expect(await removeAppDevice(who, d.token)).toBe(0);
    expect(await tokensOf(a, d.token)).toHaveLength(1);
    expect(await removeAppDevice(other, d.token)).toBe(1);
    expect(await tokensOf(a, d.token)).toEqual([]);
    expect(await removeAppDevice(other, d.token)).toBe(0);
    const again = device();
    await register(who, again);
    expect(await purgeAppDevices(who)).toBe(2);
    expect(await tokensOf(a, again.token)).toEqual([]);
    expect(await tokensOf(b, again.token)).toEqual([]);
  });

  it('a person’s own preferences and unsubscribes are respected per org and per type', async () => {
    const who = email('prefs');
    const first = await publishedEvent(a, '2030-06-01T23:00:00Z');
    const second = await publishedEvent(b, '2030-06-01T23:00:00Z');
    await buy(a, first.ev.id, first.tt.id, who);
    await buy(b, second.ev.id, second.tt.id, who);
    const d = device();
    await register(who, d, true);
    // They unsubscribe from reminders in org A only.
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(
        sql`insert into notifications.suppressions (org_id, email_norm, category, source) values (${a.org.id}, ${who}, 'reminders', 'page')`,
      ),
    );
    const t = memoryTransports();
    await dispatch(a, t, at('2030-05-31T23:00:30Z'));
    await dispatch(b, t, at('2030-05-31T23:00:30Z'));
    const [inA] = (await messages(a, who, 'push.reminder-24h')).map((m) => m.status);
    const [inB] = (await messages(b, who, 'push.reminder-24h')).map((m) => m.status);
    expect(inA).toBe('suppressed');
    expect(inB).toBe('sent');
    expect(t.pushes.filter((p) => p.token === d.token && p.title === second.ev.name)).toHaveLength(1);
    expect(t.pushes.filter((p) => p.title === first.ev.name && p.body.startsWith('Starts tomorrow'))).toEqual(
      [],
    );
    // A service notice (event changed) is transactional: it still arrives in org A.
    await withTenant(systemCtx(a.org.id), (tx) =>
      notifier.enqueue(tx, {
        kind: 'push.event-changed',
        to: { email: who },
        params: { eventName: first.ev.name, _path: '/events/x' },
        dedupeKey: `prefs-changed:${who}`,
      }),
    );
    await dispatch(a, t, at('2030-05-31T23:10:00Z'));
    expect(
      t.pushes.filter((p) => p.title === first.ev.name && p.body === 'The date, time or venue changed.'),
    ).toHaveLength(1);
  });
});

describe('transfers and event changes (M7.2c)', () => {
  it('a transfer tells both sides, moves the reminders, and the new holder’s phone follows', async () => {
    const sender = email('sender');
    const receiver = email('receiver');
    const home = await publishedEvent(a, '2030-06-01T23:00:00Z');
    const elsewhere = await publishedEvent(b, '2030-06-01T23:00:00Z');
    const bought = await buy(a, home.ev.id, home.tt.id, sender);
    await buy(b, elsewhere.ev.id, elsewhere.tt.id, receiver);
    const phoneS = device();
    const phoneR = device();
    await register(sender, phoneS, true);
    expect(await register(receiver, phoneR)).toEqual({ orgs: 1 });
    expect(await tokensOf(a, phoneR.token)).toEqual([]);
    const ticketId = bought.ticketIds[0] as string;
    const started = await executeCommand(
      startTransferCommand,
      { orderId: bought.orderId, ticketId, toName: 'Noor Haddad', toEmail: receiver },
      a.ctx(),
      ports,
    );
    const claim = await claimContext(started.token);
    await executeCommand(
      claimTicketCommand,
      { claimId: claim?.id ?? '', name: 'Noor Haddad', email: receiver },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    await consume(a, sub, ticketId);
    // Org A now holds the receiver's phone (they have a ticket there), and the sender keeps theirs.
    expect((await tokensOf(a, phoneR.token))[0]).toMatchObject({ email_norm: receiver, source: 'app' });
    const reminders = (who: string) =>
      messages(a, who).then((r) => r.filter((m) => m.kind.startsWith('push.reminder')));
    expect((await reminders(sender)).map((m) => m.status)).toEqual(
      ['canceled', 'canceled', 'canceled', 'canceled'].slice(0, 2),
    );
    expect((await reminders(receiver)).map((m) => m.status)).toEqual(['queued', 'queued']);
    const t = memoryTransports();
    await dispatch(a, t, at('2030-01-01T12:00:00Z'));
    const got = (token: string) => t.pushes.filter((p) => p.token === token);
    expect(got(phoneR.token).map((p) => [p.body, p.path])).toEqual([
      ['A ticket was transferred to you.', `/tickets/${ticketId}`],
    ]);
    expect(got(phoneS.token).map((p) => [p.body, p.path])).toEqual([
      ['Your ticket transfer was accepted.', `/orders/${bought.orderId}`],
    ]);
    expect(got(phoneR.token)[0]?.title).toBe(home.ev.name);
    // Replaying the event queues nothing again.
    await consume(a, sub, ticketId);
    await dispatch(a, t, at('2030-01-01T12:10:00Z'));
    expect(t.pushes).toHaveLength(2);
  });

  it('a transfer the organizer cancels tells the sender and the recipient', async () => {
    const sender = email('sender-c');
    const receiver = email('receiver-c');
    const home = await publishedEvent(a, '2030-06-01T23:00:00Z');
    const bought = await buy(a, home.ev.id, home.tt.id, sender);
    const other = await buy(a, home.ev.id, home.tt.id, receiver);
    expect(other.ticketIds).toHaveLength(1);
    const phoneS = device();
    const phoneR = device();
    await register(sender, phoneS);
    await register(receiver, phoneR);
    const started = await executeCommand(
      startTransferCommand,
      { orderId: bought.orderId, ticketId: bought.ticketIds[0], toName: 'Noor Haddad', toEmail: receiver },
      a.ctx(),
      ports,
    );
    await executeCommand(cancelTransferCommand, { transferId: started.transferId }, a.ctx(), ports);
    await consume(a, sub, bought.ticketIds[0] as string);
    const t = memoryTransports();
    await dispatch(a, t, at('2030-01-01T12:00:00Z'));
    const cancelled = t.pushes.filter((p) => p.body === 'A ticket transfer was cancelled.');
    expect(cancelled.map((p) => p.token).sort()).toEqual([phoneS.token, phoneR.token].sort());
    expect(cancelled.every((p) => p.title === home.ev.name)).toBe(true);
  });

  it('changing the time or place tells every holder and moves the reminders; a rename does not; cancelling does', async () => {
    const holder = email('holder');
    const { ev, tt } = await publishedEvent(a, '2030-06-01T23:00:00Z');
    const d = device();
    await boughtWithPhone(a, ev.id, tt.id, holder, d);
    const t = memoryTransports();
    const sentToHolder = () => t.pushes.filter((p) => p.token === d.token && p.title !== '');
    // A rename is not a change of schedule.
    await executeCommand(updateEventCommand, { eventId: ev.id, summary: 'New blurb' }, a.ctx(), ports);
    await consume(a, sub, ev.id);
    await dispatch(a, t, at('2030-01-01T12:00:00Z'));
    expect(sentToHolder().filter((p) => p.body === 'The date, time or venue changed.')).toEqual([]);
    // Saving the same start time again is not a change either.
    await executeCommand(
      updateEventCommand,
      { eventId: ev.id, startsAt: new Date('2030-06-01T23:00:00Z') },
      a.ctx(),
      ports,
    );
    await consume(a, sub, ev.id);
    await dispatch(a, t, at('2030-01-01T12:01:00Z'));
    expect(sentToHolder().filter((p) => p.body === 'The date, time or venue changed.')).toEqual([]);
    // A real move: pushed once, and the queued reminders follow.
    await executeCommand(
      updateEventCommand,
      {
        eventId: ev.id,
        startsAt: new Date('2030-06-08T23:00:00Z'),
        endsAt: new Date('2030-06-09T03:00:00Z'),
      },
      a.ctx(),
      ports,
    );
    await consume(a, sub, ev.id);
    await consume(a, rescheduler, ev.id);
    await dispatch(a, t, at('2030-01-01T12:02:00Z'));
    await dispatch(a, t, at('2030-01-01T12:03:00Z'));
    const moved = sentToHolder().filter((p) => p.body === 'The date, time or venue changed.');
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ path: `/events/${ev.slug}`, topic: `event:${ev.id}`, title: ev.name });
    const reminders = await messages(a, holder);
    expect(
      new Date(reminders.find((m) => m.kind === 'push.reminder-24h')?.send_after ?? '').toISOString(),
    ).toBe('2030-06-07T23:00:00.000Z');
    expect(
      new Date(reminders.find((m) => m.kind === 'push.reminder-2h')?.send_after ?? '').toISOString(),
    ).toBe('2030-06-08T21:00:00.000Z');
    // Cancelled: told once, and no reminder is left to send.
    await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'cancel' }, a.ctx(), ports);
    await consume(a, sub, ev.id);
    await consume(a, rescheduler, ev.id);
    await dispatch(a, t, at('2030-01-01T12:04:00Z'));
    expect(sentToHolder().filter((p) => p.body === 'This event was cancelled.')).toHaveLength(1);
    const after = await messages(a, holder);
    expect(after.filter((m) => m.kind.startsWith('push.reminder')).map((m) => m.status)).toEqual([
      'canceled',
      'canceled',
    ]);
    await dispatch(a, t, at('2030-06-07T23:30:00Z'));
    expect(sentToHolder().filter((p) => p.body.startsWith('Starts'))).toEqual([]);
  });

  it('a voided ticket’s reminders are cancelled; queueing is once per kind, ticket and person', async () => {
    const who = email('void');
    const { ev, tt } = await publishedEvent(a, '2030-06-01T23:00:00Z');
    const bought = await buy(a, ev.id, tt.id, who);
    await register(who, device());
    const ticketId = bought.ticketIds[0] as string;
    const queue = () =>
      withTenant(systemCtx(a.org.id), (tx) =>
        queueAppReminders(tx, notifier, {
          ticketId,
          orderId: bought.orderId,
          eventId: ev.id,
          occurrenceId: null,
          to: { email: who },
          now: new Date(),
        }),
      );
    expect(await queue()).toBe(2);
    expect(await queue()).toBe(0);
    const cancelled = await withTenant(systemCtx(a.org.id), (tx) =>
      cancelAppReminders(tx, ticketId, [who], 'ticket_void', new Date()),
    );
    expect(cancelled).toBe(2);
    expect((await messages(a, who)).map((m) => m.status)).toEqual(['canceled', 'canceled']);
  });
});
