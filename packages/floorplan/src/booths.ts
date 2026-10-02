import type { FloorObject, FloorplanDoc } from './document.ts';

/**
 * Exhibit-hall booths (M5.4a): booth objects that carry a number, a size (the object's width ×
 * height, centimetres) and a category. Pure helpers shared by the program module (which stores
 * booths as rows) and the maps that draw them.
 */
export interface BoothShape {
  readonly id: string;
  readonly number: string;
  readonly category: string | null;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Room around the booths on a generated plan, centimetres. */
export const BOOTH_MARGIN_CM = 200;

/** A booth as a floor-plan object. */
export function boothObject(b: BoothShape): FloorObject {
  return {
    kind: 'object',
    id: b.id,
    objectType: 'booth',
    label: b.number,
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    rotation: 0,
    booth: { number: b.number, category: b.category },
  };
}

/** A plan that holds exactly these booths, sized to fit them with a margin. */
export function boothPlan(booths: readonly BoothShape[]): FloorplanDoc {
  const right = Math.max(0, ...booths.map((b) => b.x + b.width));
  const bottom = Math.max(0, ...booths.map((b) => b.y + b.height));
  return {
    version: 1,
    width: Math.max(1000, right + BOOTH_MARGIN_CM),
    height: Math.max(600, bottom + BOOTH_MARGIN_CM),
    underlay: null,
    sections: [],
    items: booths.map(boothObject),
  };
}

/** The booths of any plan (objects of type `booth` with booth info), in plan order. */
export function boothsOf(doc: FloorplanDoc): BoothShape[] {
  return doc.items.flatMap((i) =>
    i.kind === 'object' && i.objectType === 'booth' && i.booth
      ? [
          {
            id: i.id,
            number: i.booth.number,
            category: i.booth.category,
            x: i.x,
            y: i.y,
            width: i.width,
            height: i.height,
          },
        ]
      : [],
  );
}

/** Whether two booths' rectangles overlap (touching edges don't). */
export function boothsOverlap(a: BoothShape, b: BoothShape): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Booth size in metres, e.g. `{ width: 3, depth: 2.5, area: 7.5 }` (one decimal). */
export function boothSize(b: Pick<BoothShape, 'width' | 'height'>) {
  const m = (cm: number) => Math.round(cm / 10) / 10;
  return { width: m(b.width), depth: m(b.height), area: Math.round((b.width * b.height) / 1_000) / 10 };
}

export interface BoothProblem {
  readonly code: 'duplicate_booth_number' | 'booth_info_not_booth' | 'booths_overlap';
  readonly id: string;
  readonly otherId?: string;
}

/**
 * Booth checks the schema can't express: numbers unique within a plan (case-insensitive), booth
 * info only on booth objects, and overlapping booths (a warning for editors, not an error).
 */
export function boothProblems(doc: FloorplanDoc): BoothProblem[] {
  const out: BoothProblem[] = [];
  const seen = new Map<string, string>();
  for (const i of doc.items) {
    if (i.kind !== 'object' || !i.booth) continue;
    if (i.objectType !== 'booth') out.push({ code: 'booth_info_not_booth', id: i.id });
    const key = i.booth.number.toLowerCase();
    const first = seen.get(key);
    if (first) out.push({ code: 'duplicate_booth_number', id: i.id, otherId: first });
    else seen.set(key, i.id);
  }
  const booths = boothsOf(doc);
  for (let a = 0; a < booths.length; a++)
    for (let b = a + 1; b < booths.length; b++) {
      const x = booths[a] as BoothShape;
      const y = booths[b] as BoothShape;
      if (boothsOverlap(x, y)) out.push({ code: 'booths_overlap', id: x.id, otherId: y.id });
    }
  return out;
}
