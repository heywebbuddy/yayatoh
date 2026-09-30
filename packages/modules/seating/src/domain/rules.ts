/**
 * Seating rules (M1.7f, decision D18: warn by default). Pure: the same evaluation runs on the
 * server (checkout, box office, assignment) and in the browser (warnings as seats are chosen).
 */
export type RuleSeverity = 'warn' | 'enforce';

export type SeatingRule =
  | {
      readonly kind: 'ada_reserved';
      readonly severity: RuleSeverity;
      /** Accessible seats are kept back until this many days before the event starts. */
      readonly params: { readonly releaseDays: number };
    }
  | {
      readonly kind: 'max_per_order_seats';
      readonly severity: RuleSeverity;
      /** At most this many seats in one order. */
      readonly params: { readonly max: number };
    };

/** Where a seat choice is made: a buyer online, staff at the box office, the organizer seating guests. */
export type RuleContext = 'checkout' | 'box_office' | 'assign';

export type RuleHit =
  | {
      readonly rule: 'ada_reserved';
      readonly severity: RuleSeverity;
      /** The accessible seats chosen while they are kept back. */
      readonly seats: readonly string[];
      readonly releaseAt: Date;
    }
  | {
      readonly rule: 'max_per_order_seats';
      readonly severity: RuleSeverity;
      readonly max: number;
      readonly count: number;
    };

const DAY_MS = 86_400_000;

/** When kept-back accessible seats are released to everyone. */
export function adaReleaseAt(releaseDays: number, startsAt: Date): Date {
  return new Date(startsAt.getTime() - releaseDays * DAY_MS);
}

/** The `ada_reserved` rule while it keeps accessible seats back (null once released or absent). */
export function activeAdaRule(
  rules: readonly SeatingRule[],
  startsAt: Date,
  now: Date,
): { severity: RuleSeverity; releaseAt: Date } | null {
  const rule = rules.find((r) => r.kind === 'ada_reserved');
  if (rule?.kind !== 'ada_reserved') return null;
  const releaseAt = adaReleaseAt(rule.params.releaseDays, startsAt);
  return now < releaseAt ? { severity: rule.severity, releaseAt } : null;
}

/**
 * What the rules say about a choice of seats. `max_per_order_seats` is about orders, so it never
 * applies to the organizer seating guests.
 */
export function evaluateSeatRules(
  rules: readonly SeatingRule[],
  choice: {
    readonly context: RuleContext;
    readonly seats: readonly { readonly seatUuid: string; readonly accessible: boolean }[];
    readonly startsAt: Date;
    readonly now: Date;
  },
): RuleHit[] {
  const hits: RuleHit[] = [];
  const ada = activeAdaRule(rules, choice.startsAt, choice.now);
  if (ada) {
    const seats = choice.seats.filter((s) => s.accessible).map((s) => s.seatUuid);
    if (seats.length)
      hits.push({ rule: 'ada_reserved', severity: ada.severity, seats, releaseAt: ada.releaseAt });
  }
  const cap = rules.find((r) => r.kind === 'max_per_order_seats');
  if (cap && cap.kind === 'max_per_order_seats' && choice.context !== 'assign') {
    const count = new Set(choice.seats.map((s) => s.seatUuid)).size;
    if (count > cap.params.max)
      hits.push({ rule: 'max_per_order_seats', severity: cap.severity, max: cap.params.max, count });
  }
  return hits;
}

/**
 * Hits that stop the choice: enforced rules. Staff (the box office, the organizer) may override
 * them on purpose — a buyer at the door who needs an accessible seat — and the override is
 * audited; buyers online never can.
 */
export function blockingHits(
  hits: readonly RuleHit[],
  opts: { readonly context: RuleContext; readonly override: boolean },
): RuleHit[] {
  if (opts.override && opts.context !== 'checkout') return [];
  return hits.filter((h) => h.severity === 'enforce');
}
