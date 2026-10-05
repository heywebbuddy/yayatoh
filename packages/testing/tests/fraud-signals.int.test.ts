import {
  chatReportSignals,
  checkoutRiskSignals,
  createCheckpointCommand,
  deviceContext,
  deviceManifestQuery,
  enrollDeviceCommand,
  fraudSignalAlerts,
  listFraudSignalsQuery,
  orderSignalsQuery,
  resolveFraudSignalCommand,
  scanTicketCommand,
  syncScansCommand,
} from '@yayatoh/checkin';
import { legacyPayloadHash } from '@yayatoh/checkin-engine';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { contactReportCommand, reportThreadCommand, threadToken } from '@yayatoh/messaging';
import {
  createNotifier,
  dispatchDue,
  memoryTransports,
  setMyPreferencesCommand,
} from '@yayatoh/notifications';
import { orderByManageToken, recordCheckoutBlockCommand, startCheckoutCommand } from '@yayatoh/orders';
import { consumeEvent, emitEvents, eventKey, recentEventsTx } from '@yayatoh/platform';
import { addMemberCommand } from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M1.9e: one fraud-signal model fed through the outbox (checkout risk outcomes, chat reports, the
 * door), the order timeline, triage with a note, alerts (deduplicated per subject and hour,
 * preferences and quiet hours), the door's open-signal count, and migrated tickets offline.
 */
const ORIGIN = 'https://app.yayatoh.test';
const DOORS = new Date('2027-12-01T20:00:00Z'); // 2 pm in Chicago, inside the event window
let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let typeId: string;
let north: string;
let south: string;
let managerId: string;
const notifier = createNotifier();
const subscribers = () => [checkoutRiskSignals(), chatReportSignals(), fraudSignalAlerts({ notifier })];

/** Run this org's recent events through the signal subscribers until nothing new (like the worker). */
async function drain(orgId = a.org.id) {
  const subs = subscribers();
  const types = [...new Set(subs.flatMap((s) => s.events.map((e) => e.split('@')[0] as string)))];
  for (let pass = 0; pass < 4; pass++) {
    const events = await withTenant(systemCtx(orgId), (tx) => recentEventsTx(tx, orgId, types, 3_600_000));
    let fresh = 0;
    for (const e of events)
      for (const s of subs) if (s.events.includes(eventKey(e)) && (await consumeEvent(s, e))) fresh += 1;
    if (fresh === 0) return;
  }
}

const anon = (orgId = a.org.id) => createCtx({ orgId });

async function checkout(email: string, riskReview: string[] = [], quantity = 1) {
  const r = await executeCommand(
    startCheckoutCommand,
    { eventId, items: [{ ticketTypeId: typeId, quantity }], buyer: { email, name: 'Rae Risk' }, riskReview },
    anon(),
    ports,
  );
  const order = await orderByManageToken(r.manageToken);
  if (!order) throw new Error('no order');
  return { orderId: r.order.id, tickets: order.tickets };
}

async function signalRows(where: ReturnType<typeof sql>, orgId = a.org.id) {
  return withTenant(systemCtx(orgId), (tx) =>
    tx.execute<{
      id: string;
      kind: string;
      severity: string;
      source: string;
      order_id: string | null;
      contact_id: string | null;
      thread_id: string | null;
      event_id: string | null;
      status: string;
      alerted_at: string | null;
      detail: Record<string, unknown>;
    }>(sql`select * from checkin.fraud_signals where ${where} order by raised_at, id`),
  );
}

async function alertsFor(userId: string, orgId = a.org.id) {
  return withTenant(systemCtx(orgId), (tx) =>
    tx.execute<{ id: string; href: string | null; params: Record<string, string> }>(
      sql`select id, href, params from notifications.inbox_items where user_id = ${userId} and kind = 'security.fraud_signal' order by created_at`,
    ),
  );
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const e = await executeCommand(
    createEventCommand,
    {
      name: 'Signals gala',
      timezone: 'America/Chicago',
      startsAt: '2027-12-01T15:00:00Z',
      endsAt: '2027-12-02T04:00:00Z',
    },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  typeId = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'GA', priceMinor: 0, quantityTotal: 200, maxPerOrder: 10 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  const cp = async (name: string) =>
    (await executeCommand(createCheckpointCommand, { eventId, name, kind: 'entrance' }, a.ctx(), ports)).id;
  north = await cp('North gate');
  south = await cp('South gate');
  // A manager hears about fraud too (the security team: owner, admin, manager).
  managerId = uuidv7();
  await executeCommand(addMemberCommand, { userId: managerId, role: 'manager' }, a.ctx(), ports);
});
afterAll(closePools);

