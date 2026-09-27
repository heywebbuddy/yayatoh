import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  createNotifier,
  dispatchDue,
  importLegacyPushTokensTx,
  inboxCountQuery,
  inboxQuery,
  markInboxReadCommand,
  memoryTransports,
  myPreferencesQuery,
  orderMessagesQuery,
  previewTemplateQuery,
  resubscribeCommand,
  sendTestNotificationCommand,
  setMyPreferencesCommand,
  setTemplateOverrideCommand,
  unsubscribeCommand,
  unsubscribeInfo,
} from '@yayatoh/notifications';
import { orderByManageToken, refundMailer, startCheckoutCommand, ticketMailer } from '@yayatoh/orders';
import { consumeEvent, type PublishedEvent } from '@yayatoh/platform';
import { addMemberCommand, setSuspensionCommand } from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

const ORIGIN = 'https://app.yayatoh.test';
let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let free: { id: string };
const notifier = createNotifier();

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  // Far enough ahead that the 24 h reminder is in the future.
  const e = await executeCommand(
    createEventCommand,
    {
      name: 'Harbor Nights',
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

const buy = (email: string, locale = 'en') =>
  executeCommand(
    startCheckoutCommand,
    { eventId, items: [{ ticketTypeId: free.id, quantity: 2 }], buyer: { email, name: 'Rae Buyer' } },
    createCtx({ orgId: a.org.id, locale }),
    ports,
  );

async function paidEvent(orderId: string): Promise<PublishedEvent> {
  const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{ id: string; payload: unknown }>(
      sql`select id, payload from platform.domain_events where type = 'order.paid' and aggregate_id = ${orderId}`,
    ),
  );
  if (!row) throw new Error('no order.paid event');
  return {
    id: row.id,
    orgId: a.org.id,
    type: 'order.paid',
    version: 1,
    aggregateType: 'order',
    aggregateId: orderId,
    payload: row.payload,
    logSeq: 1,
  };
}

const messageRows = (orgId: string, where: ReturnType<typeof sql>) =>
  withTenant(systemCtx(orgId), (tx) =>
    tx.execute<{
      id: string;
      kind: string;
      status: string;
      reason: string | null;
      send_after: string;
      dedupe_key: string;
      channel: string;
    }>(
      sql`select id, kind, status, reason, send_after, dedupe_key, channel from notifications.messages where ${where}`,
    ),
  );

describe('notifications: the ticket email moves onto the core', () => {
  it('a paid order queues the tickets email, the 24 h reminder and the sales alert; one dispatch sends it', async () => {
    const r = await buy('rae@example.test');
    const mailer = ticketMailer({ notifier, appOrigin: ORIGIN });
    expect(await consumeEvent(mailer, await paidEvent(r.order.id))).toBe(true);

    const rows = await messageRows(a.org.id, sql`order_id = ${r.order.id}`);
    // The owner switched sales email on in the fixture: their alert is logged against the order too.
    expect(rows.map((m) => m.kind).sort()).toEqual(['events.reminder', 'orders.tickets', 'sales.order_paid']);
    const reminder = rows.find((m) => m.kind === 'events.reminder');
    expect(new Date(reminder?.send_after ?? '').toISOString()).toBe('2030-05-31T23:00:00.000Z');
    // Params (the manage link) are stored encrypted, never in clear.
    const [raw] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ c: string }>(
        sql`select params_ciphertext as c from notifications.messages where order_id = ${r.order.id} limit 1`,
      ),
    );
    expect(raw?.c).toMatch(/^local\.v1\./);
    expect(raw?.c).not.toContain(r.manageToken);

    const { transports, emails } = memoryTransports();
    const result = await dispatchDue(a.org.id, { transports, appOrigin: ORIGIN });
    const mine = emails.filter((e) => e.to === 'rae@example.test');
    expect(mine).toHaveLength(1);
    expect(result.sent).toBeGreaterThanOrEqual(1);
    expect(mine[0]).toMatchObject({
      subject: 'Tickets from Alpha Events', // the fixture's org override for orders.tickets (en)
      from: { name: 'Alpha Events', address: 'notifications@mail.yayatoh.com' },
    });
    expect(mine[0]?.html).toContain(`${ORIGIN}/orders/${r.manageToken}`);
    expect(mine[0]?.text).toContain(`${ORIGIN}/orders/${r.manageToken}`);
    // Transactional mail has no unsubscribe header or link.
    expect(mine[0]?.headers['List-Unsubscribe']).toBeUndefined();

    // The per-order log: the organizer's page and the buyer's page.
    const log = await executeQuery(orderMessagesQuery, { orderId: r.order.id }, a.ctx(), ports);
    expect(log.find((m) => m.kind === 'orders.tickets')).toMatchObject({
      status: 'sent',
      channel: 'email',
      recipient: 'rae@example.test',
      subject: 'Tickets from Alpha Events',
    });
    expect(log.find((m) => m.kind === 'events.reminder')).toMatchObject({ status: 'scheduled' });
    const page = await orderByManageToken(r.manageToken);
    expect(page?.messages.map((m) => [m.kind, m.status]).sort()).toEqual([
      ['events.reminder', 'scheduled'],
      ['orders.tickets', 'sent'],
    ]);
    // The viewer may read orders; another org sees nothing.
    expect(
      await executeQuery(orderMessagesQuery, { orderId: r.order.id }, userCtx(a.viewerId, a.org.id), ports),
    ).toHaveLength(2);
    expect(await executeQuery(orderMessagesQuery, { orderId: r.order.id }, b.ctx(), ports)).toEqual([]);
  });

  it('one reminder per buyer and event, however many orders they place', async () => {
    const mailer = ticketMailer({ notifier, appOrigin: ORIGIN });
    for (const _ of [1, 2]) {
      const r = await buy('twice@example.test');
      await consumeEvent(mailer, await paidEvent(r.order.id));
    }
    const reminders = await messageRows(
      a.org.id,
      sql`kind = 'events.reminder' and dedupe_key = ${`event-reminder:${eventId}:twice@example.test`}`,
    );
    expect(reminders).toHaveLength(1);
    expect(
      await messageRows(a.org.id, sql`kind = 'orders.tickets' and dedupe_key like 'order-tickets:%'`),
    ).not.toHaveLength(0);
  });

  it('a duplicated job sends once: concurrent duplicate events queue one row, concurrent dispatchers send it once', async () => {
    const r = await buy('dup@example.test');
    const original = await paidEvent(r.order.id);
    const mailer = ticketMailer({ notifier, appOrigin: ORIGIN });
    // The same order.paid delivered twice under different event ids (a replayed relay), at once.
    await Promise.all([
      consumeEvent(mailer, original),
      consumeEvent(mailer, { ...original, id: uuidv7() }),
      consumeEvent(mailer, { ...original, id: uuidv7() }),
    ]);
    const rows = await messageRows(a.org.id, sql`order_id = ${r.order.id} and kind = 'orders.tickets'`);
    expect(rows).toHaveLength(1);

    // Two workers dispatch at the same moment with a slow provider: the row goes out once.
    const { transports, emails } = memoryTransports({ delayMs: 150 });
    const deps = { transports, appOrigin: ORIGIN };
    await Promise.all([
      dispatchDue(a.org.id, deps),
      dispatchDue(a.org.id, deps),
      dispatchDue(a.org.id, deps),
    ]);
    expect(emails.filter((e) => e.to === 'dup@example.test')).toHaveLength(1);
    // A later tick finds nothing left to send for it.
    await dispatchDue(a.org.id, deps);
    expect(emails.filter((e) => e.to === 'dup@example.test')).toHaveLength(1);
    const [after] = await messageRows(a.org.id, sql`id = ${rows[0]?.id}`);
    expect(after?.status).toBe('sent');
  });

  it('a refund emails the buyer once', async () => {
    const r = await buy('refund@example.test');
    const refundId = uuidv7();
    const event: PublishedEvent = {
      id: uuidv7(),
      orgId: a.org.id,
      type: 'order.refunded',
      version: 1,
      aggregateType: 'order',
      aggregateId: r.order.id,
      payload: {
        orgId: a.org.id,
        orderId: r.order.id,
        refundId,
        amountMinor: 1250,
        currency: 'USD',
        tickets: 1,
        fully: false,
      },
      logSeq: 1,
    };
    const sub = refundMailer({ notifier, appOrigin: ORIGIN });
    await consumeEvent(sub, event);
    await consumeEvent(sub, { ...event, id: uuidv7() });
    const { transports, emails } = memoryTransports();
    await dispatchDue(a.org.id, { transports, appOrigin: ORIGIN });
    const mine = emails.filter((e) => e.to === 'refund@example.test');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.subject).toBe('Your refund for Harbor Nights');
    expect(mine[0]?.text).toContain('$12.50');
  });
});

