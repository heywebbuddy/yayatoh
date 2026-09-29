import type { TenantTx } from '@yayatoh/db';
import { findEventTx, findOccurrenceTx } from '@yayatoh/events';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { chartKeyTx, onChart } from './chart.ts';
import {
  blockingHits,
  evaluateSeatRules,
  type RuleContext,
  type RuleHit,
  type SeatingRule,
} from './domain/rules.ts';
import { eventLayouts, eventSeats, RULE_SEVERITIES, seatingRules } from './schema.ts';

export const MAX_RELEASE_DAYS = 365;
export const MAX_SEATS_PER_ORDER = 50;

const Severity = z.enum(RULE_SEVERITIES);
/** One rule as stored, read and shown (allowlisted: public pages show the organizer's policy). */
export const SeatingRuleDto = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ada_reserved'),
    severity: Severity,
    params: z.object({ releaseDays: z.int().min(0).max(MAX_RELEASE_DAYS) }),
  }),
  z.object({
    kind: z.literal('max_per_order_seats'),
    severity: Severity,
    params: z.object({ max: z.int().min(1).max(MAX_SEATS_PER_ORDER) }),
  }),
]);
export type SeatingRuleDto = z.infer<typeof SeatingRuleDto>;

/** A rule hit on the wire (warnings shown to staff after a sale or assignment). */
export const RuleHitDto = z.discriminatedUnion('rule', [
  z.object({
    rule: z.literal('ada_reserved'),
    severity: Severity,
    seats: z.array(z.uuid()),
    releaseAt: z.date(),
  }),
  z.object({
    rule: z.literal('max_per_order_seats'),
    severity: Severity,
    max: z.int(),
    count: z.int(),
  }),
]);

/**
 * When "days before the event" count from: the chosen date's start for a multi-date event
 * (M1.7g), else the event's. Null when the event (or that date of it) doesn't exist.
 */
export async function ruleStartTx(
  tx: TenantTx,
  eventId: string,
  occurrenceId?: string | null,
): Promise<Date | null> {
  if (occurrenceId) {
    const occ = await findOccurrenceTx(tx, occurrenceId);
    if (occ && occ.eventId === eventId) return occ.startsAt;
  }
  return (await findEventTx(tx, eventId))?.startsAt ?? null;
}

/** The event's seating rules (valid rows only; a malformed row is ignored rather than trusted). */
export async function seatingRulesTx(tx: TenantTx, eventId: string): Promise<SeatingRule[]> {
  const rows = await tx
    .select({ kind: seatingRules.kind, severity: seatingRules.severity, params: seatingRules.params })
    .from(seatingRules)
    .where(eq(seatingRules.eventId, eventId))
    .orderBy(seatingRules.kind);
  return rows.flatMap((r) => {
    const parsed = SeatingRuleDto.safeParse(r);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * Replace an event's seating rules (M1.7f). Rules left out are switched off. The event needs a
 * floor plan. Warn is the default severity (decision D18).
 */
export const setSeatingRulesCommand = tenantCommand({
  name: 'seating.setRules',
  input: z.object({
    eventId: z.uuid(),
    rules: z
      .array(SeatingRuleDto)
      .max(2)
      .refine((rs) => new Set(rs.map((r) => r.kind)).size === rs.length, {
        message: 'One rule of each kind',
        path: ['rules'],
      }),
  }),
  output: z.array(SeatingRuleDto),
  entitlement: 'seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const [layout] = await tx
      .select({ id: eventLayouts.id })
      .from(eventLayouts)
      .where(onChart(eventLayouts, input.eventId, null));
    if (!layout) throw new DomainError('not_found', 'This event has no floor plan');
    const kinds = input.rules.map((r) => r.kind);
    const current = await tx
      .select({ kind: seatingRules.kind })
      .from(seatingRules)
      .where(eq(seatingRules.eventId, input.eventId));
    const gone = current.map((c) => c.kind).filter((k) => !kinds.includes(k as SeatingRuleDto['kind']));
    if (gone.length)
      await tx
        .delete(seatingRules)
        .where(and(eq(seatingRules.eventId, input.eventId), inArray(seatingRules.kind, gone)));
    for (const r of input.rules)
      await tx
        .insert(seatingRules)
        .values({ orgId, eventId: input.eventId, kind: r.kind, severity: r.severity, params: r.params })
        .onConflictDoUpdate({
          target: [seatingRules.orgId, seatingRules.eventId, seatingRules.kind],
          set: { severity: r.severity, params: r.params, updatedAt: ctx.now },
        });
    return seatingRulesTx(tx, input.eventId);
  },
  audit: (input) => ({
    action: 'seating.rules_set',
    targetType: 'event',
    targetId: input.eventId,
    data: { rules: input.rules.map((r) => ({ kind: r.kind, severity: r.severity, ...r.params })) },
  }),
});

export const seatingRulesQuery = tenantQuery({
  name: 'seating.rules',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(SeatingRuleDto),
  entitlement: 'seating',
  permission: 'events:read',
  handler: async ({ input, tx }) => seatingRulesTx(tx, input.eventId),
});

/**
 * Check a choice of seats against the event's rules inside the caller's transaction (checkout,
 * box office, assignment). Enforced rules refuse (`validation_failed`, reason `seat_rule`, with
 * the rule and whether staff could override it); warnings are returned for the caller to show.
 */
export async function checkSeatRulesTx(
  tx: TenantTx,
  ctx: Ctx,
  check: {
    eventId: string;
    /** The date the seats are for (M1.7g): its chart and its start. */
    occurrenceId?: string | null;
    seatUuids: readonly string[];
    context: RuleContext;
    override?: boolean;
  },
): Promise<RuleHit[]> {
  const ids = [...new Set(check.seatUuids)];
  if (ids.length === 0) return [];
  const rules = await seatingRulesTx(tx, check.eventId);
  if (rules.length === 0) return [];
  const startsAt = await ruleStartTx(tx, check.eventId, check.occurrenceId);
  if (!startsAt) throw new DomainError('not_found', 'Event not found');
  const key = await chartKeyTx(tx, check.eventId, check.occurrenceId);
  const seats = await tx
    .select({ seatUuid: eventSeats.seatUuid, accessible: eventSeats.accessible })
    .from(eventSeats)
    .where(and(onChart(eventSeats, check.eventId, key), inArray(eventSeats.seatUuid, ids)));
  const hits = evaluateSeatRules(rules, {
    context: check.context,
    seats,
    startsAt,
    now: ctx.now,
  });
  const [blocking] = blockingHits(hits, { context: check.context, override: check.override ?? false });
  if (blocking)
    throw new DomainError('validation_failed', 'A seating rule does not allow this choice', {
      reason: 'seat_rule',
      rule: blocking.rule,
      overridable: check.context !== 'checkout',
      ...(blocking.rule === 'max_per_order_seats'
        ? { max: blocking.max }
        : { releaseAt: blocking.releaseAt.toISOString(), seats: blocking.seats }),
    });
  return hits;
}