describe('checkout risk → signals (outbox)', () => {
  it('a reviewed checkout raises one signal on its order, once per source event, and alerts the team once', async () => {
    const email = `velocity.${uuidv7().slice(-8)}@example.test`;
    const { orderId } = await checkout(email, ['email_velocity_review']);
    await drain();
    await drain(); // a replay changes nothing
    const rows = await signalRows(sql`order_id = ${orderId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'purchase_velocity',
      severity: 'high',
      source: 'checkout',
      event_id: eventId,
      status: 'open',
    });
    expect(rows[0]?.contact_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[0]?.alerted_at).not.toBeNull();
    // The same source event handled again by a fresh consumer still raises nothing new.
    const [ev] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string; type: string; version: number; payload: unknown; aggregate_id: string }>(
        sql`select id, type, version, payload, aggregate_id from platform.domain_events where type = 'order.risk_flagged' and aggregate_id = ${orderId}`,
      ),
    );
    if (!ev) throw new Error('no risk_flagged event');
    await withTenant(systemCtx(a.org.id), (tx) =>
      checkoutRiskSignals().handle(tx, {
        id: ev.id,
        orgId: a.org.id,
        type: ev.type,
        version: ev.version,
        aggregateType: 'order',
        aggregateId: ev.aggregate_id,
        payload: ev.payload,
        logSeq: 0,
      }),
    );
    expect(await signalRows(sql`order_id = ${orderId}`)).toHaveLength(1);
    // No buyer details travel on the outbox.
    expect(JSON.stringify(ev.payload)).not.toContain(email);

    // The owner and the manager are alerted, linked to the order; the viewer is not.
    const owner = await alertsFor(a.ownerId);
    const mine = owner.filter((x) => x.href?.endsWith(`/orders/${orderId}`));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.params).toMatchObject({ signal: 'purchase_velocity', eventName: 'Signals gala' });
    expect((await alertsFor(managerId)).filter((x) => x.href?.endsWith(`/orders/${orderId}`))).toHaveLength(
      1,
    );
    expect(await alertsFor(a.viewerId)).toHaveLength(0);

    // The order timeline shows it to anyone who reads orders (the viewer too), not another org.
    for (const ctx of [a.ctx(), userCtx(a.viewerId, a.org.id)]) {
      const list = await executeQuery(orderSignalsQuery, { orderId }, ctx, ports);
      expect(list.map((s) => [s.kind, s.source, s.status])).toEqual([
        ['purchase_velocity', 'checkout', 'open'],
      ]);
      expect(list[0]?.detail.rules).toEqual(['email_velocity_review']);
    }
    expect(await executeQuery(orderSignalsQuery, { orderId }, b.ctx(), ports)).toEqual([]);
  });

  it('a country mismatch is medium: on the order, no alert', async () => {
    const { orderId } = await checkout(`abroad.${uuidv7().slice(-8)}@example.test`, [
      'country_mismatch_review',
    ]);
    await drain();
    const [row] = await signalRows(sql`order_id = ${orderId}`);
    expect(row).toMatchObject({ kind: 'country_mismatch', severity: 'medium', alerted_at: null });
    expect((await alertsFor(a.ownerId)).filter((x) => x.href?.endsWith(orderId))).toHaveLength(0);
  });

  it('an order without review raises nothing', async () => {
    const { orderId } = await checkout(`calm.${uuidv7().slice(-8)}@example.test`);
    await drain();
    expect(await signalRows(sql`order_id = ${orderId}`)).toHaveLength(0);
  });

  it('blocked checkouts: card testing vs order velocity, one signal per buyer per hour, audited, no email on the outbox', async () => {
    const email = `tester.${uuidv7().slice(-8)}@example.test`;
    await checkout(email); // the buyer exists as a contact
    const block = (rules: string[]) =>
      executeCommand(
        recordCheckoutBlockCommand,
        { eventId, email: email.toUpperCase(), rules, emailOrders: 6, paymentFailures: 5 },
        anon(),
        ports,
      );
    await block(['payment_failures_block']);
    await block(['payment_failures_block']);
    await block(['email_velocity_block']);
    await drain();
    const [contact] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string }>(sql`select id from crm.contacts where email_norm = ${email}`),
    );
    const rows = await signalRows(
      sql`contact_id = ${contact?.id ?? ''} and source = 'checkout' and order_id is null`,
    );
    expect(rows.map((r) => [r.kind, r.severity])).toEqual([
      ['card_testing', 'high'],
      ['checkout_blocked', 'high'],
    ]);
    expect(rows[0]?.detail).toMatchObject({ rules: 'payment_failures_block', orders: 6, failures: 5 });
    const events = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ payload: unknown }>(
        sql`select payload from platform.domain_events where type = 'order.checkout_blocked' and payload->>'contactId' = ${contact?.id ?? ''}`,
      ),
    );
    expect(events).toHaveLength(3);
    for (const e of events) expect(JSON.stringify(e.payload)).not.toContain('@');
    const audit = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.audit_events where action = 'order.checkout_blocked' and target_id = ${eventId}`,
      ),
    );
    expect(audit[0]?.n).toBeGreaterThanOrEqual(3);
    // One alert per subject (the contact) per hour, though two high signals were raised.
    const contactAlerts = (await alertsFor(a.ownerId)).filter(
      (x) => x.params.signal === 'card_testing' || x.params.signal === 'checkout_blocked',
    );
    expect(contactAlerts).toHaveLength(1);
    // Bad input is refused before anything is recorded.
    await expect(
      executeCommand(
        recordCheckoutBlockCommand,
        { eventId, email, rules: ['DROP TABLE'], emailOrders: 1, paymentFailures: 0 },
        anon(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('alerts are deduplicated per subject within the hour; another subject alerts', async () => {
    const { orderId } = await checkout(`dup.${uuidv7().slice(-8)}@example.test`, ['email_velocity_review']);
    await drain();
    // A second high signal about the same order (another source event) within the hour.
    await withTenant(systemCtx(a.org.id), (tx) =>
      emitEvents(tx, systemCtx(a.org.id), [
        {
          type: 'order.risk_flagged',
          version: 1,
          aggregateType: 'order',
          aggregateId: orderId,
          payload: { orgId: a.org.id, orderId, eventId, contactId: null, rules: ['email_velocity_review'] },
        },
      ]),
    );
    await drain();
    expect(await signalRows(sql`order_id = ${orderId}`)).toHaveLength(2);
    expect((await alertsFor(a.ownerId)).filter((x) => x.href?.endsWith(orderId))).toHaveLength(1);
    const other = await checkout(`dup2.${uuidv7().slice(-8)}@example.test`, ['email_velocity_review']);
    await drain();
    expect((await alertsFor(a.ownerId)).filter((x) => x.href?.endsWith(other.orderId))).toHaveLength(1);
  });
});

describe('chat reports → signals (outbox)', () => {
  const thread = async () => {
    const [t] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string; last_event_id: string | null }>(
        sql`select id, last_event_id from messaging.threads order by created_at limit 1`,
      ),
    );
    if (!t) throw new Error('no thread');
    return t;
  };

  it('an organizer abuse report raises a high signal about the contact on the thread’s event and alerts; spam is medium', async () => {
    const t = await thread();
    await executeCommand(
      reportThreadCommand,
      { threadId: t.id, reason: 'abuse', note: 'Threats' },
      a.ctx(),
      ports,
    );
    await drain();
    const rows = await signalRows(sql`thread_id = ${t.id} and kind = 'chat_abuse' and severity = 'high'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'chat', event_id: t.last_event_id });
    expect(rows[0]?.contact_id).toMatch(/^[0-9a-f-]{36}$/);
    // Only the reason leaves: never the reporter's note.
    expect(rows[0]?.detail).toEqual({ reason: 'abuse' });
    const list = await executeQuery(
      listFraudSignalsQuery,
      { eventId: t.last_event_id ?? '', kind: 'chat_abuse', severity: 'high' },
      a.ctx(),
      ports,
    );
    expect(list.find((s) => s.id === rows[0]?.id)).toMatchObject({
      source: 'chat',
      threadId: t.id,
      detail: { reason: 'abuse' },
    });
    expect((await alertsFor(a.ownerId)).filter((x) => x.params.signal === 'chat_abuse')).toHaveLength(1);
    // The fixture's organizer spam report is a medium signal (no alert).
    const spam = await signalRows(sql`source = 'chat' and severity = 'medium'`);
    expect(spam.map((r) => [r.kind, r.detail, r.alerted_at])).toEqual([
      ['chat_abuse', { reason: 'spam' }, null],
    ]);
  });

  it('a contact’s report about the organizer raises nothing for the organizer', async () => {
    const t = await thread();
    const before = (await signalRows(sql`thread_id = ${t.id}`)).length;
    await executeCommand(contactReportCommand, { token: threadToken(t.id), reason: 'abuse' }, anon(), ports);
    await drain();
    expect(await signalRows(sql`thread_id = ${t.id}`)).toHaveLength(before);
  });

  it('a conversation with no event raises an org-level signal, resolved without an event', async () => {
    const t = await thread();
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`update messaging.threads set last_event_id = null where id = ${t.id}`),
    );
    try {
      await executeCommand(reportThreadCommand, { threadId: t.id, reason: 'abuse' }, a.ctx(), ports);
      await drain();
      const [row] = await signalRows(sql`thread_id = ${t.id} and event_id is null`);
      expect(row).toMatchObject({ kind: 'chat_abuse', source: 'chat' });
      // Scoped to an event it isn't found; org roles resolve it without one.
      await expect(
        executeCommand(
          resolveFraudSignalCommand,
          { eventId, signalId: row?.id ?? '', status: 'acknowledged' },
          a.ctx(),
          ports,
        ),
      ).rejects.toMatchObject({ code: 'not_found' });
      await executeCommand(
        resolveFraudSignalCommand,
        { signalId: row?.id ?? '', status: 'acknowledged', note: 'Blocked the sender' },
        a.ctx(),
        ports,
      );
      const alert = (await alertsFor(a.ownerId)).find((x) => x.href === `/messages/${t.id}`);
      expect(alert?.params.eventName).toBe('none');
    } finally {
      await withTenant(systemCtx(a.org.id), (tx) =>
        tx.execute(sql`update messaging.threads set last_event_id = ${t.last_event_id} where id = ${t.id}`),
      );
    }
  });
});

describe('door signals, the door banner count and triage', () => {
  const at = (sec: number) => new Date(DOORS.getTime() + sec * 1000);
  const scan = (code: string, checkpointId: string, sec: number, ctx: (o: Partial<Ctx>) => Ctx = a.ctx) =>
    executeCommand(scanTicketCommand, { eventId, code, checkpointId }, ctx({ now: at(sec) }), ports);

  it('a ticket at two entrances alerts (high) and the door sees its open signals until they are handled', async () => {
    const { orderId, tickets } = await checkout(`door.${uuidv7().slice(-8)}@example.test`);
    const tk = tickets[0];
    if (!tk) throw new Error('no ticket');
    expect(await scan(tk.shortCode, north, 0)).toMatchObject({ result: 'admitted', openSignals: 0 });
    const second = await scan(tk.shortCode, south, 60);
    expect(second).toMatchObject({ result: 'duplicate', openSignals: 1 });
    await drain();
    const [row] = await signalRows(sql`ticket_id = ${tk.id} and kind = 'two_entrances'`);
    expect(row?.alerted_at).not.toBeNull();
    const alert = (await alertsFor(a.ownerId)).filter((x) => x.params.signal === 'two_entrances');
    expect(alert.at(-1)?.href).toMatch(/\/onsite\/signals$/);
    // The ticket's order timeline lists the door signal too.
    const order = await executeQuery(orderSignalsQuery, { orderId }, a.ctx(), ports);
    expect(order.map((s) => s.kind)).toContain('two_entrances');

    // Triage: the viewer (door staff here) may read but not resolve; a dismissal needs a reason.
    const signalId = row?.id ?? '';
    await expect(
      executeCommand(
        resolveFraudSignalCommand,
        { eventId, signalId, status: 'acknowledged' },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    for (const note of [undefined, '', 'no']) {
      await expect(
        executeCommand(
          resolveFraudSignalCommand,
          { eventId, signalId, status: 'dismissed', ...(note === undefined ? {} : { note }) },
          a.ctx(),
          ports,
        ),
      ).rejects.toMatchObject({ code: 'validation_failed' });
    }
    await expect(
      executeCommand(
        resolveFraudSignalCommand,
        { eventId, signalId, status: 'acknowledged', note: 'x'.repeat(501) },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        resolveFraudSignalCommand,
        { eventId, signalId, status: 'acknowledged' },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await executeCommand(
      resolveFraudSignalCommand,
      { eventId, signalId, status: 'dismissed', note: '  Friend handed it back at the gate  ' },
      a.ctx(),
      ports,
    );
    await expect(
      executeCommand(
        resolveFraudSignalCommand,
        { eventId, signalId, status: 'acknowledged' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    const [audit] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ data: Record<string, unknown> }>(
        sql`select data from platform.audit_events where action = 'fraud_signal.dismiss' and target_id = ${signalId}`,
      ),
    );
    expect(audit?.data).toMatchObject({ eventId, note: 'Friend handed it back at the gate' });
    const listed = await executeQuery(orderSignalsQuery, { orderId }, a.ctx(), ports);
    expect(listed.find((s) => s.id === signalId)).toMatchObject({
      status: 'dismissed',
      resolutionNote: 'Friend handed it back at the gate',
    });
    // Handled: the door no longer sees it.
    expect(await scan(tk.shortCode, north, 120)).toMatchObject({ result: 'duplicate', openSignals: 0 });
  });

  it('a risky order’s tickets show the order’s open high signal at the door (online and on sync)', async () => {
    const { orderId, tickets } = await checkout(
      `flagged.${uuidv7().slice(-8)}@example.test`,
      ['email_velocity_review'],
      2,
    );
    await drain();
    const [one, two] = tickets;
    if (!one || !two) throw new Error('two tickets');
    expect(await scan(one.shortCode, north, 300)).toMatchObject({ result: 'admitted', openSignals: 1 });
    const device = await executeCommand(enrollDeviceCommand, { label: `Gate ${uuidv7()}` }, a.ctx(), ports);
    const dc = await deviceContext(device.token);
    if (!dc) throw new Error('no device');
    const synced = await executeCommand(
      syncScansCommand,
      {
        eventId,
        scans: [
          { scanId: uuidv7(), code: two.shortCode, deviceTs: at(310), clockOffsetMs: 0, verdict: 'admit' },
        ],
      },
      { ...dc.ctx, now: at(320) },
      ports,
    );
    expect(synced.results[0]).toMatchObject({ result: 'admitted', openSignals: 1 });
    const [sig] = await signalRows(sql`order_id = ${orderId}`);
    await executeCommand(
      resolveFraudSignalCommand,
      { eventId, signalId: sig?.id ?? '', status: 'acknowledged' },
      a.ctx(),
      ports,
    );
    expect(await scan(one.shortCode, north, 330)).toMatchObject({ openSignals: 0 });
  });

  it('the Signals list filters by kind, severity and status', async () => {
    const all = await executeQuery(listFraudSignalsQuery, { eventId }, a.ctx(), ports);
    expect(new Set(all.map((s) => s.source))).toEqual(new Set(['checkin', 'checkout']));
    const high = await executeQuery(listFraudSignalsQuery, { eventId, severity: 'high' }, a.ctx(), ports);
    expect(high.length).toBeGreaterThan(0);
    expect(high.every((s) => s.severity === 'high')).toBe(true);
    const cm = await executeQuery(
      listFraudSignalsQuery,
      { eventId, kind: 'country_mismatch' },
      a.ctx(),
      ports,
    );
    expect(cm.every((s) => s.kind === 'country_mismatch') && cm.length > 0).toBe(true);
    const dismissed = await executeQuery(
      listFraudSignalsQuery,
      { eventId, status: 'dismissed' },
      a.ctx(),
      ports,
    );
    expect(dismissed.map((s) => s.kind)).toEqual(['two_entrances']);
    // The viewer is door staff on the fixture event only: they read that list, not this one.
    await expect(
      executeQuery(listFraudSignalsQuery, { eventId }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const doorList = await executeQuery(
      listFraudSignalsQuery,
      { eventId: a.event.id },
      userCtx(a.viewerId, a.org.id),
      ports,
    );
    expect(doorList.some((s) => s.kind === 'chat_abuse')).toBe(true);
    // Another org sees nothing of it.
    await expect(executeQuery(listFraudSignalsQuery, { eventId }, b.ctx(), ports)).resolves.toEqual([]);
    await expect(
      executeQuery(listFraudSignalsQuery, { eventId, kind: 'nope' as never }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('alerts: preferences and quiet hours', () => {
  it('email waits out quiet hours in the event’s timezone; in-app is immediate', async () => {
    const { orderId } = await checkout(`night.${uuidv7().slice(-8)}@example.test`, ['email_velocity_review']);
    await drain();
    expect((await alertsFor(a.ownerId)).filter((x) => x.href?.endsWith(orderId))).toHaveLength(1);
    const { transports, emails } = memoryTransports();
    // 04:00 UTC = 22:00 in Chicago: quiet hours.
    await dispatchDue(a.org.id, {
      transports,
      appOrigin: ORIGIN,
      now: () => new Date('2030-06-10T03:30:00Z'),
      userEmails: async (ids) => new Map(ids.map((id) => [id, `${id}@members.test`])),
    });
    const rows = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ status: string; reason: string | null; category: string; channel: string }>(
        sql`select status, reason, category, channel from notifications.messages where kind = 'security.fraud_signal' and dedupe_key like ${'%'} and recipient_user_id = ${a.ownerId} and channel = 'email'`,
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.category === 'security')).toBe(true);
    expect(rows.some((r) => r.status === 'queued' && r.reason === 'quiet_hours')).toBe(true);
    // (Command Center alerts, M3.2b, are transactional and go at once: only fraud alerts wait.)
    expect(
      emails.filter((e) => e.to === `${a.ownerId}@members.test` && e.subject.startsWith('Fraud alert')),
    ).toHaveLength(0);
    // At 08:00 local they go out, with a button into the console.
    await dispatchDue(a.org.id, {
      transports,
      appOrigin: ORIGIN,
      now: () => new Date('2030-06-10T13:00:00Z'),
      userEmails: async (ids) => new Map(ids.map((id) => [id, `${id}@members.test`])),
    });
    const sent = emails.filter(
      (e) => e.to === `${a.ownerId}@members.test` && e.subject.startsWith('Fraud alert'),
    );
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.some((e) => e.html.includes(`${ORIGIN}/o/${a.org.slug}/e/`))).toBe(true);
  });

  it('a member who turned security emails off still gets the in-app alert, no email', async () => {
    await executeCommand(
      setMyPreferencesCommand,
      { preferences: [{ category: 'security', channel: 'email', enabled: false }] },
      b.ctx(),
      ports,
    );
    const e = await executeCommand(
      createEventCommand,
      {
        name: 'B gala',
        timezone: 'America/Chicago',
        startsAt: '2027-12-01T15:00:00Z',
        endsAt: '2027-12-02T04:00:00Z',
      },
      b.ctx(),
      ports,
    );
    const tt = await executeCommand(
      createTicketTypeCommand,
      { eventId: e.id, name: 'GA', priceMinor: 0, quantityTotal: 5 },
      b.ctx(),
      ports,
    );
    await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, b.ctx(), ports);
    const r = await executeCommand(
      startCheckoutCommand,
      {
        eventId: e.id,
        items: [{ ticketTypeId: tt.id, quantity: 1 }],
        buyer: { email: 'b.velocity@example.test', name: 'Bo' },
        riskReview: ['email_velocity_review'],
      },
      anon(b.org.id),
      ports,
    );
    await drain(b.org.id);
    expect((await alertsFor(b.ownerId, b.org.id)).filter((x) => x.href?.endsWith(r.order.id))).toHaveLength(
      1,
    );
    const emailsQueued = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from notifications.messages where kind = 'security.fraud_signal' and recipient_user_id = ${b.ownerId} and channel = 'email'`,
      ),
    );
    expect(emailsQueued[0]?.n).toBe(0);
    // Org A's signals never reach org B.
    expect((await alertsFor(b.ownerId, b.org.id)).some((x) => x.params.eventName === 'Signals gala')).toBe(
      false,
    );
  });
});

describe('migrated tickets offline (legacy QR payloads)', () => {
  it('the manifest carries hashed legacy payloads only; sync resolves them; a cross-device duplicate is flagged', async () => {
    const { tickets } = await checkout(`legacy.${uuidv7().slice(-8)}@example.test`);
    const tk = tickets[0];
    if (!tk) throw new Error('no ticket');
    const payload = `Leg${Date.now()}`;
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(
        sql`insert into ticketing.ticket_barcodes (org_id, ticket_id, format, instance, payload, rev) values (${a.org.id}, ${tk.id}, 'legacy_eventmie', 'yay', ${payload}, 0)`,
      ),
    );
    const enroll = async () => {
      const d = await executeCommand(enrollDeviceCommand, { label: `Legacy ${uuidv7()}` }, a.ctx(), ports);
      const dc = await deviceContext(d.token);
      if (!dc) throw new Error('no device');
      return (now: Date) => ({ ...dc.ctx, now });
    };
    const d1 = await enroll();
    const d2 = await enroll();
    // The manifest: the ticket's row has the salted hash, and the payload appears nowhere.
    const rows = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await executeQuery(
        deviceManifestQuery,
        { eventId, limit: 500, ...(cursor ? { cursor } : {}) },
        d1(DOORS),
        ports,
      );
      rows.push(...page.rows);
      if (page.complete || !page.cursor) break;
      cursor = page.cursor;
    }
    const mine = rows.find((r) => r.ticketId === tk.id);
    expect(mine?.legacyCodes).toEqual([await legacyPayloadHash(`yy-manifest:${eventId}`, payload)]);
    expect(JSON.stringify(rows)).not.toContain(payload);
    expect(rows.filter((r) => r.ticketId !== tk.id).every((r) => !('legacyCodes' in r))).toBe(true);

    // Two devices let the same migrated ticket in while offline; the earlier one wins on sync.
    const scanAt = (sec: number) => ({
      scanId: uuidv7(),
      code: payload,
      deviceTs: new Date(DOORS.getTime() + 3_600_000 + sec * 1000),
      clockOffsetMs: 0,
      verdict: 'admit' as const,
    });
    const later = await executeCommand(
      syncScansCommand,
      { eventId, scans: [scanAt(40)] },
      d2(new Date(DOORS.getTime() + 3_700_000)),
      ports,
    );
    expect(later.results[0]?.result).toBe('admitted');
    const earlier = await executeCommand(
      syncScansCommand,
      { eventId, scans: [scanAt(10)] },
      d1(new Date(DOORS.getTime() + 3_710_000)),
      ports,
    );
    expect(earlier).toMatchObject({ duplicatesOffline: 1, results: [{ result: 'admitted' }] });
    const logged = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ result: string; code_kind: string }>(
        sql`select result, code_kind from checkin.scans where ticket_id = ${tk.id} order by scanned_at`,
      ),
    );
    expect(logged).toEqual([
      { result: 'admitted', code_kind: 'legacy' },
      { result: 'duplicate_offline', code_kind: 'legacy' },
    ]);
    const alerts = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.domain_events where type = 'checkin.duplicate_offline' and aggregate_id = ${tk.id}`,
      ),
    );
    expect(alerts[0]?.n).toBe(1);
    // The same payload in the wrong case is not a ticket (legacy payloads are case-sensitive).
    const wrong = await executeCommand(
      syncScansCommand,
      { eventId, scans: [{ ...scanAt(50), code: payload.toLowerCase() }] },
      d1(new Date(DOORS.getTime() + 3_720_000)),
      ports,
    );
    expect(wrong.results[0]?.result).toBe('invalid');
  });
});
