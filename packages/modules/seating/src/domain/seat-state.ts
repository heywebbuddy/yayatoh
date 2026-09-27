export const SEAT_STATUSES = ['available', 'held', 'sold', 'blocked'] as const;
export type SeatStatus = (typeof SEAT_STATUSES)[number];

export const SEAT_EVENTS = ['hold', 'sell', 'release', 'block', 'unblock', 'void'] as const;
export type SeatEvent = (typeof SEAT_EVENTS)[number];

/** The only transitions (ADR 0012). */
const NEXT: Readonly<Record<SeatEvent, Partial<Record<SeatStatus, SeatStatus>>>> = {
  hold: { available: 'held' },
  sell: { held: 'sold' },
  release: { held: 'available' },
  block: { available: 'blocked' },
  unblock: { blocked: 'available' },
  void: { sold: 'available' },
};

export function nextSeatStatus(from: SeatStatus, event: SeatEvent): SeatStatus | null {
  return NEXT[event][from] ?? null;
}

/** Statuses a seat can be in before an event (the `WHERE status IN (...)` of each transition). */
export const fromStatuses = (event: SeatEvent) => Object.keys(NEXT[event]) as SeatStatus[];
