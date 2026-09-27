import { describe, expect, it } from 'vitest';
import { nextSeatStatus, SEAT_EVENTS, SEAT_STATUSES, type SeatStatus } from '../src/domain/seat-state.ts';

/** Deterministic PRNG so a failing walk can be replayed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('seat state machine (ADR 0012)', () => {
  it('allows exactly the documented transitions', () => {
    const allowed = SEAT_STATUSES.flatMap((from) =>
      SEAT_EVENTS.flatMap((e) => {
        const to = nextSeatStatus(from, e);
        return to ? [`${from} -${e}-> ${to}`] : [];
      }),
    );
    expect(allowed.sort()).toEqual(
      [
        'available -hold-> held',
        'available -block-> blocked',
        'blocked -unblock-> available',
        'held -sell-> sold',
        'held -release-> available',
        'sold -void-> available',
      ].sort(),
    );
  });

  it('property: random walks never reach sold without a hold, and a sold seat only leaves by void', () => {
    const next = rng(20260927);
    for (let walk = 0; walk < 500; walk++) {
      let s: SeatStatus = 'available';
      let heldBefore = false;
      for (let step = 0; step < 50; step++) {
        const e = SEAT_EVENTS[Math.floor(next() * SEAT_EVENTS.length)] ?? 'hold';
        const to = nextSeatStatus(s, e);
        if (!to) continue;
        if (to === 'sold') expect(heldBefore).toBe(true);
        if (s === 'sold') expect(e).toBe('void');
        heldBefore = to === 'held' || (heldBefore && to === 'sold');
        s = to;
      }
    }
  });
});
