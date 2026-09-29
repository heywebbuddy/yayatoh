import type { TenantTx } from '@yayatoh/db';
import type { EventDto } from '@yayatoh/events';
import { type Ctx, requireOrg } from '@yayatoh/kernel';
import { ALERTS_CHANNEL, type Notifier, publishRealtimeTx } from '@yayatoh/platform';
import { memberUserIdsTx, ORG_ROLES, roleCan } from '@yayatoh/tenancy';
import { eq, sql } from 'drizzle-orm';
import {
  type AlertCategory,
  type AlertState,
  fixPath,
  type HistoryAction,
  type RoutingChannel,
  RULE_KEYS,
  RULES,
  type RuleKey,
  routeFor,
  type Severity,
  THRESHOLDS,
} from './domain/config.ts';
import { type Firing, type PlanAction, planAlert, planNotifies, stateAfter } from './domain/lifecycle.ts';
import { evaluateEventRules, evaluateOrgRules } from './domain/rules.ts';
import { eventFactsTx, orgFactsTx } from './facts.ts';
import { alertHistory, alerts, memberSettings, routing } from './schema.ts';

/** What the engine needs from the composition root. */
export interface AlertDeps {
  readonly notifier: Notifier;
}

/** One alert that changed in an evaluation (for callers, tests and logs). */
export interface AlertChange {
  readonly alertId: string;
  readonly rule: RuleKey;
  readonly eventId: string | null;
  readonly action: PlanAction['kind'];
  readonly notified: boolean;
}

type AlertRow = typeof alerts.$inferSelect;

/** Message kinds (notifications registry): in-app, email and push now; texts wait out quiet hours. */
export const ALERT_KIND = 'alerts.alert';
export const ALERT_TEXT_KIND = 'alerts.alert-text';

const EVENT_RULES = RULE_KEYS.filter((k) => RULES[k].scope === 'event');
const ORG_RULES = RULE_KEYS.filter((k) => RULES[k].scope === 'org');

