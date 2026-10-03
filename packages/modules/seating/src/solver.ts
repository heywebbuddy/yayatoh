import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { fitAt } from './domain/guest-seating.ts';
import { compile, evaluate, planGeometry, type SolverProblem } from './domain/solver.ts';
import {
  DEFAULT_RULE_WEIGHT,
  MAX_RULE_WEIGHT,
  MAX_SOLVER_RULES,
  MIN_RULE_WEIGHT,
  SOLVER_STRENGTHS,
  type SolverRule,
  SolverRuleSpec,
  sameRule,
} from './domain/solver-rules.ts';
import { lockChartTx, onContext, publishSeatsTx, viewTx } from './guest-seating.ts';
import { guestSeats, solverRules } from './schema.ts';

/**
 * Seating rules and the solver (M6.12a, decision P6-10; module `ai_seating`, P6-13).
 *
 * The host keeps rules per event (`solver_rules`). The editor reads the chart as a
 * `SolverProblem` (`seating.solverSetup`), runs the tabu search in a Web Worker and edits the
 * proposal there; nothing is stored until the host accepts a table, or all of them, through
 * `seating.acceptSeatingProposal`. Accepting never touches a manual placement: guests already
 * seated are fixed inputs, and a proposal that would move one is refused (`already_seated`).
 * The command checks capacity and the hard rules again with the solver's own `evaluate`.
 */

const Strength = z.enum(SOLVER_STRENGTHS);
const Weight = z.int().min(MIN_RULE_WEIGHT).max(MAX_RULE_WEIGHT);

export const SolverRuleDto = z.intersection(
  SolverRuleSpec,
  z.object({ id: z.uuid(), strength: Strength, weight: Weight }),
);
export type SolverRuleDto = z.infer<typeof SolverRuleDto>;

const PointDto = z.object({ x: z.number(), y: z.number() });

export const SolverProblemDto = z.object({
  places: z.array(
    z.object({ itemId: z.uuid(), capacity: z.int(), taken: z.int(), x: z.number(), y: z.number() }),
  ),
  guests: z.array(
    z.object({
      id: z.uuid(),
      partyId: z.uuid(),
      vip: z.boolean(),
      side: z.string().nullable(),
      tags: z.array(z.string()),
    }),
  ),
  /** Manual placements (guests seated now): guest id → table. Never moved. */
  fixed: z.record(z.uuid(), z.uuid()),
  rules: z.array(SolverRuleDto),
  stages: z.array(PointDto),
  exits: z.array(PointDto),
});
export type SolverProblemDto = z.infer<typeof SolverProblemDto>;

/* ------------------------------------------------------------------ reads ---- */

export async function solverRulesTx(tx: TenantTx, eventId: string): Promise<SolverRule[]> {
  const rows = await tx
    .select({
      id: solverRules.id,
      kind: solverRules.kind,
      strength: solverRules.strength,
      weight: solverRules.weight,
      params: solverRules.params,
    })
    .from(solverRules)
    .where(eq(solverRules.eventId, eventId))
    .orderBy(asc(solverRules.createdAt), asc(solverRules.id));
  return rows.flatMap((r) => {
    const parsed = SolverRuleDto.safeParse(r);
    return parsed.success ? [parsed.data as SolverRule] : [];
  });
}

/**
 * The chart as the solver sees it: each table's room (seats less tickets, attendee seats and
 * guests who declined but are still seated), its centre, the stages and exits, everyone still
 * to come (declined guests left out) and who sits where now.
 */
