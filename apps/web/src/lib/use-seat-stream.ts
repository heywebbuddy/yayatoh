'use client';

import { type StreamState, useRealtime } from './use-realtime.ts';

export type { StreamState };

export interface SeatStreamHandlers {
  /** The whole state (first connection, or after a gap too long to replay). */
  readonly onSnapshot: (data: unknown) => void;
  /** What changed since the last message. */
  readonly onDelta: (data: unknown) => void;
  /** The map itself changed (seats priced, repriced, added): reload it. */
  readonly onRefresh: () => void;
}

const SEAT_EVENTS = ['snapshot', 'delta', 'refresh'] as const;

/** Subscribe to a live seat stream (M1.7f): the seat channels of the realtime endpoint (M3.1b). */
export function useSeatStream(url: string | null, handlers: SeatStreamHandlers): StreamState {
  return useRealtime(url, SEAT_EVENTS, {
    snapshot: (d) => handlers.onSnapshot(d),
    delta: (d) => handlers.onDelta(d),
    refresh: () => handlers.onRefresh(),
  });
}
