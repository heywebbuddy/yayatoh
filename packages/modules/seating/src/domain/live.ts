import type { SeatStatus } from './seat-state.ts';

/**
 * How a seat looks on the organizer's plan (M1.7f): `assigned` (a guest's seat) is shown apart
 * from `blocked` (kept back by hand: a channel, accessibility, or killed).
 */
export const LIVE_SEAT_STATES = ['available', 'held', 'sold', 'assigned', 'blocked'] as const;
export type LiveSeatState = (typeof LIVE_SEAT_STATES)[number];

export function liveSeatState(status: SeatStatus, blockReason: string | null): LiveSeatState {
  if (status === 'blocked') return blockReason === 'assigned' ? 'assigned' : 'blocked';
  return status;
}

export type SeatCounts = Record<LiveSeatState, number>;

export function seatCounts(states: Iterable<LiveSeatState>): SeatCounts {
  const counts: SeatCounts = { available: 0, held: 0, sold: 0, assigned: 0, blocked: 0 };
  for (const s of states) counts[s]++;
  return counts;
}

export interface LiveSeatRow {
  readonly seatUuid: string;
  readonly status: SeatStatus;
  readonly blockReason: string | null;
  readonly ticketTypeId: string | null;
  readonly accessible: boolean;
}

/**
 * Whether a buyer may choose each seat on sale (priced seats only; unpriced seats are not on the
 * public map at all). Accessible seats kept back by an enforced `ada_reserved` rule are not
 * choosable online until their release. Never anything about who holds a seat.
 */
export function publicAvailability(
  rows: readonly LiveSeatRow[],
  opts: { accessibleKeptBack: boolean },
): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const r of rows) {
    if (!r.ticketTypeId) continue;
    out.set(r.seatUuid, r.status === 'available' && !(opts.accessibleKeptBack && r.accessible));
  }
  return out;
}

/** A key that changes whenever the set of seats on sale or their prices change (a map refresh). */
export function pricingKey(rows: readonly LiveSeatRow[]): string {
  return rows
    .flatMap((r) => (r.ticketTypeId ? [`${r.seatUuid}=${r.ticketTypeId}${r.accessible ? '+a' : ''}`] : []))
    .sort()
    .join(',');
}

/** Seats whose value differs between two maps (present in `next`), in `next`'s order. */
export function changedEntries<V>(prev: ReadonlyMap<string, V>, next: ReadonlyMap<string, V>): [string, V][] {
  const out: [string, V][] = [];
  for (const [k, v] of next) if (prev.get(k) !== v) out.push([k, v]);
  return out;
}

/** Same keys in both maps (seats added or removed means a full snapshot, not a delta). */
export function sameKeys(a: ReadonlyMap<string, unknown>, b: ReadonlyMap<string, unknown>): boolean {
  if (a.size !== b.size) return false;
  for (const k of a.keys()) if (!b.has(k)) return false;
  return true;
}

/** Public availability as the wire format: seats now choosable (`on`) and not (`off`). */
export function availabilityLists(entries: Iterable<[string, boolean]>): { on: string[]; off: string[] } {
  const on: string[] = [];
  const off: string[] = [];
  for (const [k, v] of entries) (v ? on : off).push(k);
  return { on, off };
}

/**
 * Coalesce a burst of availability deltas into one: the last word on each seat wins. (The feed
 * itself diffs snapshots, so it never needs this; clients and tests use it.)
 */
export function coalesceAvailability(deltas: readonly { on: readonly string[]; off: readonly string[] }[]): {
  on: string[];
  off: string[];
} {
  const last = new Map<string, boolean>();
  for (const d of deltas) {
    for (const id of d.on) {
      last.delete(id);
      last.set(id, true);
    }
    for (const id of d.off) {
      last.delete(id);
      last.set(id, false);
    }
  }
  return availabilityLists(last);
}
