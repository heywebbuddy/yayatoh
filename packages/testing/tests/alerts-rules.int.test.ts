import {
  type AlertChange,
  acknowledgeAlertCommand,
  alertRoutingQuery,
  evaluateEventAlertsTx,
  evaluateOrgAlertsTx,
  listAlertsQuery,
  myAlertSettingsQuery,
  type RuleKey,
  setAlertRoutingCommand,
  setMyAlertPhoneCommand,
  setSalesTargetCommand,
  snoozeAlertCommand,
} from '@yayatoh/alerts';
import { deviceContext, enrollDeviceCommand, heartbeatCommand, scanTicketCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { createNotifier, dispatchDue, memoryTransports } from '@yayatoh/notifications';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  completeRefundCommand,
  orderByManageToken,
  startCheckoutCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import { addMemberCommand } from '@yayatoh/tenancy';
import { createTicketTypeCommand, updateTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
const deps = { notifier: createNotifier() };
const HOUR = 3_600_000;
const tag = uuidv7().slice(-8);

const sys = (f: OrgFixture, now?: Date): Ctx => (now ? { ...systemCtx(f.org.id), now } : systemCtx(f.org.id));
const evalEvent = (f: OrgFixture, eventId: string, now?: Date): Promise<AlertChange[]> =>
  withTenant(sys(f, now), (tx) => evaluateEventAlertsTx(tx, sys(f, now), eventId, deps, now));
const evalOrg = (f: OrgFixture, now?: Date): Promise<AlertChange[]> =>
  withTenant(sys(f, now), (tx) => evaluateOrgAlertsTx(tx, sys(f, now), deps, now));
const active = async (f: OrgFixture, eventId: string | null) => {
  const list = await executeQuery(listAlertsQuery, { limit: 200 }, f.ctx(), ports);
  return Object.fromEntries(list.filter((x) => x.eventId === eventId).map((x) => [x.rule, x])) as Partial<
    Record<RuleKey, (typeof list)[number]>
  >;
};

async function newEvent(f: OrgFixture, startsInMs: number, lengthMs = 4 * HOUR) {
  const now = Date.now();
  const e = await executeCommand(
    createEventCommand,
    {
      name: `Rule test ${uuidv7().slice(-6)}`,
      slug: `rules-${uuidv7().slice(-12)}`,
      timezone: 'America/Chicago',
      startsAt: new Date(now + startsInMs).toISOString(),
      endsAt: new Date(now + startsInMs + lengthMs).toISOString(),
    },
    f.ctx(),
    ports,
  );
  return e.id;
}
const typeOf = async (f: OrgFixture, eventId: string, priceMinor: number, quantityTotal: number) =>
  (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: `T${priceMinor}`, priceMinor, quantityTotal, maxPerOrder: 50 },
      f.ctx(),
      ports,
    )
  ).id;
const publish = (f: OrgFixture, eventId: string) =>
  executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, f.ctx(), ports);
const checkout = (f: OrgFixture, eventId: string, ticketTypeId: string, quantity: number) =>
  executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId, quantity }],
      buyer: { email: `b.${uuidv7().slice(-8)}@rules.test`, name: 'B' },
    },
    createCtx({ orgId: f.org.id }),
    ports,
  );
async function pay(
  f: OrgFixture,
  orderId: string,
  amountMinor: number,
  outcome: 'succeed' | 'fail' | 'none',
) {
  const pi = `fakepi_rules_${uuidv7()}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId, provider: 'fake', providerPaymentId: pi },
    createCtx({ orgId: f.org.id }),
    ports,
  );
  if (outcome === 'none') return pi;
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_${pi}`,
      type: outcome === 'fail' ? 'payment.failed' : 'payment.succeeded',
      providerPaymentId: pi,
      amountMinor,
      currency: 'USD',
      orgId: f.org.id,
      orderId,
    },
    sys(f),
    ports,
  );
  return pi;
}
async function heartbeat(token: string, batteryPct: number, queueDepth: number) {
  const dc = await deviceContext(token);
  if (!dc) throw new Error('no device');
  await executeCommand(heartbeatCommand, { batteryPct, queueDepth, clockOffsetMs: 0 }, dc.ctx, ports);
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
}, 120_000);

