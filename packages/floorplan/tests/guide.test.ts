import { uuidv7 } from '@yayatoh/kernel';
import { describe, expect, it } from 'vitest';
import {
  buildRoundTable,
  buildRow,
  FloorplanDoc,
  itemCenter,
  MAP_AREAS,
  mapArea,
  nearestObject,
  type OBJECT_TYPES,
  seatPosition,
} from '../src/index.ts';

const object = (
  objectType: (typeof OBJECT_TYPES)[number],
  label: string,
  x: number,
  y: number,
  rotation = 0,
) => ({
  kind: 'object' as const,
  id: uuidv7(),
  objectType,
  label,
  x,
  y,
  width: 400,
  height: 200,
  rotation,
});

describe('venue guide geometry (M1.7e)', () => {
  const stage = object('stage', 'Stage', 1300, 100);
  const main = object('entrance', 'Main doors', 0, 1700);
  const side = object('entrance', 'Garden door', 2600, 900);
  const bar = object('bar', 'Bar', 2500, 1700);
  const row = buildRow({ label: 'A', count: 5, x: 1000, y: 500 });
  const table = buildRoundTable({ label: '7', seats: 8, x: 400, y: 400 });
  const doc = FloorplanDoc.parse({
    version: 1,
    width: 3000,
    height: 2000,
    items: [stage, main, side, bar, row, table],
  });

  it('centres: an object rectangle (rotation included), a table origin, the middle of a row', () => {
    expect(itemCenter(stage)).toEqual({ x: 1500, y: 200 });
    // Rotated 90° clockwise about its origin: the rectangle now hangs to the left of it.
    const [turned] = FloorplanDoc.parse({ ...doc, items: [object('bar', '', 1000, 1000, 90)] }).items;
    if (!turned) throw new Error('no item');
    expect(itemCenter(turned)).toEqual({ x: 900, y: 1200 });
    expect(itemCenter(table)).toEqual({ x: 400, y: 400 });
    expect(itemCenter(row)).toEqual({ x: 1110, y: 500 });
  });

  it('describes positions as ninths of the room', () => {
    expect(MAP_AREAS).toHaveLength(9);
    expect(mapArea(doc, itemCenter(stage))).toBe('top');
    expect(mapArea(doc, itemCenter(table))).toBe('top-left');
    expect(mapArea(doc, itemCenter(main))).toBe('bottom-left');
    expect(mapArea(doc, itemCenter(side))).toBe('right');
    expect(mapArea(doc, { x: 1500, y: 1000 })).toBe('centre');
    expect(mapArea(doc, { x: 2999, y: 1999 })).toBe('bottom-right');
  });

  it('finds the nearest entrance to a seat, ignoring other objects', () => {
    const seat = table.seats[0]?.id ?? '';
    const pos = seatPosition(doc, seat);
    expect(pos).not.toBeNull();
    expect(nearestObject(doc, pos ?? { x: 0, y: 0 }, ['entrance'])?.label).toBe('Main doors');
    expect(nearestObject(doc, { x: 2900, y: 1000 }, ['entrance'])?.label).toBe('Garden door');
    expect(nearestObject(doc, { x: 2900, y: 1900 }, ['entrance', 'bar'])?.label).toBe('Bar');
    expect(nearestObject(doc, { x: 0, y: 0 }, ['dance_floor'])).toBeNull();
    expect(seatPosition(doc, uuidv7())).toBeNull();
  });
});
