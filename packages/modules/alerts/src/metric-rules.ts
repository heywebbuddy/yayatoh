import type { TenantTx } from '@yayatoh/db';
import { type Ctx, requireOrg } from '@yayatoh/kernel';
import type { PublishedEvent } from '@yayatoh/platform';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { METRIC_RULES, metricScopeKey, type RuleKey, SEVERITIES, type Severity } from './domain/config.ts';
import type { Firing } from './domain/lifecycle.ts';
import { type AlertChange, type AlertDeps, reconcileTx } from './engine.ts';
import { alerts } from './schema.ts';

/**
 * Organizer-authored alert rules (M6.2b). The analytics module (same tier) owns the rules and
 * measures them from its warehouse; each change of a rule's state reaches this engine as the
 * outbox event `analytics.alert_rule_evaluated@1`. The rule's alert then follows the M3.2b
 * lifecycle like any other: one alert per rule (scope `m:{ruleId}`), opened when it fires,
 * updated with each new reading, resolved when it clears (or the rule is switched off or
 * deleted), reopened when it fires again, acknowledged and snoozed by people. It goes to members
 * by the routing of its group (sales; payments for money rules, which only finance can see), in
 * the app, by email and by push — never by text. With `quietHours`, email and push wait out quiet
 * hours in the recipient's time zone (`alerts.metric`); without, they go at once
 * (`alerts.metric-now`).
 */
export const METRIC_RULE_EVENT = 'analytics.alert_rule_evaluated';
export const METRIC_KIND = 'alerts.metric';
export const METRIC_NOW_KIND = 'alerts.metric-now';

/** The payload as this module reads it (its own copy: analytics is not imported). */
const Payload = z.looseObject({
  ruleId: z.uuid(),
  name: z.string().min(1).max(80),
  firing: z.boolean(),
  active: z.boolean(),
  measure: z.string().max(40),
  threshold: z.number().int(),
  windowDays: z.number().int(),
  currency: z.string().max(3),
  severity: z.enum(SEVERITIES),
  quietHours: z.boolean(),
  money: z.boolean(),
  value: z.number().int(),
  previous: z.number().int(),
  changePct: z.number().int().nullable(),
});

const MAX_COUNT = 2_147_483_647;

/** A reading as text for the message (money in major units with its currency). */
export function readingText(value: number, money: boolean, currency: string): string {
  if (!money) return new Intl.NumberFormat('en').format(value);
  try {
    const digits =
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ??
      2;
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(value / 10 ** digits);
  } catch {
    return `${value} ${currency}`;
  }
}

/** Apply one `analytics.alert_rule_evaluated@1` event (inside the subscriber's tenant transaction). */
export async function applyMetricRuleTx(
  tx: TenantTx,
  ctx: Ctx,
  event: Pick<PublishedEvent, 'payload'>,
  deps: AlertDeps,
): Promise<AlertChange[]> {
  const parsed = Payload.safeParse(event.payload);
  if (!parsed.success) return [];
  const p = parsed.data;
  const orgId = requireOrg(ctx);
  const scopeKey = metricScopeKey(p.ruleId);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`alerts:${orgId}:${scopeKey}`}, 0))`);
  const rule: RuleKey = p.money ? 'metricRuleFinance' : 'metricRule';
  // A rule edited from a count to money (or back) changes key: the old key's alert resolves.
  const other: RuleKey = p.money ? 'metricRule' : 'metricRuleFinance';
  const firing: Firing | null =
    p.firing && p.active
      ? {
          severity: p.severity as Severity,
          count: Math.min(Math.abs(p.value), MAX_COUNT),
          params: {
            value: p.value,
            previous: p.previous,
            threshold: p.threshold,
            windowDays: p.windowDays,
            quiet: p.quietHours ? 1 : 0,
            ...(p.changePct === null ? {} : { changePct: p.changePct }),
          },
          liveCritical: false,
        }
      : null;
  const message = {
    kind: p.quietHours ? METRIC_KIND : METRIC_NOW_KIND,
    params: {
      title: p.name,
      reading: readingText(p.value, p.money, p.currency),
      windowDays: p.windowDays,
      severity: p.severity,
    },
  };
  const now = ctx.now;
  const changes = await reconcileTx(
    tx,
    ctx,
    { eventId: null, event: null, rules: [other, rule], scopeKey, title: p.name, message },
    firing ? { [rule]: firing } : {},
    deps,
    now,
  );
  return changes;
}

/**
 * The sweep's part for custom rules (M3.2b timing): a snooze that ended or an acknowledgement
 * that timed out on a rule alert that is still firing opens it again and sends it again. The
 * reading is the last one analytics reported (the alert row holds it).
 */
export async function sweepMetricAlertsTx(
  tx: TenantTx,
  ctx: Ctx,
  deps: AlertDeps,
  now: Date = ctx.now,
): Promise<AlertChange[]> {
  const rows = await tx
    .select()
    .from(alerts)
    .where(and(inArray(alerts.rule, [...METRIC_RULES]), ne(alerts.state, 'resolved')));
  const changes: AlertChange[] = [];
  for (const r of rows) {
    if (r.state === 'open') continue;
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`alerts:${requireOrg(ctx)}:${r.scopeKey}`}, 0))`,
    );
    const [fresh] = await tx.select().from(alerts).where(eq(alerts.id, r.id));
    if (!fresh || fresh.state === 'resolved' || fresh.state === 'open') continue;
    const params = fresh.params ?? {};
    const rule = fresh.rule as RuleKey;
    changes.push(
      ...(await reconcileTx(
        tx,
        ctx,
        {
          eventId: null,
          event: null,
          rules: [rule],
          scopeKey: fresh.scopeKey,
          title: fresh.title,
          // Sent again with the rule's own quiet-hours choice; the reading is on the alert page.
          message: {
            kind: params.quiet === 0 ? METRIC_NOW_KIND : METRIC_KIND,
            params: {
              title: fresh.title ?? '',
              reading: 'none',
              windowDays: Number(params.windowDays ?? 1),
              severity: fresh.severity,
            },
          },
        },
        {
          [rule]: {
            severity: fresh.severity as Severity,
            count: fresh.count,
            params: Object.fromEntries(
              Object.entries(params).filter((e): e is [string, number] => typeof e[1] === 'number'),
            ),
            liveCritical: false,
          },
        },
        deps,
        now,
      )),
    );
  }
  return changes;
}
