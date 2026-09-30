import { z } from 'zod';

/**
 * M3.6 segment DSL, version 1: a typed audience definition over the org's contacts and the crm
 * projections (`event_participation`, `contact_profile`, the consent ledger). It is pure (zod
 * only) so the builder in the browser validates with the same schema as the server, which
 * compiles it to parameterized SQL (`compileSegment`). Every value a person types reaches SQL as
 * a bound parameter; operators and columns come from fixed tables keyed by enum values.
 */

export const SEGMENT_VERSION = 1;
/** Groups nest at most this deep (the root is depth 1). */
export const MAX_SEGMENT_DEPTH = 3;
/** Conditions (leaves) in one definition, all groups together. */
export const MAX_SEGMENT_CONDITIONS = 30;
export const MAX_GROUP_ITEMS = 20;
export const MAX_TICKET_TYPES = 20;

/** A calendar date (YYYY-MM-DD), read in the org's timezone. */
export const SegmentDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s),
    {
      message: 'Invalid date',
    },
  );

/** Labels match the attendee label rules (M1.8f): trimmed, inner whitespace collapsed, 1–40 characters. */
export const SegmentLabel = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1).max(40));

export const SCOPE_KINDS = ['any', 'event', 'series', 'previousEdition', 'eventsBetween'] as const;

/**
 * Which events a participation, spend or label condition looks at. `previousEdition` is
 * series-relative: the edition of the event's series that started last before that event
 * ("last year's"). `eventsBetween` is events starting between two dates (inclusive).
 */
export const SegmentScope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('any') }).strict(),
  z.object({ kind: z.literal('event'), eventId: z.uuid() }).strict(),
  z.object({ kind: z.literal('series'), seriesId: z.uuid() }).strict(),
  z.object({ kind: z.literal('previousEdition'), eventId: z.uuid() }).strict(),
  z
    .object({ kind: z.literal('eventsBetween'), from: SegmentDate, to: SegmentDate })
    .strict()
    .refine((v) => v.from <= v.to, { message: 'from must not be after to', path: ['to'] }),
]);
export type SegmentScope = z.infer<typeof SegmentScope>;

export const COMPARISONS = ['gte', 'gt', 'lte', 'lt', 'eq'] as const;
export type Comparison = (typeof COMPARISONS)[number];
export const PARTICIPATION_ROLES = ['attendee', 'buyer'] as const;
export const TOTAL_METRICS = ['events', 'eventsAttended', 'tickets', 'orders'] as const;
export const CONSENT_CHANNEL_KEYS = ['email', 'sms'] as const;

const TriState = z.boolean().nullable().default(null);

/**
 * Took part (or, `negate`, did not) in an event in scope: as an attendee (on the list: an active
 * ticket or a guest) or as a buyer (a paid order). Optional refinements apply to the same
 * contact × event row: held a ticket of one of these types, has a seat, checked in, registered
 * between two dates.
 */
export const ParticipationCondition = z
  .object({
    type: z.literal('participation'),
    scope: SegmentScope,
    negate: z.boolean().default(false),
    role: z.enum(PARTICIPATION_ROLES).default('attendee'),
    ticketTypeIds: z.array(z.uuid()).max(MAX_TICKET_TYPES).default([]),
    seated: TriState,
    checkedIn: TriState,
    registeredFrom: SegmentDate.nullable().default(null),
    registeredTo: SegmentDate.nullable().default(null),
  })
  .strict()
  .refine((v) => !v.registeredFrom || !v.registeredTo || v.registeredFrom <= v.registeredTo, {
    message: 'from must not be after to',
    path: ['registeredTo'],
  });

/** Spent (as the buyer, net of refunds) in one currency across the events in scope. */
export const SpendCondition = z
  .object({
    type: z.literal('spend'),
    scope: SegmentScope,
    currency: z.string().regex(/^[A-Z]{3}$/),
    op: z.enum(COMPARISONS),
    amountMinor: z.int().min(0).max(1_000_000_000_000),
  })
  .strict();

/** The current marketing consent on a channel (no ledger row means no consent). */
export const ConsentCondition = z
  .object({ type: z.literal('consent'), channel: z.enum(CONSENT_CHANNEL_KEYS), granted: z.boolean() })
  .strict();

/** Had (or, `negate`, never had) an attendee label at an event in scope. */
export const LabelCondition = z
  .object({
    type: z.literal('label'),
    scope: SegmentScope,
    label: SegmentLabel,
    negate: z.boolean().default(false),
  })
  .strict();

