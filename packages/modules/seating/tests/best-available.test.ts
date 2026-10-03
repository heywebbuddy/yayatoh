import { describe, expect, it } from 'vitest';
import {
  type BestAvailableRequest,
  bestAvailable,
  isTogether,
  type PlanSeat,
} from '../src/domain/best-available.ts';

/** A small deterministic PRNG (mulberry32): the property runs are reproducible from the seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rows of seats (row r at y = 100 + 90 r, seat i at x = 50 i), optional tables after them. */
function plan(
  rows: readonly string[],
  opts: { sections?: (string | null)[]; tables?: readonly string[] } = {},
): PlanSeat[] {
  const seats: PlanSeat[] = [];
  rows.forEach((row, r) => {
    [...row].forEach((c, i) => {
      seats.push({
        seatUuid: `r${r}s${i}`,
        itemId: `row${r}`,
        itemKind: 'row',
        itemOrder: r,
        index: i,
        sectionId: opts.sections?.[r] ?? null,
        x: 50 * i,
        y: 100 + 90 * r,
        accessible: c === 'A' || c === 'a',
        companion: c === 'C' || c === 'c',
        // Upper case or "." = free; lower case or "x" = taken.
        free: c === '.' || c === 'A' || c === 'C',
      });
    });
  });
  (opts.tables ?? []).forEach((table, t) => {
    [...table].forEach((c, i) => {
      seats.push({
        seatUuid: `t${t}s${i}`,
        itemId: `table${t}`,
        itemKind: 'table',
        itemOrder: rows.length + t,
        index: i,
        sectionId: null,
        x: 400 * t,
        y: 2000,
        accessible: c === 'A',
        companion: c === 'C',
        free: c === '.' || c === 'A' || c === 'C',
      });
    });
  });
  return seats;
}

const req = (seats: PlanSeat[], quantity: number, more: Partial<BestAvailableRequest> = {}) =>
  ({
    seats,
    quantity,
    stages: [{ x: 250, y: 0 }],
    sectionScores: {},
    accessible: 0,
    companionsPerAccessible: null,
    ...more,
  }) satisfies BestAvailableRequest;

const pick = (r: BestAvailableRequest) => {
  const out = bestAvailable(r);
  if (typeof out === 'string') throw new Error(out);
  return out;
};