afterAll(async () => {
  await closePools();
});

describe('event rules fire and resolve on the facts (M3.2b)', () => {
  it('devices: low battery and a sync backlog, around a live event only', async () => {
    const live = await newEvent(a, 30 * 60_000);
    const later = await newEvent(a, 20 * 24 * HOUR);
    const d = await executeCommand(enrollDeviceCommand, { label: `Gate ${tag}` }, a.ctx(), ports);
    await heartbeat(d.token, 10, 0);
    await evalEvent(a, live);
    await evalEvent(a, later);
    expect((await active(a, live)).devicesLowBattery?.count).toBeGreaterThanOrEqual(1);
    expect((await active(a, later)).devicesLowBattery).toBeUndefined();
    await heartbeat(d.token, 90, 80);
    await evalEvent(a, live);
    let r = await active(a, live);
    expect(r.devicesLowBattery).toBeUndefined();
    expect(r.devicesBacklog?.count).toBeGreaterThanOrEqual(1);
    await heartbeat(d.token, 90, 0);
    await evalEvent(a, live);
    r = await active(a, live);
    expect(r.devicesBacklog).toBeUndefined();
  });

  it('stuck payments: a payment started 40 minutes ago that never finished, until it does', async () => {
    const e = await newEvent(a, 10 * 24 * HOUR);
    const paid = await typeOf(a, e, 2500, 100);
    await publish(a, e);
    const c = await checkout(a, e, paid, 1);
    await pay(a, c.order.id, c.order.totalMinor, 'none');
    await withTenant(sys(a), (tx) =>
      tx.execute(sql`update orders.orders set created_at = now() - interval '40 minutes', expires_at = now() + interval '1 hour'
        where id = ${c.order.id}::uuid`),
    );
    await evalEvent(a, e);
    expect((await active(a, e)).paymentsStuck?.count).toBe(1);
    await withTenant(sys(a), (tx) =>
      tx.execute(sql`update orders.orders set status = 'expired' where id = ${c.order.id}::uuid`),
    );
    await evalEvent(a, e);
    expect((await active(a, e)).paymentsStuck).toBeUndefined();
  });

  it('failed payments: fewer than three stay quiet; retries resolve them', async () => {
    const e = await newEvent(a, 10 * 24 * HOUR);
    const paid = await typeOf(a, e, 1500, 100);
    await publish(a, e);
    const failed: string[] = [];
    for (let i = 0; i < 3; i++) {
      const c = await checkout(a, e, paid, 1);
      await pay(a, c.order.id, c.order.totalMinor, 'fail');
      failed.push(c.order.id);
      await evalEvent(a, e);
      expect((await active(a, e)).paymentsFailed?.count).toBe(i < 2 ? undefined : 3);
    }
    await pay(a, failed[0] as string, 1500, 'succeed');
    await evalEvent(a, e);
    expect((await active(a, e)).paymentsFailed).toBeUndefined();
  });

  it('refund surge: ten refunds within the hour, gone from the window after it', async () => {
    const e = await newEvent(a, 10 * 24 * HOUR);
    const paid = await typeOf(a, e, 1000, 100);
    await publish(a, e);
    for (let i = 0; i < 10; i++) {
      const c = await checkout(a, e, paid, 1);
      await pay(a, c.order.id, c.order.totalMinor, 'succeed');
      const r = await executeCommand(
        startRefundCommand,
        { orderId: c.order.id, amountMinor: 1000, reason: 'requested_by_customer' },
        a.ctx({ idempotencyKey: uuidv7() }),
        ports,
      );
      await executeCommand(
        completeRefundCommand,
        { refundId: r.refundId, outcome: 'succeeded', providerRefundId: `fakere_${r.refundId}` },
        a.ctx(),
        ports,
      );
    }
    await evalEvent(a, e);
    const surge = (await active(a, e)).refundSurge;
    expect(surge).toMatchObject({ count: 10, severity: 'critical' });
    await evalEvent(a, e, new Date(Date.now() + 2 * HOUR));
    expect((await active(a, e)).refundSurge).toBeUndefined();
  });

  it('capacity: 95 % admitted is near, 100 % is full (live only); 90 % sold is a sell-out', async () => {
    const e = await newEvent(a, -10 * 60_000, 3 * HOUR);
    const free = await typeOf(a, e, 0, 20);
    await publish(a, e);
    const c = await checkout(a, e, free, 20);
    const tickets = (await orderByManageToken(c.manageToken))?.tickets ?? [];
    expect(tickets).toHaveLength(20);
    await evalEvent(a, e);
    expect((await active(a, e)).sellOut).toMatchObject({ count: 100, severity: 'info' });
    for (const t of tickets.slice(0, 19))
      await executeCommand(scanTicketCommand, { eventId: e, code: t.code }, a.ctx(), ports);
    await evalEvent(a, e);
    expect((await active(a, e)).capacityNear).toMatchObject({ count: 95, severity: 'warning' });
    await executeCommand(scanTicketCommand, { eventId: e, code: tickets[19]?.code ?? '' }, a.ctx(), ports);
    await evalEvent(a, e);
    let r = await active(a, e);
    expect(r.capacityNear).toBeUndefined();
    expect(r.capacityFull).toMatchObject({ count: 100, severity: 'critical' });
    await executeCommand(updateTicketTypeCommand, { ticketTypeId: free, quantityTotal: 200 }, a.ctx(), ports);
    await evalEvent(a, e);
    r = await active(a, e);
    expect(r.capacityFull).toBeUndefined();
    expect(r.sellOut).toBeUndefined();
  });

  it('sales pace: at or below 70 % of the straight line to the target, once a fifth of the run is behind', async () => {
    const e = await newEvent(a, 10 * 24 * HOUR);
    const free = await typeOf(a, e, 0, 500);
    await publish(a, e);
    await executeCommand(setSalesTargetCommand, { eventId: e, tickets: 100 }, a.ctx(), ports);
    // One day in (10 %): too early to judge.
    await evalEvent(a, e, new Date(Date.now() + 24 * HOUR));
    expect((await active(a, e)).salesPace).toBeUndefined();
    // Three days in (30 %): 30 tickets expected, none sold.
    const at = new Date(Date.now() + 3 * 24 * HOUR);
    await evalEvent(a, e, at);
    expect((await active(a, e)).salesPace).toMatchObject({
      count: 0,
      params: expect.objectContaining({ target: 100 }),
    });
    await checkout(a, e, free, 25);
    await evalEvent(a, e, at);
    expect((await active(a, e)).salesPace).toBeUndefined();
    // Viewers can't set targets.
    await expect(
      executeCommand(setSalesTargetCommand, { eventId: e, tickets: 5 }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('readiness: a draft without tickets a few days out; critical in the last day; fixed by setting it up', async () => {
    const e = await newEvent(a, 3 * 24 * HOUR);
    await evalEvent(a, e);
    expect((await active(a, e)).readiness).toMatchObject({ count: 2, severity: 'warning' });
    const changes = await evalEvent(a, e, new Date(Date.now() + 2.5 * 24 * HOUR));
    expect(changes.find((c) => c.rule === 'readiness')).toMatchObject({ action: 'update', notified: true });
    expect((await active(a, e)).readiness?.severity).toBe('critical');
    await typeOf(a, e, 0, 50);
    await publish(a, e);
    await evalEvent(a, e);
    expect((await active(a, e)).readiness).toBeUndefined();
  });
});

describe('org rules fire and resolve on the facts', () => {
  it('a failed custom domain, a restricted payout account, paused email and a failed bulk action', async () => {
    const host = `alerts-${tag}.example.test`;
    await withTenant(sys(b), (tx) =>
      tx.execute(sql`insert into tenancy.org_domains (org_id, hostname, status, failure_reason)
        values (${b.org.id}, ${host}, 'failed', 'dns_conflict')`),
    );
    await withTenant(sys(b), (tx) =>
      tx.execute(sql`update payments.payment_accounts set details_submitted = true, charges_enabled = false,
        payouts_enabled = false, requirements_due = '{external_account,individual.id_number}'`),
    );
    await withTenant(sys(b), (tx) =>
      tx.execute(sql`insert into notifications.auto_pauses (org_id, complaints, sent, rate_bps, window_start)
        values (${b.org.id}, 3, 500, 60, now() - interval '1 day')`),
    );
    await withTenant(sys(b), (tx) =>
      tx.execute(sql`insert into platform.bulk_operations (org_id, action, status, item_ids, total, finished_at)
        values (${b.org.id}, 'fixture.fail', 'failed', '{}', 0, now())`),
    );
    await evalOrg(b);
    const r = await active(b, null);
    expect(r.domain).toMatchObject({ count: 1, fixPath: '/domains' });
    expect(r.payoutsPastDue).toMatchObject({ count: 2, severity: 'critical', fixPath: '/payouts' });
    expect(r.deliverability).toMatchObject({ severity: 'critical', fixPath: '/messaging#suppressions' });
    expect(r.automationFailed?.count).toBeGreaterThanOrEqual(1);
    // A viewer may not see payout or domain alerts (finance:read, org:update).
    const viewer = await executeQuery(listAlertsQuery, {}, userCtx(b.viewerId, b.org.id), ports);
    expect(viewer.some((x) => x.rule === 'payoutsPastDue' || x.rule === 'domain')).toBe(false);

    await withTenant(sys(b), (tx) =>
      tx.execute(sql`update tenancy.org_domains set status = 'active', ssl_status = 'issued', activated_at = now()
        where hostname = ${host}`),
    );
    await withTenant(sys(b), (tx) =>
      tx.execute(
        sql`update payments.payment_accounts set charges_enabled = true, payouts_enabled = true, requirements_due = '{}'`,
      ),
    );
    await withTenant(sys(b), (tx) =>
      tx.execute(sql`update notifications.auto_pauses set lifted_at = now(), lifted_by = 'staff:test', lift_note = 'fixed'
        where lifted_at is null`),
    );
    await evalOrg(b, new Date(Date.now() + 25 * HOUR));
    const after = await active(b, null);
    for (const rule of ['domain', 'payoutsPastDue', 'deliverability', 'automationFailed'] as const)
      expect(after[rule]).toBeUndefined();
  });
});

describe('lifecycle over time', () => {
  it('an acknowledgement times out after an hour while the condition holds (it opens and is sent again)', async () => {
    const e = await newEvent(a, 3 * 24 * HOUR);
    await evalEvent(a, e);
    const x = (await active(a, e)).readiness;
    if (!x) throw new Error('no alert');
    await executeCommand(acknowledgeAlertCommand, { alertId: x.id }, a.ctx(), ports);
    expect(await evalEvent(a, e, new Date(Date.now() + 30 * 60_000))).toEqual([]);
    const changes = await evalEvent(a, e, new Date(Date.now() + 61 * 60_000));
    expect(changes).toEqual([
      expect.objectContaining({ rule: 'readiness', action: 'ackTimeout', notified: true }),
    ]);
    expect((await active(a, e)).readiness?.state).toBe('open');
  });

  it('live-critical alerts time out after ten minutes', async () => {
    const e = await newEvent(a, 30 * 60_000);
    const d = await executeCommand(enrollDeviceCommand, { label: `Quiet ${tag}` }, a.ctx(), ports);
    await heartbeat(d.token, 90, 0);
    await withTenant(sys(a), (tx) =>
      tx.execute(
        sql`update checkin.devices set last_seen_at = now() - interval '5 minutes' where id = ${d.deviceId}::uuid`,
      ),
    );
    await evalEvent(a, e);
    const x = (await active(a, e)).devicesOffline;
    expect(x?.severity).toBe('critical');
    await executeCommand(acknowledgeAlertCommand, { alertId: x?.id ?? '' }, a.ctx(), ports);
    const changes = await evalEvent(a, e, new Date(Date.now() + 11 * 60_000));
    expect(changes.find((c) => c.rule === 'devicesOffline')?.action).toBe('ackTimeout');
    await withTenant(sys(a), (tx) =>
      tx.execute(sql`update checkin.devices set revoked_at = now() where id = ${d.deviceId}::uuid`),
    );
  });

  it('a snooze holds until it ends, then the alert opens again', async () => {
    const e = await newEvent(a, 4 * 24 * HOUR);
    await evalEvent(a, e);
    const x = (await active(a, e)).readiness;
    if (!x) throw new Error('no alert');
    const snoozed = await executeCommand(snoozeAlertCommand, { alertId: x.id, minutes: 60 }, a.ctx(), ports);
    expect(snoozed.state).toBe('snoozed');
    await expect(
      executeCommand(snoozeAlertCommand, { alertId: x.id, minutes: 7 }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await evalEvent(a, e, new Date(Date.now() + 30 * 60_000))).toEqual([]);
    const changes = await evalEvent(a, e, new Date(Date.now() + 61 * 60_000));
    expect(changes).toEqual([expect.objectContaining({ rule: 'readiness', action: 'wake', notified: true })]);
  });
});

describe('routing (in-app, email, SMS, push) by role, quiet hours for texts', () => {
  it('reaches the roles routed for the group, texts only to members with a number, and waits out quiet hours', async () => {
    const manager = uuidv7();
    const finance = uuidv7();
    await executeCommand(addMemberCommand, { userId: manager, role: 'manager' }, b.ctx(), ports);
    await executeCommand(addMemberCommand, { userId: finance, role: 'finance' }, b.ctx(), ports);
    await executeCommand(
      setMyAlertPhoneCommand,
      { smsPhone: '+1 (555) 010-0111' },
      userCtx(manager, b.org.id),
      ports,
    );
    expect(await executeQuery(myAlertSettingsQuery, {}, userCtx(manager, b.org.id), ports)).toEqual({
      smsPhone: '+15550100111',
    });
    await expect(
      executeCommand(setMyAlertPhoneCommand, { smsPhone: '555-0100' }, userCtx(finance, b.org.id), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    // Only owners and admins change the routing; everyone may read it.
    await expect(
      executeCommand(
        setAlertRoutingCommand,
        { cells: [{ role: 'viewer', category: 'door', channels: ['in_app'] }] },
        userCtx(manager, b.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const routing = await executeQuery(alertRoutingQuery, {}, userCtx(b.viewerId, b.org.id), ports);
    expect(routing.find((c) => c.role === 'manager' && c.category === 'door')).toMatchObject({
      channels: ['in_app', 'sms', 'push'],
      isDefault: true,
    });
    // The fixture routes the viewer's door alerts in-app.
    expect(routing.find((c) => c.role === 'viewer' && c.category === 'door')?.isDefault).toBe(false);

    // A door alert at a live event.
    const e = await newEvent(b, 30 * 60_000);
    const d = await executeCommand(enrollDeviceCommand, { label: `Door ${tag}` }, b.ctx(), ports);
    await heartbeat(d.token, 90, 0);
    await withTenant(sys(b), (tx) =>
      tx.execute(
        sql`update checkin.devices set last_seen_at = now() - interval '5 minutes' where id = ${d.deviceId}::uuid`,
      ),
    );
    const changes = await evalEvent(b, e);
    const alertId = changes.find((c) => c.rule === 'devicesOffline')?.alertId;
    expect(alertId).toBeDefined();
    const rows = await withTenant(sys(b), (tx) =>
      tx.execute<{ kind: string; channel: string; user_id: string; status: string }>(sql`
        select kind, channel, recipient_user_id as user_id, status from notifications.messages
        where dedupe_key like ${`alert:${alertId}:%`} order by kind, channel`),
    );
    const inbox = await withTenant(sys(b), (tx) =>
      tx.execute<{ user_id: string; href: string }>(sql`
        select user_id, href from notifications.inbox_items where dedupe_key like ${`alert:${alertId}:%`}`),
    );
    const who = (id: string) =>
      id === b.ownerId
        ? 'owner'
        : id === manager
          ? 'manager'
          : id === b.viewerId
            ? 'viewer'
            : id === finance
              ? 'finance'
              : 'other';
    expect(rows.map((r) => `${who(r.user_id)}:${r.kind}:${r.channel}`).sort()).toEqual(
      [
        'owner:alerts.alert:email',
        // The fixture owner registered a device for web push (members' own opt-in).
        'owner:alerts.alert:push',
        'owner:alerts.alert-text:sms',
        'manager:alerts.alert-text:sms',
      ].sort(),
    );
    expect(inbox.map((i) => who(i.user_id)).sort()).toEqual(['manager', 'owner', 'viewer']);
    expect(new Set(inbox.map((i) => i.href))).toEqual(new Set([`/e/${await eventSlug(b, e)}/onsite`]));

    // Dispatch in the middle of the night (Chicago): the email goes, the texts wait for 8:00.
    const { transports, emails, sms, pushes } = memoryTransports();
    const night = new Date('2030-01-15T05:30:00Z'); // 23:30 in Chicago
    await withTenant(sys(b), (tx) =>
      tx.execute(sql`update notifications.messages set send_after = ${night.toISOString()}::timestamptz - interval '1 minute'
        where dedupe_key like ${`alert:${alertId}:%`}`),
    );
    await dispatchDue(b.org.id, {
      transports,
      appOrigin: 'https://app.yayatoh.test',
      now: () => night,
      userEmails: async (ids) => new Map(ids.map((id) => [id, `${who(id)}.${tag}@members.test`])),
    });
    expect(emails.filter((m) => m.subject === 'One check-in device is offline').map((m) => m.to)).toEqual([
      `owner.${tag}@members.test`,
    ]);
    expect(sms).toHaveLength(0);
    expect(pushes.some((p) => p.title === 'One check-in device is offline')).toBe(true);
    const held = await withTenant(sys(b), (tx) =>
      tx.execute<{ status: string; reason: string | null }>(sql`
        select status, reason from notifications.messages where dedupe_key like ${`alert:${alertId}:%`} and channel = 'sms'`),
    );
    expect(held.map((h) => `${h.status}:${h.reason}`)).toEqual(['queued:quiet_hours', 'queued:quiet_hours']);
    const morning = new Date('2030-01-15T14:05:00Z'); // 8:05 in Chicago
    await dispatchDue(b.org.id, {
      transports,
      appOrigin: 'https://app.yayatoh.test',
      now: () => morning,
      userEmails: async (ids) => new Map(ids.map((id) => [id, `${who(id)}.${tag}@members.test`])),
    });
    expect(sms.map((m) => m.to).sort()).toEqual(['+15550100111', '+15550100199'].sort());
    for (const m of sms) {
      expect(m.body).toContain('One check-in device is offline');
      expect(m.body).toContain(`/o/`);
    }
    await withTenant(sys(b), (tx) =>
      tx.execute(sql`update checkin.devices set revoked_at = now() where id = ${d.deviceId}::uuid`),
    );
  });
});

async function eventSlug(f: OrgFixture, eventId: string) {
  const [r] = await withTenant(sys(f), (tx) =>
    tx.execute<{ slug: string }>(sql`select slug from events.events where id = ${eventId}::uuid`),
  );
  return r?.slug ?? '';
}
