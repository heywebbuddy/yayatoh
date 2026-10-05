import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { emitEvents, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { actorCanTx, memberUserId, requireActorTx } from '../access.ts';
import { dayIn } from '../compute.ts';
import { addDays } from '../dashboard.ts';
import { alertRules } from '../schema.ts';
import { orgTimeZoneTx } from '../sync.ts';
import type { AnalyticsWarehouse } from '../warehouse/port.ts';
import { lazyWarehouse } from '../warehouse/select.ts';
import {
  isRuleMoney,
  MAX_RULES_PER_ORG,
  MAX_THRESHOLD,
  RULE_CONDITIONS,
  RULE_MEASURES,
  RULE_SEVERITIES,
  RULE_STATES,
  RULE_WINDOWS,
  type RuleMeasure,
} from './catalog.ts';
import { changePct, measureValue, ruleFires } from './evaluate.ts';

/**
 * Organizer-authored alert rules (M6.2b) on the M3.2b engine. Analytics owns the rules and
 * measures them from the warehouse; the alerts module (same tier) owns the alert instances, so
 * each change of a rule's state goes through the outbox as `analytics.alert_rule_evaluated@1`
 * (numbers, vocabulary and the rule's name only), and the alerts subscriber opens, updates or
 * resolves the rule's alert and sends it through its routing — with quiet hours in each
 * recipient's time zone when the rule asks for them.
 *
 * Writing rules needs `alerts:manage`; money rules also `finance:read` (and reading them too).
 */
export const RULE_EVALUATED_EVENT = 'analytics.alert_rule_evaluated';

export const RuleEvaluatedPayload = z.object({
  ruleId: z.uuid(),
  name: z.string().max(80),
  firing: z.boolean(),
  /** False when the rule was switched off or deleted: its alert resolves. */
  active: z.boolean(),
  measure: z.enum(RULE_MEASURES),
  condition: z.enum(RULE_CONDITIONS),
  threshold: z.number().int(),
  windowDays: z.number().int(),
  currency: z.string(),
  severity: z.enum(RULE_SEVERITIES),
  quietHours: z.boolean(),
  money: z.boolean(),
  value: z.number().int(),
  previous: z.number().int(),
  changePct: z.number().int().nullable(),
});
export type RuleEvaluatedPayload = z.infer<typeof RuleEvaluatedPayload>;

const RuleFields = z.object({
  name: z.string().trim().min(1).max(80),
  measure: z.enum(RULE_MEASURES),
  condition: z.enum(RULE_CONDITIONS),
  threshold: z.int().min(0).max(MAX_THRESHOLD),
  windowDays: z.int().refine((w) => (RULE_WINDOWS as readonly number[]).includes(w), {
    message: 'Choose 1, 7, 14 or 30 days',
  }),
  currency: z
    .string()
    .regex(/^([A-Z]{3})?$/)
    .default(''),
  eventId: z.uuid().nullable().default(null),
  severity: z.enum(RULE_SEVERITIES).default('warning'),
  quietHours: z.boolean().default(true),
});

export const AlertRuleDto = z.object({
  id: z.uuid(),
  name: z.string(),
  measure: z.enum(RULE_MEASURES),
  condition: z.enum(RULE_CONDITIONS),
  threshold: z.int(),
  windowDays: z.int(),
  currency: z.string(),
  eventId: z.uuid().nullable(),
  severity: z.enum(RULE_SEVERITIES),
  quietHours: z.boolean(),
  enabled: z.boolean(),
  state: z.enum(RULE_STATES).nullable(),
  lastValue: z.int().nullable(),
  lastEvaluatedAt: z.date().nullable(),
});
export type AlertRuleDto = z.infer<typeof AlertRuleDto>;

type RuleRow = typeof alertRules.$inferSelect;
const toDto = (r: RuleRow): AlertRuleDto =>
  AlertRuleDto.parse({
    id: r.id,
    name: r.name,
    measure: r.measure,
    condition: r.condition,
    threshold: r.threshold,
    windowDays: r.windowDays,
    currency: r.currency,
    eventId: r.eventId,
    severity: r.severity,
    quietHours: r.quietHours,
    enabled: r.enabled,
    state: r.lastState,
    lastValue: r.lastValue,
    lastEvaluatedAt: r.lastEvaluatedAt,
  });

/** Field rules shared by create and edit (pure checks; the database checks again). */
function checkFields(input: z.output<typeof RuleFields>) {
  const money = isRuleMoney(input.measure);
  if (money && !input.currency)
    throw new DomainError('validation_failed', 'Choose a currency', { reason: 'currency_required' });
  if (
    (input.condition === 'rise' || input.condition === 'drop') &&
    (input.threshold < 1 || input.threshold > 1000)
  )
    throw new DomainError('validation_failed', 'A change is between 1 % and 1000 %', {
      reason: 'percent_range',
    });
  return { ...input, currency: money ? input.currency : '' };
}

/** The rule's value over its window (the last N days, today included, org time) and the N before. */
export async function ruleWindowValuesTx(
  ctx: Ctx,
  tx: TenantTx,
  warehouse: AnalyticsWarehouse,
  rule: Pick<RuleRow, 'measure' | 'currency' | 'windowDays' | 'eventId'>,
): Promise<{ current: number; previous: number }> {
  const tz = await orgTimeZoneTx(tx, requireOrg(ctx));
  const to = dayIn(ctx.now, tz);
  const from = addDays(to, -(rule.windowDays - 1));
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(rule.windowDays - 1));
  const ev = rule.eventId ? { eventId: rule.eventId } : {};
  const rows = await warehouse.dailyTotals({ ctx, tx }, { from: prevFrom, to, ...ev });
  const m = rule.measure as RuleMeasure;
  return {
    current: measureValue(
      rows.filter((r) => r.day >= from),
      m,
      rule.currency,
    ),
    previous: measureValue(
      rows.filter((r) => r.day <= prevTo),
      m,
      rule.currency,
    ),
  };
}

