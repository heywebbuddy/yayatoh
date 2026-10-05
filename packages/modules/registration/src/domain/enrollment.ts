/**
 * Session enrollment rules (M5.2b), pure. The commands apply them under the session's row lock;
 * pages use them only to show what a button would do.
 *
 * - **Availability** comes from the registrant's admission items (`availableSessions`).
 * - **Conflicts**: a registrant holds at most one session of a pick-one group, and overlapping
 *   sessions (half-open intervals) are refused unless replaced, or kept both when neither has a
 *   capacity (P5-9, `enrollDecision`).
 * - **The line** promotes in order (FIFO) while places are free and until 24 h before the session
 *   starts (P5-9, `promotionOpen`); each person is re-checked on promotion and passed over for
 *   good when they no longer fit (`planPromotion`), so promotion can never loop.
 */

/** P5-9: the line stops promoting this long before a session starts (then the door decides). */
export const PROMOTION_CLOSE_MS = 24 * 3_600_000;

/** When the line stops promoting for a session that starts at `startsAt`. */
export const promotionClosesAt = (startsAt: Date): Date => new Date(startsAt.getTime() - PROMOTION_CLOSE_MS);

/** True while the line still promotes (strictly before the close time). */
export const promotionOpen = (startsAt: Date, now: Date): boolean =>
  now.getTime() < promotionClosesAt(startsAt).getTime();

/** An offer's end: its window, never past the close time. */
export function offerExpiry(now: Date, minutes: number, startsAt: Date): Date {
  return new Date(Math.min(now.getTime() + minutes * 60_000, promotionClosesAt(startsAt).getTime()));
}

/* -------------------------------------------------------------------- availability ---- */

export interface ItemAccess {
  readonly kind: 'admission' | 'add_on';
  /** The sessions listed for the item (`item_sessions`). */
  readonly sessionIds: readonly string[];
}

/**
 * The sessions a registrant's items give: an admission item with nothing listed gives every
 * session; listed sessions are given as listed; an add-on gives only what it lists.
 */
export function availableSessions(
  items: readonly ItemAccess[],
  allSessionIds: readonly string[],
): Set<string> {
  const out = new Set<string>();
  for (const item of items) {
    if (item.kind === 'admission' && item.sessionIds.length === 0)
      for (const id of allSessionIds) out.add(id);
    for (const id of item.sessionIds) if (allSessionIds.includes(id)) out.add(id);
  }
  return out;
}

/* ------------------------------------------------------------------------ conflicts ---- */

export interface SessionSlot {
  readonly sessionId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly capacity: number | null;
  readonly groupId: string | null;
}

/** Half-open intervals: a session ending at 10:00 does not overlap one starting at 10:00. */
export const slotsOverlap = (a: SessionSlot, b: SessionSlot): boolean =>
  a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();

export interface Conflicts {
  /** Held sessions overlapping the target (other than a same-group one). */
  readonly overlap: readonly SessionSlot[];
  /** The held session of the target's pick-one group, if any. */
  readonly group: SessionSlot | null;
}

/** What a registrant holds (enrolled or offered) that stands in the way of `target`. */
export function conflictsWith(target: SessionSlot, held: readonly SessionSlot[]): Conflicts {
  const others = held.filter((h) => h.sessionId !== target.sessionId);
  const group = target.groupId ? (others.find((h) => h.groupId === target.groupId) ?? null) : null;
  const overlap = others.filter((h) => h !== group && slotsOverlap(target, h));
  return { overlap, group };
}

/** No conflict at all (the promotion re-check). */
export const conflictFree = (c: Conflicts) => c.group === null && c.overlap.length === 0;

/* ------------------------------------------------------------------- the decision ---- */

/** `refuse`: say why; `replace`: drop what stands in the way; `keep_both`: P5-9, both uncapped. */
export const CONFLICT_CHOICES = ['refuse', 'replace', 'keep_both'] as const;
export type ConflictChoice = (typeof CONFLICT_CHOICES)[number];

export const ENROLL_REFUSALS = [
  'not_available',
  'included',
  'closed',
  'started',
  'one_per_group',
  'overlap',
  'keep_both_capped',
  'waitlist_closed',
] as const;
export type EnrollRefusal = (typeof ENROLL_REFUSALS)[number];