/** Lifetime totals from the contact profile. */
export const TotalsCondition = z
  .object({
    type: z.literal('totals'),
    metric: z.enum(TOTAL_METRICS),
    op: z.enum(COMPARISONS),
    value: z.int().min(0).max(1_000_000),
  })
  .strict();

/** First or last seen (registration times) between two dates; either end may be open. */
export const SeenCondition = z
  .object({
    type: z.literal('seen'),
    which: z.enum(['first', 'last']),
    from: SegmentDate.nullable().default(null),
    to: SegmentDate.nullable().default(null),
  })
  .strict()
  .refine((v) => v.from !== null || v.to !== null, { message: 'A date is required', path: ['from'] })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'from must not be after to', path: ['to'] });

export const SegmentCondition = z.discriminatedUnion('type', [
  ParticipationCondition,
  SpendCondition,
  ConsentCondition,
  LabelCondition,
  TotalsCondition,
  SeenCondition,
]);
export type SegmentCondition = z.infer<typeof SegmentCondition>;
export type SegmentConditionInput = z.input<typeof SegmentCondition>;
export const CONDITION_TYPES = ['participation', 'spend', 'consent', 'label', 'totals', 'seen'] as const;
export type ConditionType = (typeof CONDITION_TYPES)[number];

export interface SegmentGroup {
  readonly type: 'group';
  readonly op: 'and' | 'or';
  readonly conditions: readonly SegmentNode[];
}
export type SegmentNode = SegmentCondition | SegmentGroup;

export const SegmentGroup: z.ZodType<SegmentGroup, unknown> = z.lazy(() =>
  z
    .object({
      type: z.literal('group'),
      op: z.enum(['and', 'or']),
      conditions: z.array(z.union([SegmentCondition, SegmentGroup])).max(MAX_GROUP_ITEMS),
    })
    .strict(),
);

function measure(node: SegmentNode, depth: number): { depth: number; leaves: number } {
  if (node.type !== 'group') return { depth: depth - 1, leaves: 1 };
  let max = depth;
  let leaves = 0;
  for (const c of node.conditions) {
    const m = measure(c, depth + 1);
    max = Math.max(max, m.depth);
    leaves += m.leaves;
  }
  return { depth: max, leaves };
}

/**
 * A whole definition. An empty group places no restriction (the empty root is every contact).
 * Limits keep a definition small enough to explain and cheap enough to count.
 */
export const SegmentDefinition = z
  .object({ version: z.literal(SEGMENT_VERSION), root: SegmentGroup })
  .strict()
  .superRefine((v, ctx) => {
    const m = measure(v.root, 1);
    if (m.depth > MAX_SEGMENT_DEPTH)
      ctx.addIssue({
        code: 'custom',
        message: `Groups nest at most ${MAX_SEGMENT_DEPTH} deep`,
        path: ['root'],
      });
    if (m.leaves > MAX_SEGMENT_CONDITIONS)
      ctx.addIssue({
        code: 'custom',
        message: `At most ${MAX_SEGMENT_CONDITIONS} conditions`,
        path: ['root'],
      });
  });
export type SegmentDefinition = z.infer<typeof SegmentDefinition>;

/** Every scope a definition mentions (the server resolves them to event ids before compiling). */
export function segmentScopes(def: SegmentDefinition): SegmentScope[] {
  const out: SegmentScope[] = [];
  const walk = (n: SegmentNode) => {
    if (n.type === 'group') n.conditions.forEach(walk);
    else if ('scope' in n) out.push(n.scope);
  };
  walk(def.root);
  return out;
}

/** A stable key for a scope (resolution maps are keyed by it). */
export const scopeKey = (s: SegmentScope): string => {
  switch (s.kind) {
    case 'any':
      return 'any';
    case 'event':
      return `event:${s.eventId}`;
    case 'series':
      return `series:${s.seriesId}`;
    case 'previousEdition':
      return `previousEdition:${s.eventId}`;
    case 'eventsBetween':
      return `eventsBetween:${s.from}:${s.to}`;
  }
};

/** Does the definition use conditions that read org-wide profile data (not tied to an event)? */
export function usesProfileConditions(def: SegmentDefinition): boolean {
  let found = false;
  const walk = (n: SegmentNode) => {
    if (n.type === 'group') n.conditions.forEach(walk);
    else if (n.type === 'totals' || n.type === 'seen') found = true;
  };
  walk(def.root);
  return found;
}

export const emptySegment = (): SegmentDefinition => ({
  version: SEGMENT_VERSION,
  root: { type: 'group', op: 'and', conditions: [] },
});