/** Serialize evaluations of one scope (an event, or the org's own rules). */
async function lockScopeTx(tx: TenantTx, orgId: string, scopeKey: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`alerts:${orgId}:${scopeKey}`}, 0))`);
}

async function historyTx(
  tx: TenantTx,
  orgId: string,
  row: Pick<AlertRow, 'id' | 'state' | 'count'>,
  action: HistoryAction,
  at: Date,
  actorUserId: string | null = null,
) {
  await tx
    .insert(alertHistory)
    .values({ orgId, alertId: row.id, action, state: row.state, count: row.count, actorUserId, at });
}

/** Tell open consoles (the org's alerts channel): ids and state only; they re-read the alert. */
export async function publishAlertTx(
  tx: TenantTx,
  orgId: string,
  row: Pick<AlertRow, 'id' | 'eventId' | 'state' | 'severity'>,
  at: Date,
) {
  await publishRealtimeTx(tx, orgId, ALERTS_CHANNEL, {
    event: 'alert',
    data: {
      alertId: row.id,
      eventId: row.eventId,
      state: row.state,
      severity: row.severity,
      at: at.toISOString(),
    },
  });
}

/** Saved routing rows as `role:category` → channels. */
export async function savedRoutingTx(tx: TenantTx): Promise<Map<string, RoutingChannel[]>> {
  const rows = await tx.select().from(routing);
  return new Map(rows.map((r) => [`${r.role}:${r.category}`, r.channels as RoutingChannel[]]));
}

/**
 * Send an alert to the members its routing reaches (M3.2b): each member whose role may see the
 * rule and whose role's routing for the rule's group lists channels. In-app, email and push go
 * out at once (transactional, `alerts.alert`); a text goes to the member's own alert number
 * (`alerts.alert-text`, which waits out quiet hours). One delivery per member, channel and
 * sending (`notify_count`), so a replayed evaluation never sends twice.
 */
async function notifyTx(
  tx: TenantTx,
  row: AlertRow,
  event: EventDto | null,
  deps: AlertDeps,
): Promise<number> {
  const rule = RULES[row.rule as RuleKey];
  const saved = await savedRoutingTx(tx);
  const phones = new Map(
    (await tx.select().from(memberSettings)).map((s) => [s.userId, s.smsPhone] as const),
  );
  const params = {
    rule: row.rule,
    count: row.count,
    severity: row.severity,
    eventName: event?.name ?? 'none',
  };
  const href = fixPath(row.rule as RuleKey, event?.slug ?? null);
  let queued = 0;
  for (const m of await memberUserIdsTx(tx, ORG_ROLES)) {
    if (!roleCan(m.role as (typeof ORG_ROLES)[number], rule.permission)) continue;
    const channels = routeFor(saved, m.role, rule.category as AlertCategory);
    const now = channels.filter((c) => c !== 'sms');
    const key = `alert:${row.id}:${row.notifyCount}:${m.userId}`;
    if (now.length)
      queued += (
        await deps.notifier.enqueue(tx, {
          kind: ALERT_KIND,
          to: { userId: m.userId },
          channels: now,
          params: { ...params, _href: href },
          dedupeKey: key,
          eventId: row.eventId,
          href,
        })
      ).queued;
    const phone = phones.get(m.userId);
    if (channels.includes('sms') && phone)
      queued += (
        await deps.notifier.enqueue(tx, {
          kind: ALERT_TEXT_KIND,
          to: { userId: m.userId, phone },
          channels: ['sms'],
          params: { ...params, _href: href },
          dedupeKey: `${key}:sms`,
          eventId: row.eventId,
        })
      ).queued;
  }
  return queued;
}

/**
 * Reconcile one scope's stored alerts with what fires now: open new ones, update counts, resolve
 * what cleared, reopen what came back, and wake snoozes and timed-out acknowledgements. Runs under
 * the scope's advisory lock, so concurrent evaluations (the subscriber and the sweep) serialize;
 * every step is recomputed from the sources, so evaluating twice changes nothing.
 */
async function reconcileTx(
  tx: TenantTx,
  ctx: Ctx,
  scope: { eventId: string | null; event: EventDto | null; rules: readonly RuleKey[] },
  firing: Partial<Record<RuleKey, Firing>>,
  deps: AlertDeps,
  now: Date,
): Promise<AlertChange[]> {
  const orgId = requireOrg(ctx);
  const scopeKey = scope.eventId ?? 'org';
  const stored = new Map(
    (await tx.select().from(alerts).where(eq(alerts.scopeKey, scopeKey))).map((r) => [r.rule, r]),
  );
  const changes: AlertChange[] = [];
  for (const rule of scope.rules) {
    const f = firing[rule] ?? null;
    const s = stored.get(rule) ?? null;
    const timeout = f?.liveCritical ? THRESHOLDS.liveCriticalAckTimeoutMs : THRESHOLDS.ackTimeoutMs;
    const plan = planAlert(
      s
        ? {
            state: s.state as AlertState,
            severity: s.severity as Severity,
            count: s.count,
            acknowledgedAt: s.acknowledgedAt,
            snoozedUntil: s.snoozedUntil,
          }
        : null,
      f,
      now,
      timeout,
    );
    if (plan.kind === 'none') continue;
    let row: AlertRow;
    if (plan.kind === 'fire' && f) {
      const [inserted] = await tx
        .insert(alerts)
        .values({
          orgId,
          eventId: scope.eventId,
          rule,
          scopeKey,
          category: RULES[rule].category,
          severity: f.severity,
          state: 'open',
          count: f.count,
          params: { ...f.params },
          firstFiredAt: now,
          openedAt: now,
          evaluatedAt: now,
        })
        .returning();
      if (!inserted) continue;
      row = inserted;
      await historyTx(tx, orgId, row, 'fired', now);
    } else if (s) {
      const state = stateAfter(s.state as AlertState, plan) ?? s.state;
      const set: Partial<typeof alerts.$inferInsert> = { state, evaluatedAt: now, updatedAt: now };
      if (f) Object.assign(set, { count: f.count, severity: f.severity, params: { ...f.params } });
      if (plan.kind === 'resolve')
        Object.assign(set, {
          resolvedAt: now,
          acknowledgedAt: null,
          acknowledgedBy: null,
          snoozedUntil: null,
        });
      if (plan.kind === 'reopen')
        Object.assign(set, { openedAt: now, resolvedAt: null, reopenCount: s.reopenCount + 1 });
      if (plan.kind === 'wake') Object.assign(set, { openedAt: now, snoozedUntil: null });
      if (plan.kind === 'ackTimeout')
        Object.assign(set, { openedAt: now, acknowledgedAt: null, acknowledgedBy: null });
      const [updated] = await tx.update(alerts).set(set).where(eq(alerts.id, s.id)).returning();
      if (!updated) continue;
      row = updated;
      const action: HistoryAction =
        plan.kind === 'resolve'
          ? 'resolved'
          : plan.kind === 'reopen'
            ? 'reopened'
            : plan.kind === 'wake'
              ? 'woke'
              : plan.kind === 'ackTimeout'
                ? 'ack_expired'
                : 'updated';
      await historyTx(tx, orgId, row, action, now);
    } else continue;
    let notified = false;
    if (planNotifies(plan)) {
      await notifyTx(tx, row, scope.event, deps);
      const [after] = await tx
        .update(alerts)
        .set({ lastNotifiedAt: now, notifyCount: row.notifyCount + 1 })
        .where(eq(alerts.id, row.id))
        .returning();
      if (after) row = after;
      await historyTx(tx, orgId, row, 'notified', now);
      notified = true;
    }
    await publishAlertTx(tx, orgId, row, now);
    changes.push({ alertId: row.id, rule, eventId: scope.eventId, action: plan.kind, notified });
  }
  return changes;
}

/** Evaluate every event rule for one event (inside the org's tenant transaction). */
export async function evaluateEventAlertsTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  deps: AlertDeps,
  now: Date = ctx.now,
): Promise<AlertChange[]> {
  await lockScopeTx(tx, requireOrg(ctx), eventId);
  const gathered = await eventFactsTx(tx, eventId, now);
  if (!gathered) return [];
  const firing = evaluateEventRules(gathered.facts, now);
  return reconcileTx(tx, ctx, { eventId, event: gathered.event, rules: EVENT_RULES }, firing, deps, now);
}

/** Evaluate the org-level rules (domains, payout account, deliverability, failures). */
export async function evaluateOrgAlertsTx(
  tx: TenantTx,
  ctx: Ctx,
  deps: AlertDeps,
  now: Date = ctx.now,
): Promise<AlertChange[]> {
  await lockScopeTx(tx, requireOrg(ctx), 'org');
  const firing = evaluateOrgRules(await orgFactsTx(tx, now));
  return reconcileTx(tx, ctx, { eventId: null, event: null, rules: ORG_RULES }, firing, deps, now);
}
