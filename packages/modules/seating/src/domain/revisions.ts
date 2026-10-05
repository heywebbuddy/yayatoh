import { type FloorplanDoc, placedSeats } from '@yayatoh/floorplan';

/**
 * Layout revisions (M6.11b), pure: what changed between two plans, and how restoring an earlier
 * plan treats the seats that are held or sold now.
 */

export interface SeatRef {
  readonly seatId: string;
  readonly label: string;
}

export interface LayoutDiff {
  /** Seats in `to` that `from` does not have. */
  readonly added: SeatRef[];
  /** Seats of `from` that are gone in `to`. */
  readonly removed: SeatRef[];
  /** The same seat (same id) with another label: renamed, or moved to another row or table. */
  readonly renumbered: { readonly seatId: string; readonly from: string; readonly to: string }[];
  /** Seats that stayed (same id and label) but now stand somewhere else. */
  readonly moved: number;
  /** Rows, tables and objects added and removed. */
  readonly itemsAdded: number;
  readonly itemsRemoved: number;
}

/** What changed from `from` to `to`, seat by seat (by seat id) and item by item. */
export function diffDocs(from: FloorplanDoc, to: FloorplanDoc): LayoutDiff {
  const a = new Map(placedSeats(from).map((s) => [s.seatId, s]));
  const b = new Map(placedSeats(to).map((s) => [s.seatId, s]));
  const added: SeatRef[] = [];
  const removed: SeatRef[] = [];
  const renumbered: { seatId: string; from: string; to: string }[] = [];
  let moved = 0;
  for (const [id, s] of b) {
    const old = a.get(id);
    if (!old) added.push({ seatId: id, label: s.label });
    else if (old.label !== s.label) renumbered.push({ seatId: id, from: old.label, to: s.label });
    else if (old.x !== s.x || old.y !== s.y) moved++;
  }
  for (const [id, s] of a) if (!b.has(id)) removed.push({ seatId: id, label: s.label });
  const itemsA = new Set(from.items.map((i) => i.id));
  const itemsB = new Set(to.items.map((i) => i.id));
  return {
    added,
    removed,
    renumbered,
    moved,
    itemsAdded: [...itemsB].filter((id) => !itemsA.has(id)).length,
    itemsRemoved: [...itemsA].filter((id) => !itemsB.has(id)).length,
  };
}

/** A seat that is held or sold on the chart now. */
export interface InUseSeat {
  readonly seatUuid: string;
  readonly label: string;
  readonly status: 'held' | 'sold';
}

export const RESTORE_CONFLICTS = ['removed', 'renumbered'] as const;
export type RestoreConflict = (typeof RESTORE_CONFLICTS)[number];

export type RestoreOutcome =
  | {
      readonly seatUuid: string;
      readonly label: string;
      readonly status: InUseSeat['status'];
      readonly outcome: 'kept';
    }
  | {
      readonly seatUuid: string;
      readonly label: string;
      readonly status: InUseSeat['status'];
      readonly outcome: 'remapped';
      /** The seat of the restored plan that takes the sale (its id becomes the sold seat's). */
      readonly replaces: string;
    }
  | {
      readonly seatUuid: string;
      readonly label: string;
      readonly status: InUseSeat['status'];
      readonly outcome: 'conflict';
      readonly reason: RestoreConflict;
      /** For `renumbered`: the seat's label in the restored plan. */
      readonly newLabel?: string;
    };

export interface RestorePlan {
  /** The plan to apply: the revision, with remapped seats carrying the held or sold seat's id. */
  readonly doc: FloorplanDoc;
  readonly outcomes: RestoreOutcome[];
  /** No conflicts: every held and sold seat keeps its seat id and its label. */
  readonly ok: boolean;
}

/**
 * Restoring `target` keeps every held and sold seat, or refuses (M6.11b):
 * - the seat is in `target` with the same label → kept;
 * - it is not, but `target` has a free seat with the same label (another seat id, e.g. the row was
 *   redrawn) → remapped: that seat takes the held or sold seat's id, so the hold, the sale and the
 *   ticket's seat label stay exactly as they are;
 * - otherwise a conflict: `removed` (no seat with that label) or `renumbered` (the same seat has
 *   another label there, which would change the buyer's ticket).
 */
export function planRestore(target: FloorplanDoc, inUse: readonly InUseSeat[]): RestorePlan {
  const placed = placedSeats(target);
  const byId = new Map(placed.map((s) => [s.seatId, s]));
  const byLabel = new Map(placed.map((s) => [s.label, s]));
  const inUseIds = new Set(inUse.map((s) => s.seatUuid));
  const rename = new Map<string, string>();
  const outcomes: RestoreOutcome[] = [];
  for (const s of [...inUse].sort((x, y) => x.label.localeCompare(y.label))) {
    const same = byId.get(s.seatUuid);
    if (same) {
      outcomes.push(
        same.label === s.label
          ? { seatUuid: s.seatUuid, label: s.label, status: s.status, outcome: 'kept' }
          : {
              seatUuid: s.seatUuid,
              label: s.label,
              status: s.status,
              outcome: 'conflict',
              reason: 'renumbered',
              newLabel: same.label,
            },
      );
      continue;
    }
    const twin = byLabel.get(s.label);
    if (twin && !inUseIds.has(twin.seatId) && !rename.has(twin.seatId)) {
      rename.set(twin.seatId, s.seatUuid);
      outcomes.push({
        seatUuid: s.seatUuid,
        label: s.label,
        status: s.status,
        outcome: 'remapped',
        replaces: twin.seatId,
      });
      continue;
    }
    outcomes.push({
      seatUuid: s.seatUuid,
      label: s.label,
      status: s.status,
      outcome: 'conflict',
      reason: 'removed',
    });
  }
  const doc: FloorplanDoc = rename.size
    ? {
        ...target,
        items: target.items.map((i) =>
          i.kind === 'object'
            ? i
            : {
                ...i,
                seats: i.seats.map((s) => (rename.has(s.id) ? { ...s, id: rename.get(s.id) as string } : s)),
              },
        ),
      }
    : target;
  return { doc, outcomes, ok: outcomes.every((o) => o.outcome !== 'conflict') };
}
