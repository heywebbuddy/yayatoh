import { alertEvaluator, evaluateOrgNow, listAlertsQuery } from '@yayatoh/alerts';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { createNotifier } from '@yayatoh/notifications';
import { alertDisputeDeadlinesCommand } from '@yayatoh/payments';
import { consumeEvent, eventKey, type PublishedEvent, recentEventsTx } from '@yayatoh/platform';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

/**
 * Batch 3e merge: M3.2b's alert engine hears the failures of the batch's modules through the
 * outbox only (no alert code in them): a failed journey step (M3.7a) counts as an automation
 * failure, a failed campaign send (M3.6b) and an approaching dispute evidence deadline (M3.10c)
 * raise their own rules. Each raises exactly one alert, once, for the right roles, in its org only.
 */

let a: OrgFixture;
let b: OrgFixture;
const deps = { notifier: createNotifier() };
const HOUR = 3_600_000;

const outboxEvent = (f: OrgFixture, type: string, payload: Record<string, unknown>): PublishedEvent => ({
  id: uuidv7(),
  orgId: f.org.id,
  type,
  version: 1,
  aggregateType: type.split('.')[0] ?? 'x',
  aggregateId: uuidv7(),
  payload: { orgId: f.org.id, ...payload },
  logSeq: 0,
  occurredAt: new Date().toISOString(),
});

const alertsOf = async (f: OrgFixture, rule: string) =>
  (await executeQuery(listAlertsQuery, { limit: 200 }, f.ctx(), ports)).filter((x) => x.rule === rule);

const count = async (f: OrgFixture, q: ReturnType<typeof sql>) => {
  const [r] = await withTenant(systemCtx(f.org.id), (tx) => tx.execute<{ n: number }>(q));
  return Number(r?.n ?? 0);
};

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(async () => {
  await closePools();
});

describe('alert rules fed by the batch 3e modules (outbox subscribers)', () => {
  it('a failed journey step raises one "automation failures" alert, exactly once', async () => {
    const e = outboxEvent(a, 'automations.journey_step_failed', {
      journeyId: uuidv7(),
      runId: uuidv7(),
      actionId: uuidv7(),
      eventId: a.event.id,
      position: 2,
      action: 'email',
      attempts: 5,
      error: 'provider_error',
    });
    expect(await consumeEvent(alertEvaluator(deps), e)).toBe(true);
    // The same delivery again is a no-op (processed once).
    expect(await consumeEvent(alertEvaluator(deps), e)).toBe(false);
    const found = await alertsOf(a, 'automationFailed');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ state: 'open', severity: 'warning', count: 1 });
    expect(await count(a, sql`select count(*)::int as n from alerts.signals`)).toBe(1);
    // Another org hears nothing.
    expect(await alertsOf(b, 'automationFailed')).toHaveLength(0);
  });

  it('a failed campaign send raises one campaign alert; marketing sees it, finance does not', async () => {
    const marketer = uuidv7();
    const finance = uuidv7();
    await executeCommand(addMemberCommand, { userId: marketer, role: 'marketing' }, a.ctx(), ports);
    await executeCommand(addMemberCommand, { userId: finance, role: 'finance' }, a.ctx(), ports);
    const e = outboxEvent(a, 'campaigns.send_failed', { reason: 'messages_failed', failed: 3 });
    expect(await consumeEvent(alertEvaluator(deps), e)).toBe(true);
    const found = await alertsOf(a, 'campaignFailed');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ state: 'open', count: 1 });
    const alertId = found[0]?.id;
    const inbox = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ user_id: string }>(
        sql`select user_id from notifications.inbox_items where dedupe_key like ${`alert:${alertId}:%`}`,
      ),
    );
    const users = inbox.map((r) => r.user_id);
    expect(users).toContain(marketer);
    expect(users).not.toContain(finance);
    // A second failure in the window updates the same alert (one alert per rule and org).
    await consumeEvent(alertEvaluator(deps), outboxEvent(a, 'campaigns.send_failed', { reason: 'x', failed: 1 }));
    expect(await alertsOf(a, 'campaignFailed')).toHaveLength(1);
    expect((await alertsOf(a, 'campaignFailed'))[0]?.count).toBe(2);
  });

  it('an approaching dispute deadline raises one dispute alert for finance; critical in the last day', async () => {
    const [order] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string; event_id: string }>(
        sql`select id, event_id from orders.orders where status = 'paid' order by created_at limit 1`,
      ),
    );
    if (!order) throw new Error('fixture order missing');
    const due = new Date(Date.now() + 60 * HOUR);
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`insert into payments.disputes
        (org_id, order_id, event_id, funds_flow, provider, provider_dispute_id, reason, amount_minor, currency, evidence_due_by)
        values (${a.org.id}, ${order.id}, ${order.event_id}, 'platform_mor', 'fake', ${`dp_${uuidv7()}`},
          'fraudulent', 1500, 'USD', ${due.toISOString()}::timestamptz)`),
    );
    // The hourly job (M3.10c) emits the deadline event; the alert engine consumes it.
    expect(
      (await executeCommand(alertDisputeDeadlinesCommand, {}, systemCtx(a.org.id), ports)).alerted,
    ).toBe(1);
    const events = await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, ['payments.dispute_deadline_approaching'], HOUR),
    );
    expect(events).toHaveLength(1);
    const sub = alertEvaluator(deps);
    for (const e of events) if (sub.events.includes(eventKey(e))) await consumeEvent(sub, e);
    const found = await alertsOf(a, 'disputeDeadline');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: 'warning', count: 1, category: 'payments' });
    // A day and a half later the sweep finds it in its last day: the same alert turns critical.
    await evaluateOrgNow(a.org.id, deps, { now: new Date(Date.now() + 40 * HOUR) });
    const later = await alertsOf(a, 'disputeDeadline');
    expect(later).toHaveLength(1);
    expect(later[0]?.severity).toBe('critical');
    expect(await alertsOf(b, 'disputeDeadline')).toHaveLength(0);
  });
});
