import { alertEvaluator, listAlertsQuery } from '@yayatoh/alerts';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { executeQuery, uuidv7 } from '@yayatoh/kernel';
import { createNotifier } from '@yayatoh/notifications';
import { consumeEvent, type PublishedEvent } from '@yayatoh/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs } from '../src/index.ts';

/**
 * Batch 3l merge: the alert engine hears the batch's integrations (M6.4–M6.5) and the plan's
 * billing (M6.6) through the outbox only: a failed sync run and a connection revoked at the
 * provider raise one "integration problems" alert (critical once a connection is lost), and a
 * plan subscription past due or unpaid raises one billing alert that resolves when it is paid.
 * A successful run raises nothing; each event is processed once; the other org hears nothing.
 */

let admin: AdminSql;
let a: OrgFixture;
let b: OrgFixture;
const deps = { notifier: createNotifier() };

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

const run = (f: OrgFixture, status: string) =>
  outboxEvent(f, 'integrations.sync_completed', {
    connectionId: uuidv7(),
    connector: 'salesforce',
    runId: uuidv7(),
    status,
    pulled: 0,
    pushed: 0,
    skipped: 0,
    failed: status === 'failed' ? 1 : 0,
  });

const alertsOf = async (f: OrgFixture, rule: string) =>
  (await executeQuery(listAlertsQuery, { limit: 200 }, f.ctx(), ports)).filter((x) => x.rule === rule);

beforeAll(async () => {
  admin = adminClient();
  ({ a, b } = await twoOrgs());
});
afterAll(async () => {
  await admin.end();
  await closePools();
});

describe('alert rules fed by the batch 3l modules (outbox subscribers)', () => {
  it('a successful sync raises nothing; a failed one raises one warning, exactly once', async () => {
    expect(await consumeEvent(alertEvaluator(deps), run(a, 'succeeded'))).toBe(true);
    expect(await alertsOf(a, 'integrationFailed')).toHaveLength(0);
    const failed = run(a, 'failed');
    expect(await consumeEvent(alertEvaluator(deps), failed)).toBe(true);
    expect(await consumeEvent(alertEvaluator(deps), failed)).toBe(false);
    const found = await alertsOf(a, 'integrationFailed');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ state: 'open', severity: 'warning', count: 1 });
    expect(await alertsOf(b, 'integrationFailed')).toHaveLength(0);
  });

  it('a connection revoked at the provider makes the same alert critical', async () => {
    const revoked = outboxEvent(a, 'integrations.connection_revoked', {
      connectionId: uuidv7(),
      connector: 'salesforce',
      reason: 'provider',
    });
    expect(await consumeEvent(alertEvaluator(deps), revoked)).toBe(true);
    const found = await alertsOf(a, 'integrationFailed');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: 'critical', count: 2 });
    expect(await alertsOf(b, 'integrationFailed')).toHaveLength(0);
  });

  it('a plan subscription past due raises one billing alert, critical when unpaid, resolved when paid', async () => {
    const subId = `sub_${uuidv7().slice(-12)}`;
    const setStatus = async (status: string) => {
      await admin`
        insert into billing.subscriptions
          (org_id, provider, provider_subscription_id, provider_customer_id, status, last_event_at)
        values (${a.org.id}, 'fake', ${subId}, ${`cus_${a.org.id.slice(-8)}`}, ${status}, now())
        on conflict (org_id, provider, provider_subscription_id) do update set status = excluded.status`;
      return consumeEvent(
        alertEvaluator(deps),
        outboxEvent(a, 'billing.subscription_changed', { status, planKey: null, grandfathered: false }),
      );
    };
    expect(await setStatus('past_due')).toBe(true);
    let found = await alertsOf(a, 'billingPastDue');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ state: 'open', severity: 'warning', count: 1 });
    await setStatus('unpaid');
    found = await alertsOf(a, 'billingPastDue');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: 'critical', count: 1 });
    await setStatus('active');
    expect(await alertsOf(a, 'billingPastDue')).toHaveLength(0);
    const resolved = (
      await executeQuery(listAlertsQuery, { status: 'resolved', limit: 200 }, a.ctx(), ports)
    ).filter((x) => x.rule === 'billingPastDue');
    expect(resolved).toHaveLength(1);
    expect(await alertsOf(b, 'billingPastDue')).toHaveLength(0);
  });
});
