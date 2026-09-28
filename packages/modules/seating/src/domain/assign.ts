import type { SeatStatus } from './seat-state.ts';

/** How a seat looks to the organizer assigning guests. */
export const ASSIGN_SEAT_STATES = ['free', 'reserved', 'blocked', 'held', 'sold', 'assigned'] as const;
export type AssignSeatState = (typeof ASSIGN_SEAT_STATES)[number];

/**
 * A seat's state for assignment: `free` (available), `reserved` (blocked for a channel,
 * accessibility or a group — an organizer may still seat someone there by choosing it), `blocked`
 * (killed), `held` / `sold` (a buyer's), `assigned` (a guest's).
 */
export function assignSeatState(status: SeatStatus, blockReason: string | null): AssignSeatState {
  if (status === 'available') return 'free';
  if (status === 'blocked')
    return blockReason === 'assigned'
      ? 'assigned'
      : blockReason === 'channel' || blockReason === 'ada' || blockReason === 'group'
        ? 'reserved'
        : 'blocked';
  return status;
}

/**
 * Choose seats for `n` people at one table or row, from its seats in plan order: free seats only,
 * accessible seats last (they are kept for the guests who need them). `null` when they don't fit;
 * `fits` is how many would.
 */
export function pickSeats(
  seats: readonly { readonly seatUuid: string; readonly accessible: boolean; readonly free: boolean }[],
  n: number,
): { seats: string[] | null; fits: number } {
  const free = seats.filter((s) => s.free);
  if (free.length < n) return { seats: null, fits: free.length };
  const ordered = [...free.filter((s) => !s.accessible), ...free.filter((s) => s.accessible)];
  return { seats: ordered.slice(0, n).map((s) => s.seatUuid), fits: free.length };
}