describe('best available (M6.11a)', () => {
  it('takes the centre of the front row when it fits', () => {
    const seats = plan(['..........', '..........']);
    const out = pick(req(seats, 4));
    expect(out).toEqual({ seats: ['r0s3', 'r0s4', 'r0s5', 'r0s6'], pieces: 1 });
  });

  it('moves back a row rather than split the party', () => {
    // Front row: 3 free on each side of a taken middle; row 2 has 4 together.
    const seats = plan(['...xxxx...', 'xxx....xxx']);
    expect(pick(req(seats, 4))).toEqual({ seats: ['r1s3', 'r1s4', 'r1s5', 'r1s6'], pieces: 1 });
  });

  it('ranks the organizer’s section scores before distance to the stage', () => {
    const seats = plan(['..........', '..........'], { sections: ['front', 'premium'] });
    expect(pick(req(seats, 2, { sectionScores: { premium: 90 } })).seats).toEqual(['r1s4', 'r1s5']);
    // A scored section always comes first, even with a lower score than an unscored one is close.
    expect(pick(req(seats, 2, { sectionScores: { front: 10, premium: 20 } })).seats).toEqual([
      'r1s4',
      'r1s5',
    ]);
    // Without scores, the nearer section wins.
    expect(pick(req(seats, 2)).seats).toEqual(['r0s4', 'r0s5']);
  });

  it('without a stage, earlier rows rank first', () => {
    const seats = plan(['xxxx......', '..........']);
    // Row 1 still has free seats (4–9): the pair nearest the row's middle.
    expect(pick(req(seats, 2, { stages: [] })).seats).toEqual(['r0s4', 'r0s5']);
  });

  it('a table seats a party together, whichever of its seats are free', () => {
    const seats = plan(['.x.x.x.x'], { tables: ['.x..x..x'] });
    // Row has no 3 together; the table has five free seats.
    const out = pick(req(seats, 3));
    expect(out.pieces).toBe(1);
    expect(out.seats.every((s) => s.startsWith('t0'))).toBe(true);
  });

  it('splits only when no block fits, into as few pieces as possible, and says so', () => {
    const seats = plan(['..x..x..', 'xx...xxx']);
    const out = pick(req(seats, 5));
    // Largest piece first (3 in row 2), then the best pair.
    expect(out.pieces).toBe(2);
    expect(out.seats.slice(0, 3)).toEqual(['r1s2', 'r1s3', 'r1s4']);
    expect(out.seats).toHaveLength(5);
  });

  it('says when there are not enough seats', () => {
    expect(bestAvailable(req(plan(['..xx']), 3))).toBe('not_enough_seats');
    expect(bestAvailable(req(plan(['....']), 0))).toBe('not_enough_seats');
  });

  it('keeps accessible and companion seats for those who need them when others fit', () => {
    const seats = plan(['AC......CA']);
    expect(pick(req(seats, 2)).seats).toEqual(['r0s4', 'r0s5']);
    // Used only when nothing else fits.
    expect(pick(req(plan(['AC..xxx']), 4)).seats).toEqual(['r0s0', 'r0s1', 'r0s2', 'r0s3']);
  });

  it('a party with a wheelchair user gets an accessible seat with its companion seats', () => {
    const seats = plan(['..........', 'AC......CA']);
    const out = pick(req(seats, 2, { accessible: 1, companionsPerAccessible: 1 }));
    expect(out.pieces).toBe(1);
    expect(['r1s0,r1s1', 'r1s8,r1s9']).toContain(out.seats.join(','));
    // Four: the accessible seat, its companion and the next two seats of the row.
    const four = pick(req(seats, 4, { accessible: 1, companionsPerAccessible: 1 }));
    expect(four.pieces).toBe(1);
    expect(four.seats.some((s) => s === 'r1s0' || s === 'r1s9')).toBe(true);
  });

  it('never gives more companion seats than the rule allows', () => {
    // One companion per accessible seat: the accessible seat and one companion…
    const two = pick(req(plan(['CCAC']), 2, { accessible: 1, companionsPerAccessible: 1 }));
    expect(two.seats).toContain('r0s2');
    expect(two.seats).toHaveLength(2);
    // …and never a second companion, even split.
    expect(bestAvailable(req(plan(['CCAC']), 3, { accessible: 1, companionsPerAccessible: 1 }))).toBe(
      'not_enough_seats',
    );
    // Two allowed: three together.
    expect(pick(req(plan(['CCAC']), 3, { accessible: 1, companionsPerAccessible: 2 })).pieces).toBe(1);
  });

  it('with no accessible seat free, the accessible request says so', () => {
    expect(bestAvailable(req(plan(['....a...']), 2, { accessible: 1, companionsPerAccessible: 1 }))).toBe(
      'no_accessible_seat',
    );
  });

  it('property: never splits a party when a block that fits exists (2,000 random plans)', () => {
    const next = rng(20261002);
    let together = 0;
    let split = 0;
    for (let run = 0; run < 2000; run++) {
      const rows = Array.from({ length: 1 + Math.floor(next() * 5) }, () =>
        Array.from({ length: 2 + Math.floor(next() * 14) }, () => {
          const r = next();
          return r < 0.45 ? 'x' : r < 0.5 ? 'A' : r < 0.55 ? 'C' : '.';
        }).join(''),
      );
      const tables = Array.from({ length: Math.floor(next() * 3) }, () =>
        Array.from({ length: 4 + Math.floor(next() * 6) }, () => (next() < 0.6 ? 'x' : '.')).join(''),
      );
      const seats = plan(rows, { tables });
      const quantity = 1 + Math.floor(next() * 6);
      const ada = next() < 0.3;
      const r = req(seats, quantity, {
        stages: next() < 0.5 ? [] : [{ x: next() * 600, y: 0 }],
        accessible: ada ? 1 : 0,
        companionsPerAccessible: ada ? 1 + Math.floor(next() * 3) : null,
      });
      // Brute force: does any row or table hold a valid block of `quantity` free seats?
      const byItem = new Map<string, PlanSeat[]>();
      for (const s of seats) if (s.free) byItem.set(s.itemId, [...(byItem.get(s.itemId) ?? []), s]);
      const valid = (w: PlanSeat[]) => {
        const acc = w.filter((s) => s.accessible).length;
        const comp = w.filter((s) => s.companion && !s.accessible).length;
        return (
          acc >= r.accessible &&
          (r.companionsPerAccessible === null || comp <= acc * r.companionsPerAccessible)
        );
      };
      let exists = false;
      for (const free of byItem.values()) {
        const sorted = free.sort((a, b) => a.index - b.index);
        for (let i = 0; i + quantity <= sorted.length && !exists; i++) {
          const w = sorted.slice(i, i + quantity);
          if (isTogether(w) && valid(w)) exists = true;
          // Tables: any subset is together; a valid subset exists if enough seats are free.
          if ((w[0] as PlanSeat).itemKind === 'table' && r.accessible === 0) exists = true;
        }
      }
      const out = bestAvailable(r);
      if (exists) {
        expect(typeof out, JSON.stringify({ rows, tables, quantity, ada })).toBe('object');
        if (typeof out === 'string') continue;
        expect(out.pieces, JSON.stringify({ rows, tables, quantity, ada, out })).toBe(1);
        const chosen = out.seats.map((id) => seats.find((s) => s.seatUuid === id) as PlanSeat);
        expect(isTogether(chosen)).toBe(true);
        together++;
      } else if (typeof out === 'object') {
        expect(out.pieces).toBeGreaterThan(1);
        split++;
      }
      if (typeof out === 'object') {
        // Never a taken seat, never a seat twice, always the party size.
        const chosen = out.seats.map((id) => seats.find((s) => s.seatUuid === id) as PlanSeat);
        expect(chosen.every((s) => s.free)).toBe(true);
        expect(new Set(out.seats).size).toBe(quantity);
        expect(valid(chosen)).toBe(true);
      }
    }
    // The generator exercises both outcomes.
    expect(together).toBeGreaterThan(200);
    expect(split).toBeGreaterThan(20);
  });

  it('is fast enough on a 20,000-seat plan', () => {
    const rows = Array.from({ length: 40 }, (_, r) =>
      '.'.repeat(500).replace(/./g, (c, i) => ((i + r) % 13 === 0 ? 'x' : c)),
    );
    const seats = plan(rows);
    const t0 = performance.now();
    const out = pick(req(seats, 8));
    expect(out.pieces).toBe(1);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
