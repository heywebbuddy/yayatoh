import { uuidv7 } from '@yayatoh/kernel';
import type { Item, Seat } from './document.ts';

/** Seat spacing defaults, centimetres (a theatre seat is ~50 cm wide). */
export const SEAT_PITCH_CM = 55;

/** A straight row of numbered seats, left to right from its origin. */
export function buildRow(opts: {
  label: string;
  count: number;
  x: number;
  y: number;
  start?: number;
  pitch?: number;
  rotation?: number;
  sectionId?: string | null;
}): Extract<Item, { kind: 'row' }> {
  const pitch = opts.pitch ?? SEAT_PITCH_CM;
  const start = opts.start ?? 1;
  const seats: Seat[] = Array.from({ length: opts.count }, (_, i) => ({
    id: uuidv7(),
    label: String(start + i),
    x: i * pitch,
    y: 0,
    accessible: false,
  }));
  return {
    kind: 'row',
    id: uuidv7(),
    label: opts.label,
    sectionId: opts.sectionId ?? null,
    x: opts.x,
    y: opts.y,
    rotation: opts.rotation ?? 0,
    seats,
  };
}

/** A round table with seats evenly around it (seat 1 at the top, clockwise). */
export function buildRoundTable(opts: {
  label: string;
  seats: number;
  x: number;
  y: number;
  diameter?: number;
  sectionId?: string | null;
}): Extract<Item, { kind: 'table' }> {
  const d = opts.diameter ?? 180;
  const r = d / 2 + 35;
  const seats: Seat[] = Array.from({ length: opts.seats }, (_, i) => {
    const a = (2 * Math.PI * i) / opts.seats - Math.PI / 2;
    return {
      id: uuidv7(),
      label: String(i + 1),
      x: Math.round(r * Math.cos(a)),
      y: Math.round(r * Math.sin(a)),
      accessible: false,
    };
  });
  return {
    kind: 'table',
    id: uuidv7(),
    label: opts.label,
    sectionId: opts.sectionId ?? null,
    shape: 'round',
    x: opts.x,
    y: opts.y,
    width: d,
    height: d,
    rotation: 0,
    seats,
  };
}

/** Row labels A, B, … Z, AA, AB, … */
export function rowLabel(i: number): string {
  let n = i;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/**
 * A starting layout from a few numbers (the template picker, and the accessible alternative to
 * drawing): an optional stage at the top, then theatre rows, then a grid of round tables.
 */
export function quickLayout(opts: {
  rows: number;
  seatsPerRow: number;
  tables: number;
  seatsPerTable: number;
  stage: boolean;
}): {
  version: 1;
  width: number;
  height: number;
  underlay: null;
  sections: [];
  items: Item[];
} {
  const margin = 200;
  const rowWidth = Math.max(0, opts.seatsPerRow - 1) * SEAT_PITCH_CM;
  const tablePitch = 400;
  const tablesPerLine = Math.max(1, Math.min(opts.tables, 8));
  const width = Math.max(1000, margin * 2 + Math.max(rowWidth, (tablesPerLine - 1) * tablePitch + 260));
  const items: Item[] = [];
  let y = margin;
  if (opts.stage) {
    const w = Math.min(width - margin * 2, 1200);
    items.push({
      kind: 'object',
      id: uuidv7(),
      objectType: 'stage',
      label: 'Stage',
      x: Math.round((width - w) / 2),
      y,
      width: w,
      height: 300,
      rotation: 0,
    });
    y += 300 + 200;
  }
  for (let r = 0; r < opts.rows; r++) {
    items.push(
      buildRow({ label: rowLabel(r), count: opts.seatsPerRow, x: Math.round((width - rowWidth) / 2), y }),
    );
    y += 90;
  }
  if (opts.rows > 0 && opts.tables > 0) y += 150;
  for (let t = 0; t < opts.tables; t++) {
    const col = t % tablesPerLine;
    const line = Math.floor(t / tablesPerLine);
    items.push(
      buildRoundTable({
        label: String(t + 1),
        seats: opts.seatsPerTable,
        x: margin + 130 + col * tablePitch,
        y: y + 130 + line * tablePitch,
      }),
    );
  }
  const height = (opts.tables > 0 ? y + Math.ceil(opts.tables / tablesPerLine) * tablePitch : y) + margin;
  return { version: 1, width, height, underlay: null, sections: [], items };
}
