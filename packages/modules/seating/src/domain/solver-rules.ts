import { z } from 'zod';

/**
 * Seating rules for the solver (M6.12a, decision P6-10). The host builds them per event; the
 * tabu search (`domain/solver.ts`) proposes a plan that keeps the hard ones and scores the soft
 * ones. Pure and browser-safe: the editor's Web Worker and the accept command read the same
 * rules the same way.
 *
 * Kinds:
 * - `keep_together`: every party at one table (`party`), or everyone of a tag or side (an
 *   association: "Acme Corp", "Bride") at one table.
 * - `keep_apart`: two parties, tags or sides never share a table.
 * - `vip_near_stage`: VIP parties at the tables nearest the stage.
 * - `access_near_exit`: parties with a tag (the host's accessibility tag) at the tables nearest
 *   an exit or entrance. The sealed accessibility answers (P4-3) are never read.
 * - `table_max`: at most this many people at a table (room for a centrepiece or a late guest).
 *
 * Hard rules are never broken by a proposal; soft rules cost their weight (1–10) per breach.
 */
export const SOLVER_RULE_KINDS = [
  'keep_together',
  'keep_apart',
  'vip_near_stage',
  'access_near_exit',
  'table_max',
] as const;
export type SolverRuleKind = (typeof SOLVER_RULE_KINDS)[number];

export const SOLVER_STRENGTHS = ['hard', 'soft'] as const;
export type SolverStrength = (typeof SOLVER_STRENGTHS)[number];

export const MIN_RULE_WEIGHT = 1;
export const MAX_RULE_WEIGHT = 10;
export const DEFAULT_RULE_WEIGHT = 5;
/** At most this many solver rules per event. */
export const MAX_SOLVER_RULES = 50;
/** The tag `access_near_exit` reads unless the host names another. */
export const DEFAULT_ACCESS_TAG = 'Accessibility';

const value = z.string().trim().min(1).max(40);

/** Who a rule is about: one party, or everyone whose party carries a tag or a side. */
export const RuleTarget = z.discriminatedUnion('by', [
  z.object({ by: z.literal('party'), value: z.uuid() }),
  z.object({ by: z.literal('tag'), value }),
  z.object({ by: z.literal('side'), value }),
]);
export type RuleTarget = z.infer<typeof RuleTarget>;

/** A keep-together group: each party on its own, or everyone of a tag or side. */
export const TogetherGroup = z.discriminatedUnion('by', [
  z.object({ by: z.literal('party') }),
  z.object({ by: z.literal('tag'), value }),
  z.object({ by: z.literal('side'), value }),
]);
export type TogetherGroup = z.infer<typeof TogetherGroup>;

export const SolverRuleSpec = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('keep_together'), params: z.object({ group: TogetherGroup }) }),
  z.object({
    kind: z.literal('keep_apart'),
    params: z.object({ a: RuleTarget, b: RuleTarget }).refine((p) => !sameTarget(p.a, p.b), {
      message: 'Choose two different groups',
      path: ['b'],
    }),
  }),
  z.object({ kind: z.literal('vip_near_stage'), params: z.object({}) }),
  z.object({ kind: z.literal('access_near_exit'), params: z.object({ tag: value }) }),
  z.object({ kind: z.literal('table_max'), params: z.object({ max: z.int().min(1).max(40) }) }),
]);
export type SolverRuleSpec = z.infer<typeof SolverRuleSpec>;

export const SolverRuleShape = z.object({
  strength: z.enum(SOLVER_STRENGTHS),
  weight: z.int().min(MIN_RULE_WEIGHT).max(MAX_RULE_WEIGHT),
});

/** A stored rule: its spec, hard or soft, and its weight (soft rules only count it). */
export type SolverRule = SolverRuleSpec & {
  readonly id: string;
  readonly strength: SolverStrength;
  readonly weight: number;
};

export function sameTarget(a: RuleTarget, b: RuleTarget): boolean {
  return (
    a.by === b.by &&
    (a.by === 'party' ? a.value === b.value : a.value.toLowerCase() === b.value.toLowerCase())
  );
}

/** Two rules that say the same thing (the builder refuses the second). */
export function sameRule(a: SolverRuleSpec, b: SolverRuleSpec): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'keep_together': {
      const g = (b as typeof a).params.group;
      const h = a.params.group;
      return (
        h.by === g.by && (h.by === 'party' || h.value.toLowerCase() === (g as typeof h).value.toLowerCase())
      );
    }
    case 'keep_apart': {
      const o = (b as typeof a).params;
      return (
        (sameTarget(a.params.a, o.a) && sameTarget(a.params.b, o.b)) ||
        (sameTarget(a.params.a, o.b) && sameTarget(a.params.b, o.a))
      );
    }
    case 'access_near_exit':
      return a.params.tag.toLowerCase() === (b as typeof a).params.tag.toLowerCase();
    default:
      // One VIP rule and one table maximum per event.
      return true;
  }
}