export async function solverProblemTx(
  tx: TenantTx,
  eventId: string,
  subEventId: string | null,
): Promise<{ problem: SolverProblem; view: Awaited<ReturnType<typeof viewTx>> }> {
  const [view, rules] = await Promise.all([viewTx(tx, eventId, subEventId), solverRulesTx(tx, eventId)]);
  const geo = view.chart.doc
    ? planGeometry(view.chart.doc)
    : { centres: new Map<string, { x: number; y: number }>(), stages: [], exits: [] };
  const coming = new Set<string>();
  const guests = view.parties.flatMap((party) =>
    party.guests
      .filter((g) => g.status !== 'declined')
      .map((g) => {
        coming.add(g.id);
        return { id: g.id, partyId: party.id, vip: party.vip, side: party.side, tags: [...party.tags] };
      }),
  );
  const declinedHere = new Map<string, number>();
  const fixed: Record<string, string> = {};
  for (const s of view.placed) {
    if (coming.has(s.guestId)) fixed[s.guestId] = s.itemId;
    else declinedHere.set(s.itemId, (declinedHere.get(s.itemId) ?? 0) + 1);
  }
  const places = view.chart.places.map((p) => {
    const taken = view.taken.get(p.itemId) ?? 0;
    const c = geo.centres.get(p.itemId) ?? { x: 0, y: 0 };
    return {
      itemId: p.itemId,
      capacity: Math.max(0, p.capacity - taken - (declinedHere.get(p.itemId) ?? 0)),
      taken: taken + (declinedHere.get(p.itemId) ?? 0),
      x: Math.round(c.x),
      y: Math.round(c.y),
    };
  });
  const round = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });
  return {
    problem: { places, guests, fixed, rules, stages: geo.stages.map(round), exits: geo.exits.map(round) },
    view,
  };
}

const ContextInput = z.object({ eventId: z.uuid(), subEventId: z.uuid().nullable().default(null) });

/** The solver's input for a chart (rules included). Console only: tags, sides and VIP flags. */
export const solverSetupQuery = tenantQuery({
  name: 'seating.solverSetup',
  input: ContextInput,
  output: SolverProblemDto,
  entitlement: 'ai_seating',
  permission: 'guests:read',
  handler: async ({ input, tx }) =>
    SolverProblemDto.parse((await solverProblemTx(tx, input.eventId, input.subEventId)).problem),
});

/** The event's solver rules (the rule builder). */
export const solverRulesQuery = tenantQuery({
  name: 'seating.solverRules',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(SolverRuleDto),
  entitlement: 'ai_seating',
  permission: 'guests:read',
  handler: async ({ input, tx }) => z.array(SolverRuleDto).parse(await solverRulesTx(tx, input.eventId)),
});

/* ------------------------------------------------------------- rule builder ---- */

async function eventPartyIdsTx(tx: TenantTx, eventId: string): Promise<Set<string>> {
  const { parties } = await viewTx(tx, eventId, null);
  return new Set(parties.map((p) => p.id));
}

function partyTargets(spec: SolverRuleSpec): string[] {
  if (spec.kind !== 'keep_apart') return [];
  return [spec.params.a, spec.params.b].flatMap((t) => (t.by === 'party' ? [t.value] : []));
}

export const AddSolverRuleInput = z.object({
  eventId: z.uuid(),
  spec: SolverRuleSpec,
  strength: Strength.default('soft'),
  weight: Weight.default(DEFAULT_RULE_WEIGHT),
});

/**
 * Add a rule. Refused when the event already has a rule saying the same thing
 * (`duplicate_rule`), has 50 rules, or a party it names isn't on this event's list.
 */
