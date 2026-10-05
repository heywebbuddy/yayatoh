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
    }
  | {
      /**
       * M6.11a: companion seats are sold only with an accessible seat in the same order, at most
       * `maxPerAccessible` per accessible seat. Ends with the `ada_reserved` release, when there
       * is one (the seats then go to everyone).
       */
      readonly kind: 'ada_companion';
      readonly severity: RuleSeverity;
      readonly params: { readonly maxPerAccessible: number };
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
    }
  | {
      readonly rule: 'ada_companion';
      readonly severity: RuleSeverity;
      /** The companion seats chosen beyond what the accessible seats allow. */
      readonly seats: readonly string[];
      /** Companion seats allowed per accessible seat, and the accessible seats chosen. */
      readonly maxPerAccessible: number;
      readonly accessible: number;
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
 * The `ada_companion` rule while it applies (M6.11a): until the `ada_reserved` release when that
 * rule exists, else always. Null when absent or released.
 */
export function activeCompanionRule(
  rules: readonly SeatingRule[],
  startsAt: Date,
  now: Date,
): { severity: RuleSeverity; maxPerAccessible: number } | null {
  const rule = rules.find((r) => r.kind === 'ada_companion');
  if (rule?.kind !== 'ada_companion') return null;
  const ada = rules.find((r) => r.kind === 'ada_reserved');
  if (ada?.kind === 'ada_reserved' && now >= adaReleaseAt(ada.params.releaseDays, startsAt)) return null;
  return { severity: rule.severity, maxPerAccessible: rule.params.maxPerAccessible };
}

/**
 * What the rules say about a choice of seats. `max_per_order_seats` and `ada_companion` are
 * about orders, so they never apply to the organizer seating guests. A buyer who says someone in
 * the party needs an accessible seat (`accessibleNeed`, M6.11a; staff say it for them at the box
 * office) may take kept-back accessible and companion seats.
 */
export function evaluateSeatRules(
  rules: readonly SeatingRule[],
  choice: {
    readonly context: RuleContext;
    readonly seats: readonly {
      readonly seatUuid: string;
      readonly accessible: boolean;
      readonly companion?: boolean;
    }[];
    readonly startsAt: Date;
    readonly now: Date;
    readonly accessibleNeed?: boolean;
  },
): RuleHit[] {
  const hits: RuleHit[] = [];
  const ada = activeAdaRule(rules, choice.startsAt, choice.now);
  if (ada && !choice.accessibleNeed) {
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
  const companion = activeCompanionRule(rules, choice.startsAt, choice.now);
  if (companion && choice.context !== 'assign') {
    const accessible = new Set(choice.seats.filter((s) => s.accessible).map((s) => s.seatUuid)).size;
    const companions = [
      ...new Set(choice.seats.filter((s) => s.companion && !s.accessible).map((s) => s.seatUuid)),
    ];
    const allowed = accessible * companion.maxPerAccessible;
    if (companions.length > allowed)
      hits.push({
        rule: 'ada_companion',
        severity: companion.severity,
        seats: companions.slice(allowed),
        maxPerAccessible: companion.maxPerAccessible,
        accessible,
      });
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
