import type { FloorplanDoc, Item } from './document.ts';
import { placedSeats } from './geometry.ts';

/**
 * Where things are, in words (the venue map's text alternative, M1.7e). Plans have no compass,
 * so positions are described on the map as drawn: a 3 × 3 grid of the room.
 */
export const MAP_AREAS = [
  'top-left',
  'top',
  'top-right',
  'left',
  'centre',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
] as const;
export type MapArea = (typeof MAP_AREAS)[number];

const rotate = (x: number, y: number, deg: number) => {
  const r = (deg * Math.PI) / 180;
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
};

/**
 * The visual centre of an item in room centimetres: an object's rectangle (drawn from its
 * origin, rotated about it), a table's centre (its origin), the middle of a row's seats.
 */
export function itemCenter(item: Item): { x: number; y: number } {
  if (item.kind === 'object') {
    const c = rotate(item.width / 2, item.height / 2, item.rotation);
    return { x: Math.round(item.x + c.x), y: Math.round(item.y + c.y) };
  }
  if (item.kind === 'table') return { x: item.x, y: item.y };
  const n = item.seats.length || 1;
  const local = item.seats.reduce((a, s) => ({ x: a.x + s.x / n, y: a.y + s.y / n }), { x: 0, y: 0 });
  const c = rotate(local.x, local.y, item.rotation);
  return { x: Math.round(item.x + c.x), y: Math.round(item.y + c.y) };
}

/** Which ninth of the room a point is in. */
export function mapArea(doc: Pick<FloorplanDoc, 'width' | 'height'>, p: { x: number; y: number }): MapArea {
  const col = p.x < doc.width / 3 ? 0 : p.x < (doc.width * 2) / 3 ? 1 : 2;
  const row = p.y < doc.height / 3 ? 0 : p.y < (doc.height * 2) / 3 ? 1 : 2;
  return MAP_AREAS[row * 3 + col] as MapArea;
}

/** The closest object of the given types to a point (e.g. the nearest entrance), or null. */
export function nearestObject(
  doc: FloorplanDoc,
  p: { x: number; y: number },
  types: readonly string[],
): Extract<Item, { kind: 'object' }> | null {
  let best: { item: Extract<Item, { kind: 'object' }>; d: number } | null = null;
  for (const item of doc.items) {
    if (item.kind !== 'object' || !types.includes(item.objectType)) continue;
    const c = itemCenter(item);
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (!best || d < best.d) best = { item, d };
  }
  return best?.item ?? null;
}

/** A seat's absolute position in the room, or null if the plan has no such seat. */
export function seatPosition(doc: FloorplanDoc, seatId: string): { x: number; y: number } | null {
  const s = placedSeats(doc).find((p) => p.seatId === seatId);
  return s ? { x: s.x, y: s.y } : null;
}
