import { uuidv7 } from '@yayatoh/kernel';
import { describe, expect, it } from 'vitest';
import { boothPlan, boothProblems, boothSize, boothsOf, boothsOverlap, FloorplanDoc } from '../src/index.ts';

const booth = (number: string, x: number, y = 0, w = 300, h = 300, category: string | null = null) => ({
  id: uuidv7(),
  number,
  category,
  x,
  y,
  width: w,
  height: h,
});

describe('booths on the floor plan (M5.4a)', () => {
  it('booth objects carry a number and category and round-trip through a plan', () => {
    const list = [booth('B1', 0, 0, 300, 300, 'Food'), booth('B2', 400)];
    const doc = FloorplanDoc.parse(boothPlan(list));
    expect(doc.items[0]).toMatchObject({
      kind: 'object',
      objectType: 'booth',
      label: 'B1',
      booth: { number: 'B1', category: 'Food' },
    });
    expect(boothsOf(doc)).toEqual(list);
    // The plan fits every booth with a margin.
    expect(doc.width).toBeGreaterThanOrEqual(700 + 200);
    expect(boothProblems(doc)).toEqual([]);
  });

  it('booth numbers are checked: format, uniqueness (case-insensitive), booth objects only', () => {
    const base = boothPlan([booth('A1', 0), booth('a1', 400)]);
    const problems = boothProblems(FloorplanDoc.parse(base));
    expect(problems.map((p) => p.code)).toEqual(['duplicate_booth_number']);
    const stage = { ...base.items[0], objectType: 'stage' };
    expect(boothProblems(FloorplanDoc.parse({ ...base, items: [stage] })).map((p) => p.code)).toEqual([
      'booth_info_not_booth',
    ]);
    expect(
      FloorplanDoc.safeParse({ ...base, items: [{ ...base.items[0], booth: { number: '<b>' } }] }).success,
    ).toBe(false);
    // Plans made before M5.4a (objects without booth info) still parse.
    const { booth: _b, ...plain } = base.items[0] as Record<string, unknown>;
    expect(FloorplanDoc.safeParse({ ...base, items: [plain] }).success).toBe(true);
  });

  it('overlap is strict (touching booths are fine) and sizes read in metres', () => {
    expect(boothsOverlap(booth('1', 0), booth('2', 300))).toBe(false);
    expect(boothsOverlap(booth('1', 0), booth('2', 299))).toBe(true);
    expect(boothsOverlap(booth('1', 0, 0), booth('2', 0, 300))).toBe(false);
    const doc = boothPlan([booth('1', 0), booth('2', 100)]);
    expect(boothProblems(doc).map((p) => p.code)).toEqual(['booths_overlap']);
    expect(boothSize({ width: 300, height: 250 })).toEqual({ width: 3, depth: 2.5, area: 7.5 });
  });
});