function payloadOf(r: RuleRow, firing: boolean, active: boolean, current: number, previous: number) {
  return RuleEvaluatedPayload.parse({
    ruleId: r.id,
    name: r.name,
    firing,
    active,
    measure: r.measure,
    condition: r.condition,
    threshold: r.threshold,
    windowDays: r.windowDays,
    currency: r.currency,
    severity: r.severity,
    quietHours: r.quietHours,
    money: isRuleMoney(r.measure as RuleMeasure),
    value: current,
    previous,
    changePct: changePct(current, previous),
  });
}

const evaluatedEvent = (p: RuleEvaluatedPayload): DomainEvent => ({
  type: RULE_EVALUATED_EVENT,
  version: 1,
  aggregateType: 'analytics_alert_rule',
  aggregateId: p.ruleId,
  payload: p,
});

/**
 * Measure one rule now and record it. Returns the outbox event when its state or (while firing)
 * its value changed, else null: evaluating again with nothing new emits nothing, so the alert is
 * never sent twice for the same reading. A switched-off rule that was firing resolves.
 */
export async function evaluateRuleTx(
  ctx: Ctx,
  tx: TenantTx,
  warehouse: AnalyticsWarehouse,
  rule: RuleRow,
  opts: { force?: boolean } = {},
): Promise<DomainEvent | null> {
  if (!rule.enabled) {
    if (rule.lastState !== 'firing' && !opts.force) return null;
    await tx
      .update(alertRules)
      .set({ lastState: null, lastValue: null, lastEvaluatedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(alertRules.id, rule.id));
    return evaluatedEvent(payloadOf(rule, false, false, rule.lastValue ?? 0, 0));
  }
  const { current, previous } = await ruleWindowValuesTx(ctx, tx, warehouse, rule);
  const firing = ruleFires(
    {
      measure: rule.measure as RuleMeasure,
      condition: rule.condition as 'above',
      threshold: rule.threshold,
      currency: rule.currency,
    },
    current,
    previous,
  );
  const state = firing ? 'firing' : 'ok';
  const changed = rule.lastState !== state || (firing && rule.lastValue !== current);
  await tx
    .update(alertRules)
    .set({ lastState: state, lastValue: current, lastEvaluatedAt: ctx.now })
    .where(eq(alertRules.id, rule.id));
  // A rule that has never fired and does not fire now needs no alert at all.
  if (!changed && !opts.force) return null;
  if (!firing && rule.lastState !== 'firing' && !opts.force) return null;
  return evaluatedEvent(payloadOf(rule, firing, true, current, previous));
}

/** Evaluate every rule of the org (worker tick, dev route), emitting what changed. */
export async function evaluateAlertRulesTx(
  ctx: Ctx,
  tx: TenantTx,
  warehouse: AnalyticsWarehouse = lazyWarehouse(),
): Promise<{ evaluated: number; emitted: number }> {
  // One evaluation of an org's rules at a time (the tick and a dev drain).
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`an:rules:${requireOrg(ctx)}`}, 0))`);
  const rules = await tx.select().from(alertRules).orderBy(asc(alertRules.createdAt));
  const events: DomainEvent[] = [];
  let evaluated = 0;
  for (const r of rules) {
    if (!r.enabled && r.lastState !== 'firing') continue;
    evaluated += 1;
    const e = await evaluateRuleTx(ctx, tx, warehouse, r);
    if (e) events.push(e);
  }
  await emitEvents(tx, ctx, events);
  return { evaluated, emitted: events.length };
}

export const listAlertRulesQuery = tenantQuery({
  name: 'analytics.listAlertRules',
  input: z.object({}),
  output: z.array(AlertRuleDto),
  entitlement: 'analytics_pro',
  permission: 'orders:read',
  handler: async ({ ctx, tx }) => {
    const money = await actorCanTx(tx, ctx, 'finance:read');
    const rows = await tx.select().from(alertRules).orderBy(asc(alertRules.name));
    return rows.filter((r) => money || !isRuleMoney(r.measure as RuleMeasure)).map(toDto);
  },
});

async function loadRuleTx(tx: TenantTx, ctx: Ctx, ruleId: string): Promise<RuleRow> {
  const [row] = await tx.select().from(alertRules).where(eq(alertRules.id, ruleId));
  if (!row) throw new DomainError('not_found', 'Rule not found');
  if (isRuleMoney(row.measure as RuleMeasure) && !(await actorCanTx(tx, ctx, 'finance:read')))
    throw new DomainError('not_found', 'Rule not found');
  return row;
}

export const getAlertRuleQuery = tenantQuery({
  name: 'analytics.getAlertRule',
  input: z.object({ ruleId: z.uuid() }),
  output: AlertRuleDto,
  entitlement: 'analytics_pro',
  permission: 'orders:read',
  handler: async ({ input, ctx, tx }) => toDto(await loadRuleTx(tx, ctx, input.ruleId)),
});

async function checkEventTx(tx: TenantTx, eventId: string | null) {
  if (eventId && !(await findEventTx(tx, eventId))) throw new DomainError('not_found', 'Event not found');
}

async function nameTakenTx(tx: TenantTx, name: string, except?: string) {
  const rows = await tx.select({ id: alertRules.id, name: alertRules.name }).from(alertRules);
  return rows.some((r) => r.id !== except && r.name.toLowerCase() === name.toLowerCase());
}

export function alertRuleCommands(warehouse: AnalyticsWarehouse) {
  const createAlertRuleCommand = tenantCommand({
    name: 'analytics.createAlertRule',
    input: RuleFields,
    output: AlertRuleDto,
    entitlement: 'analytics_pro',
    permission: 'alerts:manage',
    handler: async ({ input, ctx, tx, emit }) => {
      const f = checkFields(input);
      if (isRuleMoney(f.measure)) await requireActorTx(tx, ctx, 'finance:read');
      await checkEventTx(tx, f.eventId);
      if (await nameTakenTx(tx, f.name))
        throw new DomainError('conflict', 'A rule with this name exists', { reason: 'name_taken' });
      const count = (await tx.select({ id: alertRules.id }).from(alertRules)).length;
      if (count >= MAX_RULES_PER_ORG)
        throw new DomainError('validation_failed', 'Too many rules', { reason: 'too_many_rules' });
      const [row] = await tx
        .insert(alertRules)
        .values({ orgId: requireOrg(ctx), ...f, createdBy: memberUserId(ctx) })
        .returning();
      if (!row) throw new Error('createAlertRule: insert returned nothing');
      const e = await evaluateRuleTx(ctx, tx, warehouse, row);
      if (e) emit(e);
      return toDto(await loadRuleTx(tx, ctx, row.id));
    },
    audit: (_i, out) => ({
      action: 'analytics.alert_rule_created',
      targetType: 'analytics_alert_rule',
      targetId: out.id,
      data: { kind: out.measure },
    }),
  });

  const updateAlertRuleCommand = tenantCommand({
    name: 'analytics.updateAlertRule',
    input: RuleFields.extend({ ruleId: z.uuid() }),
    output: AlertRuleDto,
    entitlement: 'analytics_pro',
    permission: 'alerts:manage',
    handler: async ({ input, ctx, tx, emit }) => {
      const { ruleId, ...rest } = input;
      const before = await loadRuleTx(tx, ctx, ruleId);
      const f = checkFields(rest);
      if (isRuleMoney(f.measure)) await requireActorTx(tx, ctx, 'finance:read');
      await checkEventTx(tx, f.eventId);
      if (await nameTakenTx(tx, f.name, ruleId))
        throw new DomainError('conflict', 'A rule with this name exists', { reason: 'name_taken' });
      const [row] = await tx
        .update(alertRules)
        .set({ ...f, updatedAt: ctx.now })
        .where(eq(alertRules.id, ruleId))
        .returning();
      if (!row) throw new DomainError('not_found', 'Rule not found');
      // An edit re-measures at once; the alert follows (a firing rule's new reading is sent on).
      const e = await evaluateRuleTx(ctx, tx, warehouse, row, { force: before.lastState === 'firing' });
      if (e) emit(e);
      return toDto(await loadRuleTx(tx, ctx, row.id));
    },
    audit: (input) => ({
      action: 'analytics.alert_rule_updated',
      targetType: 'analytics_alert_rule',
      targetId: input.ruleId,
      data: { kind: input.measure },
    }),
  });

  const setAlertRuleEnabledCommand = tenantCommand({
    name: 'analytics.setAlertRuleEnabled',
    input: z.object({ ruleId: z.uuid(), enabled: z.boolean() }),
    output: AlertRuleDto,
    entitlement: 'analytics_pro',
    permission: 'alerts:manage',
    handler: async ({ input, ctx, tx, emit }) => {
      const before = await loadRuleTx(tx, ctx, input.ruleId);
      const [row] = await tx
        .update(alertRules)
        .set({ enabled: input.enabled, updatedAt: ctx.now })
        .where(eq(alertRules.id, input.ruleId))
        .returning();
      if (!row) throw new DomainError('not_found', 'Rule not found');
      const e = await evaluateRuleTx(ctx, tx, warehouse, row, { force: before.lastState === 'firing' });
      if (e) emit(e);
      return toDto(await loadRuleTx(tx, ctx, row.id));
    },
    audit: (input) => ({
      action: input.enabled ? 'analytics.alert_rule_enabled' : 'analytics.alert_rule_disabled',
      targetType: 'analytics_alert_rule',
      targetId: input.ruleId,
    }),
  });

  const deleteAlertRuleCommand = tenantCommand({
    name: 'analytics.deleteAlertRule',
    input: z.object({ ruleId: z.uuid() }),
    output: z.object({ deleted: z.literal(true) }),
    entitlement: 'analytics_pro',
    permission: 'alerts:manage',
    category: 'delete',
    handler: async ({ input, ctx, tx, emit }) => {
      const row = await loadRuleTx(tx, ctx, input.ruleId);
      await tx.delete(alertRules).where(eq(alertRules.id, row.id));
      // Its alert resolves (and stays resolved: the rule is gone).
      if (row.lastState === 'firing')
        emit(evaluatedEvent(payloadOf(row, false, false, row.lastValue ?? 0, 0)));
      return { deleted: true as const };
    },
    audit: (input) => ({
      action: 'analytics.alert_rule_deleted',
      targetType: 'analytics_alert_rule',
      targetId: input.ruleId,
    }),
  });

  return {
    createAlertRuleCommand,
    updateAlertRuleCommand,
    setAlertRuleEnabledCommand,
    deleteAlertRuleCommand,
  };
}

export const {
  createAlertRuleCommand,
  updateAlertRuleCommand,
  setAlertRuleEnabledCommand,
  deleteAlertRuleCommand,
} = alertRuleCommands(lazyWarehouse());
