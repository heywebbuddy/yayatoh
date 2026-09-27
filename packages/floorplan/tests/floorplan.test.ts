import { uuidv7 } from '@yayatoh/kernel';
import { describe, expect, it } from 'vitest';
import {
  buildRoundTable,
  buildRow,
  canonicalJson,
  FloorplanDoc,
  layoutProblems,
  placedSeats,
  seatCount,
} from '../src/index.ts';

const room = (items: unknown[], sections: unknown[] = []) =>
  FloorplanDoc.parse({ version: 1, width: 3000, height: 2000, sections, items });

describe('floor plan documents', () => {
  it('builds rows and round tables with stable, unique seat ids and printable labels', () => {
    const row = buildRow({ label: 'A', count: 10, x: 100, y: 100 });
    const table = buildRoundTable({ label: '3', seats: 8, x: 1500, y: 1000 });
    const doc = room([row, table]);
    expect(layoutProblems(doc)).toEqual([]);
    expect(seatCount(doc)).toBe(18);
    const placed = placedSeats(doc);
    expect(placed[0]).toMatchObject({ label: 'Row A · 1', x: 100, y: 100 });
    expect(placed[9]).toMatchObject({ label: 'Row A · 10', x: 100 + 9 * 55 });
    expect(placed.find((p) => p.label === 'Table 3 · 1')).toMatchObject({ x: 1500, y: 1000 - 125 });
    expect(new Set(placed.map((p) => p.seatId)).size).toBe(18);
  });

  it('rotates items around their origin', () => {
    const row = { ...buildRow({ label: 'B', count: 2, x: 500, y: 500, pitch: 100 }), rotation: 90 };
    const [, second] = placedSeats(room([row]));
    expect(second).toMatchObject({ x: 500, y: 600 });
  });

  it('finds duplicate ids and labels, unknown sections, and seats outside the room', () => {
    const a = buildRow({ label: 'A', count: 2, x: 100, y: 100 });
    const dupLabel = buildRow({ label: 'a', count: 2, x: 100, y: 300 });
    const dupSeat = { ...buildRow({ label: 'C', count: 1, x: 100, y: 500 }), seats: [a.seats[0]] };
    const lost = buildRow({ label: 'D', count: 1, x: 100, y: 700, sectionId: uuidv7() });
    const outside = buildRow({ label: 'E', count: 3, x: 2950, y: 100 });
    const codes = layoutProblems(room([a, dupLabel, dupSeat, lost, outside])).map((p) => p.code);
    expect(codes.sort()).toEqual([
      'duplicate_label',
      'duplicate_seat',
      'outside_room',
      'outside_room',
      'unknown_section',
    ]);
  });

  it('rejects malformed documents at the schema', () => {
    expect(FloorplanDoc.safeParse({ version: 2, width: 1, height: 1, items: [] }).success).toBe(false);
    const bad = { ...buildRow({ label: 'A', count: 1, x: 0, y: 0 }), x: 1.5 };
    expect(FloorplanDoc.safeParse({ version: 1, width: 10, height: 10, items: [bad] }).success).toBe(false);
  });

  it('canonical JSON ignores key order', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  });
});