export const addSolverRuleCommand = tenantCommand({
  name: 'seating.addSolverRule',
  input: AddSolverRuleInput,
  output: SolverRuleDto,
  entitlement: 'ai_seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    if (!(await findEventTx(tx, input.eventId))) throw new DomainError('not_found', 'Event not found');
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`solver-rules:${input.eventId}`}, 0))`,
    );
    const current = await solverRulesTx(tx, input.eventId);
    if (current.length >= MAX_SOLVER_RULES)
      throw new DomainError('conflict', `At most ${MAX_SOLVER_RULES} rules`, { reason: 'too_many_rules' });
    if (current.some((r) => sameRule(r, input.spec)))
      throw new DomainError('conflict', 'This event already has that rule', { reason: 'duplicate_rule' });
    const named = partyTargets(input.spec);
    if (named.length) {
      const known = await eventPartyIdsTx(tx, input.eventId);
      if (named.some((p) => !known.has(p)))
        throw new DomainError('not_found', 'Party not found', { field: 'spec', reason: 'unknown_party' });
    }
    const [row] = await tx
      .insert(solverRules)
      .values({
        orgId,
        eventId: input.eventId,
        kind: input.spec.kind,
        strength: input.strength,
        weight: input.weight,
        params: input.spec.params,
      })
      .returning({ id: solverRules.id });
    return SolverRuleDto.parse({
      ...input.spec,
      id: row?.id,
      strength: input.strength,
      weight: input.weight,
    });
  },
  audit: (input, out) => ({
    action: 'seating.solver_rule.add',
    targetType: 'event',
    targetId: input.eventId,
    data: { ruleId: out.id, kind: input.spec.kind, strength: input.strength, weight: input.weight },
  }),
});

/** Make a rule hard or soft, or change its weight. */
export const updateSolverRuleCommand = tenantCommand({
  name: 'seating.updateSolverRule',
  input: z.object({ eventId: z.uuid(), ruleId: z.uuid(), strength: Strength, weight: Weight }),
  output: SolverRuleDto,
  entitlement: 'ai_seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(solverRules)
      .set({ strength: input.strength, weight: input.weight, updatedAt: ctx.now })
      .where(and(eq(solverRules.eventId, input.eventId), eq(solverRules.id, input.ruleId)))
      .returning({
        id: solverRules.id,
        kind: solverRules.kind,
        strength: solverRules.strength,
        weight: solverRules.weight,
        params: solverRules.params,
      });
    if (!row) throw new DomainError('not_found', 'Rule not found');
    return SolverRuleDto.parse(row);
  },
  audit: (input) => ({
    action: 'seating.solver_rule.update',
    targetType: 'event',
    targetId: input.eventId,
    data: { ruleId: input.ruleId, strength: input.strength, weight: input.weight },
  }),
});

export const removeSolverRuleCommand = tenantCommand({
  name: 'seating.removeSolverRule',
  input: z.object({ eventId: z.uuid(), ruleId: z.uuid() }),
  output: z.object({ removed: z.boolean() }),
  entitlement: 'ai_seating',
  permission: 'seating:write',
  handler: async ({ input, tx }) => {
    const gone = await tx
      .delete(solverRules)
      .where(and(eq(solverRules.eventId, input.eventId), eq(solverRules.id, input.ruleId)))
      .returning({ id: solverRules.id });
    if (!gone.length) throw new DomainError('not_found', 'Rule not found');
    return { removed: true };
  },
  audit: (input) => ({
    action: 'seating.solver_rule.remove',
    targetType: 'event',
    targetId: input.eventId,
    data: { ruleId: input.ruleId },
  }),
});

/* ---------------------------------------------------------------- accepting ---- */

/** At most this many guests in one accept (every table of a large ballroom). */
export const MAX_ACCEPT_GUESTS = 2_000;

export const AcceptProposalInput = ContextInput.extend({
  tables: z
    .array(z.object({ itemId: z.uuid(), guestIds: z.array(z.uuid()).min(1).max(500) }))
    .min(1)
    .max(1_000)
    .refine((ts) => new Set(ts.map((t) => t.itemId)).size === ts.length, {
      message: 'Each table once',
      path: ['tables'],
    })
    .refine(
      (ts) => {
        const all = ts.flatMap((t) => t.guestIds);
        return all.length <= MAX_ACCEPT_GUESTS && new Set(all).size === all.length;
      },
      { message: 'Each guest once', path: ['tables'] },
    ),
});

export const AcceptProposalResult = z.object({
  /** Guests given a table (guests already at the proposed table count as kept, not seated). */
  seated: z.int(),
  tables: z.int(),
});

export const HardRuleBreachDto = z.object({
  kind: z.string(),
  ruleId: z.uuid().nullable(),
  itemIds: z.array(z.uuid()),
});

/**
 * Accept a proposal: one table, several or all. All or nothing per call, under the chart's
 * lock. Refused when a guest is already seated elsewhere (`already_seated`: manual placements are
 * never overwritten), has declined, isn't on the chart's list, when a table can't hold them
 * (`cant_fit`) or when the result would break a hard rule (`hard_rule`, with the breaches).
 * Idempotent: the editor sends an Idempotency-Key per accept, so a retry gives the same answer.
 */
export const acceptSeatingProposalCommand = tenantCommand({
  name: 'seating.acceptSeatingProposal',
  input: AcceptProposalInput,
  output: AcceptProposalResult,
  entitlement: 'ai_seating',
  permission: 'seating:write',
  idempotent: true,
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    await lockChartTx(tx, input.eventId, input.subEventId);
    const { problem, view } = await solverProblemTx(tx, input.eventId, input.subEventId);
    if (!view.chart.doc)
      throw new DomainError('not_found', 'There is no seating plan', { reason: 'no_plan' });
    const seatedAt = new Map(view.placed.map((s) => [s.guestId, s.itemId]));
    const moving: { itemId: string; guestId: string }[] = [];
    for (const t of input.tables) {
      const place = view.places.get(t.itemId);
      if (!place)
        throw new DomainError('validation_failed', 'Choose a table or row of the plan', {
          field: 'tables',
          reason: 'not_a_place',
        });
      for (const id of t.guestIds) {
        const k = view.known.get(id);
        if (!k)
          throw new DomainError('not_found', 'Guest not found', { field: 'tables', reason: 'unknown_guest' });
        if (k.guest.status === 'declined')
          throw new DomainError('invalid_state', 'This guest declined', { reason: 'declined', guestId: id });
        const now = seatedAt.get(id);
        if (now && now !== t.itemId)
          throw new DomainError('conflict', 'A guest in this proposal was seated by hand since', {
            reason: 'already_seated',
            guestId: id,
          });
        if (!now) moving.push({ itemId: t.itemId, guestId: id });
      }
      const fit = fitAt(
        {
          itemId: place.itemId,
          capacity: place.capacity,
          taken: view.taken.get(place.itemId) ?? 0,
          vip: false,
        },
        view.placed,
        t.guestIds,
      );
      if (!fit.ok)
        throw new DomainError('conflict', `Only ${fit.fits} more fit at ${place.label}`, {
          reason: 'cant_fit',
          itemId: place.itemId,
          asked: fit.asked,
          fits: fit.fits,
        });
    }
    // The hard rules, judged as the solver judges them, on who would sit where.
    const accepted = new Set(moving.map((m) => m.guestId));
    const after: Record<string, string> = { ...problem.fixed };
    for (const m of moving) after[m.guestId] = m.itemId;
    const acceptedTables = new Set(input.tables.map((t) => t.itemId));
    const before = new Set(evaluate(compile(problem), problem.fixed).hard.map((v) => JSON.stringify(v)));
    const breaches = evaluate(compile(problem), after).hard.filter(
      (v) =>
        !before.has(JSON.stringify(v)) &&
        (v.guestIds.some((g) => accepted.has(g)) || v.itemIds.some((i) => acceptedTables.has(i))),
    );
    if (breaches.length)
      throw new DomainError('conflict', 'This would break a hard rule', {
        reason: 'hard_rule',
        breaches: breaches.slice(0, 20).map((b) => ({ kind: b.kind, ruleId: b.ruleId, itemIds: b.itemIds })),
      });
    if (moving.length) {
      // A stale place (a table the chart lost) goes first: one place per guest per chart.
      await tx.delete(guestSeats).where(
        and(
          onContext(input.eventId, input.subEventId),
          inArray(
            guestSeats.guestId,
            moving.map((m) => m.guestId),
          ),
        ),
      );
      await tx.insert(guestSeats).values(
        moving.map((m) => ({
          orgId,
          eventId: input.eventId,
          subEventId: input.subEventId,
          guestId: m.guestId,
          itemId: m.itemId,
        })),
      );
      await publishSeatsTx(
        tx,
        orgId,
        input.eventId,
        input.subEventId,
        moving.map((m) => m.itemId),
        ctx.now,
      );
    }
    return { seated: moving.length, tables: input.tables.length };
  },
  audit: (input, out) => ({
    action: 'seating.proposal.accept',
    targetType: 'event',
    targetId: input.eventId,
    data: { subEventId: input.subEventId, tables: out.tables, seated: out.seated },
  }),
});