export interface EnrollTarget extends SessionSlot {
  readonly admission: 'included' | 'optional';
  readonly enrollmentOpen: boolean;
  readonly enrolled: number;
}

export type EnrollDecision =
  | { readonly kind: 'refuse'; readonly reason: EnrollRefusal; readonly withSessionId: string | null }
  | { readonly kind: 'enrol'; readonly replace: readonly string[] }
  | { readonly kind: 'waitlist' };

/** Places free now (null: no limit). */
export const roomLeft = (t: { capacity: number | null; enrolled: number }): number | null =>
  t.capacity === null ? null : Math.max(0, t.capacity - t.enrolled);

/**
 * Enrol, join the line, or refuse. Called after the line was promoted under the same lock, so a
 * free place here is nobody's in line. A full session's line is joined only without conflicts
 * (replacing a held session for a mere place in line would lose it) and only before the close.
 */
export function enrollDecision(input: {
  readonly target: EnrollTarget;
  readonly available: boolean;
  readonly held: readonly SessionSlot[];
  readonly now: Date;
  readonly choice: ConflictChoice;
}): EnrollDecision {
  const { target, held, now, choice } = input;
  const refuse = (reason: EnrollRefusal, withSessionId: string | null = null): EnrollDecision => ({
    kind: 'refuse',
    reason,
    withSessionId,
  });
  if (!input.available) return refuse('not_available');
  if (target.admission !== 'optional') return refuse('included');
  if (!target.enrollmentOpen) return refuse('closed');
  if (now.getTime() >= target.startsAt.getTime()) return refuse('started');
  const c = conflictsWith(target, held);
  const room = roomLeft(target);
  const full = room !== null && room <= 0;
  if (full) {
    if (c.group) return refuse('one_per_group', c.group.sessionId);
    if (c.overlap[0]) return refuse('overlap', c.overlap[0].sessionId);
    if (!promotionOpen(target.startsAt, now)) return refuse('waitlist_closed');
    return { kind: 'waitlist' };
  }
  const replace: string[] = [];
  if (c.group) {
    if (choice !== 'replace') return refuse('one_per_group', c.group.sessionId);
    replace.push(c.group.sessionId);
  }
  if (c.overlap.length > 0) {
    if (choice === 'replace') replace.push(...c.overlap.map((o) => o.sessionId));
    else if (choice === 'keep_both') {
      const capped = target.capacity !== null ? c.overlap[0] : c.overlap.find((o) => o.capacity !== null);
      if (capped) return refuse('keep_both_capped', capped.sessionId);
    } else return refuse('overlap', c.overlap[0]?.sessionId ?? null);
  }
  return { kind: 'enrol', replace };
}

/* ------------------------------------------------------------------------ promotion ---- */

export type SkipReason = 'overlap' | 'one_per_group' | 'not_available' | 'registrant_gone';

export interface LineEntry {
  readonly id: string;
}

export type PromotionStep<E extends LineEntry> =
  | { readonly kind: 'promote'; readonly entry: E }
  | { readonly kind: 'skip'; readonly entry: E; readonly reason: SkipReason };

/**
 * The line's next moves, strictly in order: while places are free (null = unlimited) and the
 * line still promotes, each person is re-checked; one who no longer fits is passed over for good
 * (`skip`, they leave the line), the next one who fits is promoted. Every person is visited at
 * most once and every step ends their wait, so the plan is finite and re-planning after it
 * promotes nobody new until a place frees again.
 */
export function planPromotion<E extends LineEntry>(input: {
  readonly room: number | null;
  readonly open: boolean;
  readonly line: readonly E[];
  readonly check: (entry: E) => SkipReason | null;
}): PromotionStep<E>[] {
  if (!input.open) return [];
  const steps: PromotionStep<E>[] = [];
  let room = input.room === null ? Number.POSITIVE_INFINITY : input.room;
  const seen = new Set<string>();
  for (const entry of input.line) {
    if (room <= 0) break;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const reason = input.check(entry);
    if (reason) steps.push({ kind: 'skip', entry, reason });
    else {
      steps.push({ kind: 'promote', entry });
      room -= 1;
    }
  }
  return steps;
}
