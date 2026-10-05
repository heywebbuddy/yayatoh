import { withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import type { ReportDeps } from './reports/run.ts';
import { runDueReports } from './reports/run.ts';
import { evaluateAlertRulesTx } from './rules/rules.ts';
import type { AnalyticsWarehouse } from './warehouse/port.ts';
import { lazyWarehouse } from './warehouse/select.ts';

/**
 * One org's analytics tick (M6.2b; the worker runs it every minute for orgs with alert rules or
 * report schedules, the dev route on demand): evaluate the organizer's alert rules (changes go
 * to the alerts engine through the outbox), then send the reports that are due.
 */
export async function analyticsOrgTick(
  orgId: string,
  deps: ReportDeps & { warehouse?: AnalyticsWarehouse },
  now: Date = new Date(),
) {
  const warehouse = deps.warehouse ?? lazyWarehouse();
  const ctx = { ...createCtx({ orgId, actor: { type: 'system', name: 'analytics.tick' } }), now };
  const rules = await withTenant(ctx, (tx) => evaluateAlertRulesTx(ctx, tx, warehouse));
  const reports = await runDueReports(orgId, { ...deps, warehouse }, now);
  return { rules, reports };
}