const orgMessage = (orgId: string, email: string, key: string, timeZone = 'UTC') =>
  withTenant(systemCtx(orgId), (tx) =>
    notifier.enqueue(tx, {
      kind: 'attendees.message',
      to: { email, timeZone },
      params: { subject: 'Parking', body: 'Use lot C.', name: 'Guest', eventName: 'Harbor Nights' },
      dedupeKey: key,
    }),
  );

const NOON_UTC = () => new Date('2030-03-01T12:00:00Z');

describe('notifications: unsubscribe (RFC 8058) and transactional separation', () => {
  it('event updates carry one-click headers; unsubscribing suppresses them but transactional mail still sends', async () => {
    const email = `list-${uuidv7().slice(-6)}@example.test`;
    await orgMessage(a.org.id, email, `u1:${email}`);
    const { transports, emails } = memoryTransports();
    await dispatchDue(a.org.id, { transports, appOrigin: ORIGIN, now: NOON_UTC });
    const first = emails.find((e) => e.to === email);
    expect(first?.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const oneClick = /^<(.+)>$/.exec(first?.headers['List-Unsubscribe'] ?? '')?.[1] ?? '';
    expect(oneClick).toMatch(new RegExp(`^${ORIGIN}/api/unsubscribe/[0-9a-f-]{36}~`));
    const token = oneClick.split('/').pop() ?? '';
    expect(first?.html).toContain(`${ORIGIN}/unsubscribe/${token}`);

    const info = await unsubscribeInfo(token);
    expect(info).toMatchObject({ orgName: 'Alpha Events', category: 'event_updates', unsubscribed: false });
    expect(info?.email).toMatch(/^l•+@example\.test$/);
    const anon = createCtx({ orgId: a.org.id });
    expect(await executeCommand(unsubscribeCommand, { token, source: 'one_click' }, anon, ports)).toEqual({
      category: 'event_updates',
      changed: true,
    });
    // Idempotent.
    expect(
      (await executeCommand(unsubscribeCommand, { token, source: 'one_click' }, anon, ports)).changed,
    ).toBe(false);
    expect((await unsubscribeInfo(token))?.unsubscribed).toBe(true);

    // The next event update to that address is suppressed; a transactional one still goes out.
    await orgMessage(a.org.id, email.toUpperCase(), `u2:${email}`);
    await withTenant(systemCtx(a.org.id), (tx) =>
      notifier.enqueue(tx, {
        kind: 'ticketing.holder-link',
        to: { email },
        params: { url: `${ORIGIN}/my-tickets/x`, eventName: 'Harbor Nights' },
        dedupeKey: `u3:${email}`,
      }),
    );
    await dispatchDue(a.org.id, { transports, appOrigin: ORIGIN, now: NOON_UTC });
    const [second] = await messageRows(a.org.id, sql`dedupe_key = ${`u2:${email}`}`);
    expect(second).toMatchObject({ status: 'suppressed', reason: 'unsubscribed' });
    expect(emails.filter((e) => e.to === email).map((e) => e.subject)).toEqual([
      'Parking',
      'Your link to your tickets for Harbor Nights',
    ]);

    // Subscribe again from the confirmation page.
    await executeCommand(resubscribeCommand, { token }, anon, ports);
    await orgMessage(a.org.id, email, `u4:${email}`);
    await dispatchDue(a.org.id, { transports, appOrigin: ORIGIN, now: NOON_UTC });
    expect(emails.filter((e) => e.to === email)).toHaveLength(3);
  });

  it('refuses forged or foreign tokens', async () => {
    const email = `forge-${uuidv7().slice(-6)}@example.test`;
    await orgMessage(a.org.id, email, `f1:${email}`);
    const { transports, emails } = memoryTransports();
    await dispatchDue(a.org.id, { transports, appOrigin: ORIGIN, now: NOON_UTC });
    const token =
      emails
        .find((e) => e.to === email)
        ?.headers['List-Unsubscribe']?.split('/')
        .pop()
        ?.slice(0, -1) ?? '';
    const [id, mac] = token.split('~');
    expect(await unsubscribeInfo(`${id}~${mac?.slice(0, -2)}xx`)).toBeNull();
    expect(await unsubscribeInfo(`${uuidv7()}~${mac}`)).toBeNull();
    // A valid token used under another org's context finds nothing (RLS).
    await expect(
      executeCommand(unsubscribeCommand, { token, source: 'page' }, createCtx({ orgId: b.org.id }), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('notifications: policy gate', () => {
  it('holds non-urgent messages in quiet hours (recipient timezone) until 08:00 local; urgent ones go now', async () => {
    const email = `quiet-${uuidv7().slice(-6)}@example.test`;
    // 03:30 UTC = 22:30 in Chicago (CDT, UTC-5): quiet there, not in Tokyo (12:30).
    const late = () => new Date('2030-06-10T03:30:00Z');
    await orgMessage(a.org.id, email, `q1:${email}`, 'America/Chicago');
    await orgMessage(a.org.id, `tokyo-${email}`, `q2:${email}`, 'Asia/Tokyo');
    await withTenant(systemCtx(a.org.id), (tx) =>
      notifier.enqueue(tx, {
        kind: 'ticketing.claim-link',
        to: { email, timeZone: 'America/Chicago' },
        params: { url: `${ORIGIN}/claim/x`, eventName: 'Harbor Nights' },
        dedupeKey: `q3:${email}`,
      }),
    );
    const { transports, emails } = memoryTransports();
    const res = await dispatchDue(a.org.id, { transports, appOrigin: ORIGIN, now: late });
    expect(res.held).toBeGreaterThanOrEqual(1);
    const [held] = await messageRows(a.org.id, sql`dedupe_key = ${`q1:${email}`}`);
    expect(held).toMatchObject({ status: 'queued', reason: 'quiet_hours' });
    expect(new Date(held?.send_after ?? '').toISOString()).toBe('2030-06-10T13:00:00.000Z'); // 08:00 CDT
    expect(emails.map((e) => e.to)).toContain(`tokyo-${email}`);
    expect(emails.find((e) => e.to === email)?.subject).toBe('A ticket for Harbor Nights is waiting for you');
    // At 08:00 local it goes out.
    await dispatchDue(a.org.id, {
      transports,
      appOrigin: ORIGIN,
      now: () => new Date('2030-06-10T13:00:00Z'),
    });
    expect(emails.filter((e) => e.to === email)).toHaveLength(2);
  });

  it('the staff kill switch holds optional messages; tickets still send', async () => {
    const email = `paused-${uuidv7().slice(-6)}@example.test`;
    await executeCommand(
      setSuspensionCommand,
      { kind: 'pause_messaging', paused: true, reason: 'abuse report' },
      systemCtx(b.org.id),
      ports,
    );
    try {
      await orgMessage(b.org.id, email, `p1:${email}`);
      await withTenant(systemCtx(b.org.id), (tx) =>
        notifier.enqueue(tx, {
          kind: 'ticketing.holder-link',
          to: { email },
          params: { url: `${ORIGIN}/my-tickets/x`, eventName: 'Gala' },
          dedupeKey: `p2:${email}`,
        }),
      );
      const { transports, emails } = memoryTransports();
      await dispatchDue(b.org.id, { transports, appOrigin: ORIGIN, now: NOON_UTC });
      expect(emails.filter((e) => e.to === email).map((e) => e.subject)).toEqual([
        'Your link to your tickets for Gala',
      ]);
      const [held] = await messageRows(b.org.id, sql`dedupe_key = ${`p1:${email}`}`);
      expect(held).toMatchObject({ status: 'queued', reason: 'messaging_paused' });
    } finally {
      await executeCommand(
        setSuspensionCommand,
        { kind: 'pause_messaging', paused: false, reason: 'resolved' },
        systemCtx(b.org.id),
        ports,
      );
    }
  });

  it('a provider error retries with backoff and stays queued', async () => {
    const email = `flaky-${uuidv7().slice(-6)}@example.test`;
    await orgMessage(a.org.id, email, `e1:${email}`);
    const failing = {
      email: {
        async send(m: { to: string }) {
          if (m.to === email) throw new Error('SES throttled');
          return { providerMessageId: 'ok' };
        },
      },
    };
    await dispatchDue(a.org.id, { transports: failing, appOrigin: ORIGIN, now: NOON_UTC });
    const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ status: string; attempts: number; last_error: string; reason: string }>(
        sql`select status, attempts, last_error, reason from notifications.messages where dedupe_key = ${`e1:${email}`}`,
      ),
    );
    expect(row).toMatchObject({
      status: 'queued',
      attempts: 1,
      last_error: 'SES throttled',
      reason: 'retrying',
    });
  });
});

describe('notifications: member inbox and preferences', () => {
  it('sales alerts reach the sales team (not viewers); members read and mark only their own', async () => {
    const managerId = uuidv7();
    await executeCommand(addMemberCommand, { userId: managerId, role: 'manager' }, a.ctx(), ports);
    const key = `sale:${uuidv7()}`;
    await withTenant(systemCtx(a.org.id), (tx) =>
      notifier.notifyMembers(tx, {
        kind: 'sales.order_paid',
        params: { name: 'Ada', eventName: 'Harbor Nights', count: 2, amountMinor: 5000, currency: 'USD' },
        dedupeKey: key,
        href: '/e/harbor/orders/x',
      }),
    );
    const owner = a.ctx();
    const manager = userCtx(managerId, a.org.id);
    const viewer = userCtx(a.viewerId, a.org.id);
    const ownerInbox = await executeQuery(inboxQuery, {}, owner, ports);
    const item = ownerInbox.items.find((i) => i.params.name === 'Ada');
    expect(item).toMatchObject({ kind: 'sales.order_paid', read: false, href: '/e/harbor/orders/x' });
    expect((await executeQuery(inboxQuery, {}, manager, ports)).items.map((i) => i.params.name)).toContain(
      'Ada',
    );
    expect((await executeQuery(inboxQuery, {}, viewer, ports)).items.map((i) => i.params.name)).not.toContain(
      'Ada',
    );

    // The manager cannot mark the owner's item; the owner can.
    const before = (await executeQuery(inboxCountQuery, {}, owner, ports)).unread;
    expect(
      (await executeCommand(markInboxReadCommand, { ids: [item?.id as string] }, manager, ports)).marked,
    ).toBe(0);
    const marked = await executeCommand(markInboxReadCommand, { ids: [item?.id as string] }, owner, ports);
    expect(marked).toEqual({ marked: 1, unread: before - 1 });
    await executeCommand(markInboxReadCommand, { all: true }, manager, ports);
    expect((await executeQuery(inboxCountQuery, {}, manager, ports)).unread).toBe(0);
    // Another org's member sees none of it.
    expect(
      (await executeQuery(inboxQuery, {}, b.ctx(), ports)).items.map((i) => i.params.name),
    ).not.toContain('Ada');
  });

  it('preferences default sensibly, persist per user, and turning in-app off stops inbox items', async () => {
    const userId = uuidv7();
    await executeCommand(addMemberCommand, { userId, role: 'finance' }, a.ctx(), ports);
    const me = userCtx(userId, a.org.id);
    const grid = await executeQuery(myPreferencesQuery, {}, me, ports);
    expect(grid).toHaveLength(12);
    expect(grid.find((p) => p.category === 'sales' && p.channel === 'in_app')).toMatchObject({
      enabled: true,
      isDefault: true,
    });
    expect(grid.find((p) => p.category === 'marketing' && p.channel === 'email')?.enabled).toBe(false);
    await executeCommand(
      setMyPreferencesCommand,
      { preferences: [{ category: 'sales', channel: 'in_app', enabled: false }] },
      me,
      ports,
    );
    expect(
      (await executeQuery(myPreferencesQuery, {}, me, ports)).find(
        (p) => p.category === 'sales' && p.channel === 'in_app',
      ),
    ).toMatchObject({ enabled: false, isDefault: false });
    // The owner's preferences are untouched.
    expect(
      (await executeQuery(myPreferencesQuery, {}, a.ctx(), ports)).find(
        (p) => p.category === 'sales' && p.channel === 'in_app',
      )?.enabled,
    ).toBe(true);
    await withTenant(systemCtx(a.org.id), (tx) =>
      notifier.notifyMembers(tx, {
        kind: 'sales.order_paid',
        params: { name: 'Bo', eventName: 'Harbor Nights', count: 1, amountMinor: 100, currency: 'USD' },
        dedupeKey: `sale:${uuidv7()}`,
      }),
    );
    expect((await executeQuery(inboxQuery, {}, me, ports)).items.map((i) => i.params.name)).not.toContain(
      'Bo',
    );
    // A test notification always arrives (transactional), and a system actor has no inbox.
    expect((await executeCommand(sendTestNotificationCommand, {}, me, ports)).queued).toBe(1);
    expect((await executeQuery(inboxQuery, { unreadOnly: true }, me, ports)).items[0]?.kind).toBe(
      'notifications.test',
    );
    await expect(executeQuery(inboxQuery, {}, systemCtx(a.org.id), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('member emails resolve through the identity port and honour the email toggle', async () => {
    const userId = uuidv7();
    await executeCommand(addMemberCommand, { userId, role: 'owner' }, b.ctx(), ports);
    const me = userCtx(userId, b.org.id);
    await executeCommand(
      setMyPreferencesCommand,
      { preferences: [{ category: 'sales', channel: 'email', enabled: true }] },
      me,
      ports,
    );
    await withTenant(systemCtx(b.org.id), (tx) =>
      notifier.notifyMembers(tx, {
        kind: 'sales.order_paid',
        params: { name: 'Cy', eventName: 'Gala', count: 1, amountMinor: 100, currency: 'USD' },
        dedupeKey: `sale:${uuidv7()}`,
        href: '/e/gala/orders/1',
      }),
    );
    const { transports, emails } = memoryTransports();
    await dispatchDue(b.org.id, {
      transports,
      appOrigin: ORIGIN,
      userEmails: async (ids) => new Map(ids.map((id) => [id, `${id}@members.test`])),
    });
    expect(emails.find((e) => e.to === `${userId}@members.test`)?.subject).toBe('New order: Cy');
  });
});

describe('notifications: push', () => {
  it('a migrated legacy token receives push on its real platform; a dead token is disabled', async () => {
    const userId = uuidv7();
    await withTenant(systemCtx(a.org.id), (tx) =>
      importLegacyPushTokensTx(tx, a.org.id, [
        { userId, fcmToken: `fcm-legacy-${userId}`, apnToken: `apns-legacy-${userId}` },
      ]),
    );
    // Re-running the import is harmless.
    expect(
      await withTenant(systemCtx(a.org.id), (tx) =>
        importLegacyPushTokensTx(tx, a.org.id, [{ userId, fcmToken: `fcm-legacy-${userId}` }]),
      ),
    ).toBe(0);
    await withTenant(systemCtx(a.org.id), (tx) =>
      notifier.enqueue(tx, {
        kind: 'events.reminder',
        to: { userId, email: `push-${userId}@example.test`, timeZone: 'UTC' },
        params: {
          url: `${ORIGIN}/orders/x`,
          name: 'Pat',
          eventName: 'Harbor Nights',
          startsAt: '2030-06-01T23:00:00.000Z',
          timeZone: 'America/Chicago',
          venue: 'Pier 9',
        },
        dedupeKey: `push:${userId}`,
      }),
    );
    const { transports, pushes, invalid } = memoryTransports();
    invalid.add(`fcm-legacy-${userId}`);
    await dispatchDue(a.org.id, { transports, appOrigin: ORIGIN, now: NOON_UTC });
    const mine = pushes.filter((p) => p.token.endsWith(userId));
    expect(mine).toEqual([
      expect.objectContaining({
        platform: 'apns',
        token: `apns-legacy-${userId}`,
        title: 'Tomorrow: Harbor Nights',
        url: `${ORIGIN}/orders/x`,
      }),
    ]);
    const [fcm] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ disabled_at: string | null }>(
        sql`select disabled_at from notifications.push_tokens where token = ${`fcm-legacy-${userId}`}`,
      ),
    );
    expect(fcm?.disabled_at).not.toBeNull();
  });
});

describe('notifications: org template overrides', () => {
  it('owners override copy per locale with the kind’s placeholders; viewers cannot', async () => {
    await expect(
      executeCommand(
        setTemplateOverrideCommand,
        { kind: 'orders.refund', locale: 'es', subject: 'Reembolso: {eventName}', intro: null },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        setTemplateOverrideCommand,
        { kind: 'orders.refund', locale: 'es', subject: 'Hola {password}', intro: null },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'unknown_placeholder' } });
    await expect(
      executeCommand(
        setTemplateOverrideCommand,
        { kind: 'orders.refund', locale: 'es', subject: 'Roto {eventName', intro: null },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'invalid_syntax' } });
    await executeCommand(
      setTemplateOverrideCommand,
      {
        kind: 'orders.refund',
        locale: 'es',
        subject: 'Reembolso: {eventName}',
        intro: 'Te devolvimos {amount}.',
      },
      a.ctx(),
      ports,
    );
    const preview = await executeQuery(
      previewTemplateQuery,
      { kind: 'orders.refund', locale: 'es' },
      a.ctx(),
      ports,
    );
    expect(preview.subject).toBe('Reembolso: Lakeside Jazz Night');
    expect(preview.text).toContain('Te devolvimos 45,00');
    // The other org keeps the default copy.
    const other = await executeQuery(
      previewTemplateQuery,
      { kind: 'orders.refund', locale: 'es' },
      b.ctx(),
      ports,
    );
    expect(other.subject).toBe('Tu reembolso de Lakeside Jazz Night');
    const ar = await executeQuery(
      previewTemplateQuery,
      { kind: 'orders.tickets', locale: 'ar' },
      b.ctx(),
      ports,
    );
    expect(ar.dir).toBe('rtl');
    expect(ar.html).toContain('dir="rtl"');
  });
});
