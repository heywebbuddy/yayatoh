/**
 * Bulk seat assignment (M1.8f): the pure planning behind the `seating.bulkAssign` action, the same
 * for every chunk. Seats come in plan order; people in the operation's order.
 */

/** Where a bulk assignment seats people. */
export const BULK_TARGET_KINDS = ['item', 'section', 'best', 'group'] as const;
export type BulkTargetKind = (typeof BULK_TARGET_KINDS)[number];

/** Why one person of a bulk assignment was not seated (stable codes shown to the organizer). */
export const BULK_ASSIGN_FAILURES = [
  'not_found',
  'attendee_cancelled',
  'seated_by_ticket',
  'not_enough_seats',
] as const;
export type BulkAssignFailure = (typeof BULK_ASSIGN_FAILURES)[number];

/** A seated person's caveat: placed in an accessible seat while such seats are kept back. */
export const BULK_ASSIGN_WARNINGS = ['ada_kept_back'] as const;

export interface CandidateSeat {
  readonly seatUuid: string;
  readonly accessible: boolean;
  /** Free for this target (available; for a group target, kept for that group). */
  readonly free: boolean;
}

export interface ChunkPerson {
  readonly attendeeId: string;
  /** Why this person can't be seated at all, or `null`. */
  readonly refused: BulkAssignFailure | null;
  /** Already sits in the target: nothing to do. */
  readonly alreadyThere: boolean;
}

export interface ChunkPlan {
  readonly placements: readonly { readonly attendeeId: string; readonly seatUuid: string }[];
  readonly failures: readonly { readonly attendeeId: string; readonly code: BulkAssignFailure }[];
  /** Already seated in the target (succeed without a change, so undo leaves them alone). */
  readonly unchanged: readonly string[];
}

/**
 * Plan one chunk: every person who can be seated takes the next free seat in plan order
 * (accessible seats last, or never when `skipAccessible`). People past the free seats fail
 * `not_enough_seats`: a partial result, unlike a single assignment's all-or-nothing party.
 */
export function planChunk(
  seats: readonly CandidateSeat[],
  people: readonly ChunkPerson[],
  opts: { readonly skipAccessible: boolean },
): ChunkPlan {
  const free = seats.filter((s) => s.free && !(opts.skipAccessible && s.accessible));
  const ordered = [...free.filter((s) => !s.accessible), ...free.filter((s) => s.accessible)];
  const placements: { attendeeId: string; seatUuid: string }[] = [];
  const failures: { attendeeId: string; code: BulkAssignFailure }[] = [];
  const unchanged: string[] = [];
  let next = 0;
  for (const p of people) {
    if (p.refused) failures.push({ attendeeId: p.attendeeId, code: p.refused });
    else if (p.alreadyThere) unchanged.push(p.attendeeId);
    else {
      const seat = ordered[next];
      if (!seat) failures.push({ attendeeId: p.attendeeId, code: 'not_enough_seats' });
      else {
        placements.push({ attendeeId: p.attendeeId, seatUuid: seat.seatUuid });
        next++;
      }
    }
  }
  return { placements, failures, unchanged };
}

/** Where someone sat before a bulk assignment moved them (restored by undo). */
export interface PriorSeat {
  readonly seatUuid: string;
  readonly pinned: boolean;
  readonly priorBlock: string | null;
}

/** What undo needs per seated person: the seat they were given and the one they had. */
export interface BulkAssignUndo {
  readonly given: string;
  readonly prev: PriorSeat | null;
}

export interface UndoPlan {
  /** Unseat these (their seat is still the one the operation gave them). */
  readonly release: readonly string[];
  /** Then seat these back where they were. */
  readonly restore: readonly { readonly attendeeId: string; readonly prev: PriorSeat }[];
  /** Left alone: someone moved or unseated them since the operation. */
  readonly skipped: readonly string[];
}

/**
 * Undo mapping: a person still in the seat the operation gave them is unseated, then put back
 * in their previous seat (if they had one). Anyone whose seat changed since is left alone, so
 * undo never overrides a later decision.
 */
export function planUndo(
  items: readonly { readonly attendeeId: string; readonly undo: BulkAssignUndo }[],
  current: ReadonlyMap<string, string>,
): UndoPlan {
  const release: string[] = [];
  const restore: { attendeeId: string; prev: PriorSeat }[] = [];
  const skipped: string[] = [];
  for (const i of items) {
    if (current.get(i.attendeeId) !== i.undo.given) {
      skipped.push(i.attendeeId);
      continue;
    }
    release.push(i.attendeeId);
    if (i.undo.prev) restore.push({ attendeeId: i.attendeeId, prev: i.undo.prev });
  }
  return { release, restore, skipped };
}
