import { uuidv7 } from '@yayatoh/kernel';
import { describe, expect, it } from 'vitest';
import {
  buildRow,
  convexHull,
  FloorplanDoc,
  placedSeats,
  regionAt,
  seatGrid,
  seatNear,
  seatRegions,
} from '../src/index.ts';

const FRONT = uuidv7();
const BACK = uuidv7();
const EMPTY = uuidv7();
const doc = FloorplanDoc.parse({
  version: 1,
  width: 3000,
  height: 3000,
  sections: [
    { id: FRONT, label: 'Front', vip: true },
    { id: BACK, label: 'Back', vip: false },
    { id: EMPTY, label: 'Empty', vip: false },
  ],
  items: [
    buildRow({ label: 'A', count: 5, x: 200, y: 200, sectionId: FRONT }),
    buildRow({ label: 'B', count: 5, x: 200, y: 300, sectionId: FRONT }),
    buildRow({ label: 'C', count: 5, x: 200, y: 2000, sectionId: BACK }),
    buildRow({ label: 'D', count: 5, x: 200, y: 2800 }),
  ],
});

describe('convexHull', () => {
  it('keeps only the corners', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 },
      { x: 5, y: 0 },
    ]);
    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual({ x: 5, y: 5 });
  });
});

describe('seatRegions', () => {
  const regions = seatRegions(doc);

  it('makes one region per section with seats, holding only that section’s seats', () => {
    expect(regions.map((r) => r.label)).toEqual(['Front', 'Back']);
    expect(regions[0]?.seatIds).toHaveLength(10);
    expect(regions[0]?.vip).toBe(true);
    expect(regions[1]?.seatIds).toHaveLength(5);
  });

  it('surrounds every seat of its section', () => {
    const seats = placedSeats(doc);
    for (const region of regions)
      for (const id of region.seatIds) {
        const seat = seats.find((s) => s.seatId === id);
        expect(seat && regionAt([region], seat)?.id).toBe(region.id);
      }
  });

  it('finds no region where there is no section', () => {
    const seat = placedSeats(doc).find((s) => s.sectionId === null);
    expect(seat && regionAt(regions, seat)).toBeNull();
  });

  it('is empty for a plan without sections', () => {
    expect(seatRegions(FloorplanDoc.parse({ ...doc, sections: [], items: [] }))).toEqual([]);
  });
});

describe('seatNear', () => {
  const seats = placedSeats(doc);
  const grid = seatGrid(seats);
  const first = seats[0];

  it('finds the seat under a point, and nothing away from every seat', () => {
    expect(first && seatNear(grid, { x: first.x + 5, y: first.y }, 30)?.seatId).toBe(first?.seatId);
    expect(seatNear(grid, { x: 2900, y: 100 }, 30)).toBeNull();
  });

  it('agrees with a scan of every seat, across grid cells', () => {
    for (const p of seats) expect(seatNear(grid, { x: p.x, y: p.y }, 1)?.seatId).toBe(p.seatId);
  });
});
