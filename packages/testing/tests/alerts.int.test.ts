import {
  type AlertDto,
  acknowledgeAlertCommand,
  alertCountQuery,
  alertEvaluator,
  alertHistoryQuery,
  evaluateEventAlertsTx,
  listAlertsQuery,
  snoozeAlertCommand,
} from '@yayatoh/alerts';
import { addGuestCommand } from '@yayatoh/attendees';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { type Ctx, DomainError, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { createNotifier, renderMessage } from '@yayatoh/notifications';
import { consumeEvent, recentEventsTx } from '@yayatoh/platform';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ALERT_FIXTURE,
  type AlertScenario,
  alertScenario,
  type OrgFixture,
  ports,
  systemCtx,
  twoOrgs,
  userCtx,
} from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let s: AlertScenario;
const deps = { notifier: createNotifier() };

const alertsOf = (ctx: Ctx, eventId: string, status: 'active' | 'resolved' = 'active') =>
  executeQuery(listAlertsQuery, { eventId, status }, ctx, ports);
const byRule = (list: readonly AlertDto[]) => Object.fromEntries(list.map((x) => [x.rule, x]));
/** The English title the console and the email use (notifications templates, same copy). */
const title = (x: Pick<AlertDto, 'rule' | 'count'>) =>
  renderMessage({
    kind: 'alerts.alert',
    locale: 'en',
    params: { rule: x.rule, count: x.count, severity: 'warning', eventName: 'E' },
    org: { name: 'Org' },
  }).subject;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  s = await alertScenario(a.org.id, a.ctx(), deps);
}, 180_000);

afterAll(async () => {
  await closePools();
});

describe('the acceptance fixture (M3.2b)', () => {
  it('raises exactly the four alerts, with the exact text', async () => {
    const list = await alertsOf(a.ctx(), s.eventId);
    expect(list.map((x) => x.rule).sort()).toEqual(
      ['devicesOffline', 'paymentsFailed', 'undistributed', 'unseated'].sort(),
    );
    const r = byRule(list);
    expect(r.unseated?.count).toBe(ALERT_FIXTURE.unseated);
    expect(r.undistributed?.count).toBe(ALERT_FIXTURE.undistributed);
    expect(r.paymentsFailed?.count).toBe(ALERT_FIXTURE.failedPayments);
    expect(r.devicesOffline?.count).toBe(ALERT_FIXTURE.offlineDevices);
    expect(list.map(title).sort()).toEqual(
      [
        '37 attendees do not have seats',
        '120 purchased tickets have not been distributed',
        '14 payments failed',
        'Three check-in devices are offline',
      ].sort(),
    );
    // Every alert names its event and deep-links to the page (bulk action) that fixes it.
    expect(r.unseated?.fixPath).toBe(`/e/${s.eventSlug}/seating/assign`);
    expect(r.undistributed?.fixPath).toBe(`/e/${s.eventSlug}/attendees?distribution=pending`);
    expect(r.paymentsFailed?.fixPath).toBe(`/e/${s.eventSlug}/analysis/bookings?filter=failed`);
    expect(r.devicesOffline?.fixPath).toBe(`/e/${s.eventSlug}/onsite`);
    for (const x of list) {
      expect(x.eventName).toBe(s.eventName);
      expect(x.state).toBe('open');
    }
    // The event is live: offline devices are critical there.
    expect(r.devicesOffline?.severity).toBe('critical');
  });

  it('evaluating again, or replaying the outbox, changes and sends nothing', async () => {
    const before = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from notifications.messages where kind like 'alerts.%'`,
      ),
    );
    const history = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from alerts.alert_history`),
    );
    const changes = await withTenant(systemCtx(a.org.id), (tx) =>
      evaluateEventAlertsTx(tx, systemCtx(a.org.id), s.eventId, deps),
    );
    expect(changes).toEqual([]);
    // Every outbox event again, under new ids (a duplicated delivery): nothing new.
    const events = await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(
        tx,
        a.org.id,
        ['seating.assignments_changed', 'order.payment_failed', 'device.heartbeat'],
        3_600_000,
      ),
    );
    expect(events.length).toBeGreaterThan(0);
    for (const e of events.slice(0, 20)) {
      expect(await consumeEvent(alertEvaluator(deps), e)).toBe(false);
      expect(await consumeEvent(alertEvaluator(deps), { ...e, id: uuidv7() })).toBe(true);
    }
    const after = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from notifications.messages where kind like 'alerts.%'`,
      ),
    );
    const historyAfter = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from alerts.alert_history`),
    );
    expect(after[0]?.n).toBe(before[0]?.n);
    expect(historyAfter[0]?.n).toBe(history[0]?.n);
  });

  it('never takes replayed (backfilled) history', async () => {
    const [e] = await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, ['seating.assignments_changed'], 3_600_000),
    );
    if (!e) throw new Error('no event');
    expect(alertEvaluator(deps).acceptsReplayed).not.toBe(true);
  });

  it('acknowledging keeps it listed until fixed; the badge counts open alerts only', async () => {
    const count0 = await executeQuery(alertCountQuery, {}, a.ctx(), ports);
    const unseated = byRule(await alertsOf(a.ctx(), s.eventId)).unseated as AlertDto;
    const acked = await executeCommand(acknowledgeAlertCommand, { alertId: unseated.id }, a.ctx(), ports);
    expect(acked.state).toBe('acknowledged');
    expect(acked.acknowledgedAt).not.toBeNull();
    const count1 = await executeQuery(alertCountQuery, {}, a.ctx(), ports);
    expect(count1.open).toBe(count0.open - 1);
    // Twice is refused (only an open alert can be acknowledged).
    await expect(
      executeCommand(acknowledgeAlertCommand, { alertId: unseated.id }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    const history = await executeQuery(alertHistoryQuery, { alertId: unseated.id }, a.ctx(), ports);
    expect(history.map((h) => h.action)).toEqual(['fired', 'notified', 'acknowledged']);
    expect(history.at(-1)).toMatchObject({ byPerson: true, byYou: true });
    // Audited.
    const [audit] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ action: string }>(
        sql`select action from platform.audit_events where action = 'alerts.acknowledge' order by seq desc limit 1`,
      ),
    );
    expect(audit?.action).toBe('alerts.acknowledge');
  });

  it('seating everyone resolves the unseated alert automatically; a new guest reopens it', async () => {
    await s.seatEveryone();
    await s.evaluate();
    let r = byRule(await alertsOf(a.ctx(), s.eventId));
    expect(r.unseated).toBeUndefined();
    const resolved = byRule(await alertsOf(a.ctx(), s.eventId, 'resolved')).unseated as AlertDto;
    expect(resolved.state).toBe('resolved');
    expect(resolved.acknowledgedAt).toBeNull();
    await executeCommand(
      addGuestCommand,
      { eventId: s.eventId, name: 'Late Guest', email: `late.${uuidv7().slice(-6)}@alerts.test`, labels: [] },
      a.ctx(),
      ports,
    );
    await s.evaluate();
    r = byRule(await alertsOf(a.ctx(), s.eventId));
    expect(r.unseated).toMatchObject({ id: resolved.id, state: 'open', count: 1, reopenCount: 1 });
    expect(title(r.unseated as AlertDto)).toBe('One attendee does not have a seat');
    const history = await executeQuery(alertHistoryQuery, { alertId: resolved.id }, a.ctx(), ports);
    expect(history.map((h) => h.action).slice(-3)).toEqual(['resolved', 'reopened', 'notified']);
  });

  it('distributing the tickets resolves the undistributed alert', async () => {
    await s.distributeTickets();
    await s.evaluate();
    expect(byRule(await alertsOf(a.ctx(), s.eventId)).undistributed).toBeUndefined();
    expect(byRule(await alertsOf(a.ctx(), s.eventId, 'resolved')).undistributed?.count).toBe(120);
  });

  it('retried payments resolve the failed payments alert', async () => {
    await s.retryPayments();
    await s.evaluate();
    expect(byRule(await alertsOf(a.ctx(), s.eventId)).paymentsFailed).toBeUndefined();
  });

  it('devices coming back resolve the offline alert', async () => {
    await s.bringDevicesOnline();
    await s.evaluate();
    expect(byRule(await alertsOf(a.ctx(), s.eventId)).devicesOffline).toBeUndefined();
  });
});

describe('permissions and isolation', () => {
  it('a viewer sees the alerts but cannot acknowledge or snooze', async () => {
    const [one] = await alertsOf(userCtx(a.viewerId, a.org.id), s.eventId);
    if (!one) throw new Error('no alert');
    await expect(
      executeCommand(acknowledgeAlertCommand, { alertId: one.id }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        snoozeAlertCommand,
        { alertId: one.id, minutes: 60 },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('another org can neither see nor change them, not even by id', async () => {
    const [one] = await alertsOf(a.ctx(), s.eventId);
    if (!one) throw new Error('no alert');
    expect(await alertsOf(b.ctx(), s.eventId)).toEqual([]);
    await expect(
      executeCommand(acknowledgeAlertCommand, { alertId: one.id }, b.ctx(), ports),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(executeQuery(alertHistoryQuery, { alertId: one.id }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    const rows = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute(sql`select id from alerts.alerts where id = ${one.id}::uuid`),
    );
    expect(rows).toHaveLength(0);
  });

  it('members see only the rules their role may see; scanners see none', async () => {
    const finance = uuidv7();
    const scanner = uuidv7();
    await executeCommand(addMemberCommand, { userId: finance, role: 'finance' }, a.ctx(), ports);
    await executeCommand(addMemberCommand, { userId: scanner, role: 'scanner' }, a.ctx(), ports);
    const all = await executeQuery(listAlertsQuery, { status: 'resolved' }, a.ctx(), ports);
    const fin = await executeQuery(
      listAlertsQuery,
      { status: 'resolved' },
      userCtx(finance, a.org.id),
      ports,
    );
    expect(all.some((x) => x.rule === 'undistributed')).toBe(true);
    expect(fin.some((x) => x.rule === 'undistributed')).toBe(false);
    expect(fin.some((x) => x.rule === 'paymentsFailed')).toBe(true);
    await expect(executeQuery(listAlertsQuery, {}, userCtx(scanner, a.org.id), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
