import type { FloorplanDoc } from './document.ts';
import type { PlacedSeat } from './geometry.ts';
import { placedSeats } from './geometry.ts';

export interface RoomPoint {
  readonly x: number;
  readonly y: number;
}

/** A section as a shape in the room, worked out from where its seats are. */
export interface SeatRegion {
  readonly id: string;
  readonly label: string;
  readonly vip: boolean;
  readonly seatIds: readonly string[];
  /** The outline around the seats, a convex polygon in room centimetres. */
  readonly outline: readonly RoomPoint[];
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /** The middle of the section's seats (where its name goes). */
  readonly center: RoomPoint;
}

/** Room left around a section's outermost seats, centimetres. */
export const REGION_PAD_CM = 60;
const PAD_DIRECTIONS = 12;

const cross = (o: RoomPoint, a: RoomPoint, b: RoomPoint) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** The convex hull of a set of points (Andrew's monotone chain), clockwise on a y-down plane. */
export function convexHull(points: readonly RoomPoint[]): RoomPoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const half = (input: readonly RoomPoint[]) => {
    const out: RoomPoint[] = [];
    for (const p of input) {
      while (out.length >= 2) {
        const a = out[out.length - 2];
        const b = out[out.length - 1];
        if (!a || !b || cross(a, b, p) > 0) break;
        out.pop();
      }
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/**
 * Sections as shapes for the buyer's overview: one region for each section that has seats. A plan
 * stores sections as names only, so the outline is the hull around the seats, grown by `pad`; it
 * follows any later move of the seats. Seats in no section belong to no region.
 */
export function seatRegions(doc: FloorplanDoc, pad = REGION_PAD_CM): SeatRegion[] {
  const bySection = new Map<string, PlacedSeat[]>();
  for (const seat of placedSeats(doc)) {
    if (!seat.sectionId) continue;
    const seats = bySection.get(seat.sectionId);
    if (seats) seats.push(seat);
    else bySection.set(seat.sectionId, [seat]);
  }
  return doc.sections.flatMap((section) => {
    const seats = bySection.get(section.id);
    if (!seats) return [];
    const corners = convexHull(seats).flatMap((p) =>
      Array.from({ length: PAD_DIRECTIONS }, (_, i) => {
        const angle = (i / PAD_DIRECTIONS) * Math.PI * 2;
        return { x: p.x + Math.cos(angle) * pad, y: p.y + Math.sin(angle) * pad };
      }),
    );
    const outline = convexHull(corners);
    const xs = outline.map((p) => p.x);
    const ys = outline.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return [
      {
        id: section.id,
        label: section.label,
        vip: section.vip,
        seatIds: seats.map((s) => s.seatId),
        outline,
        bounds: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y },
        center: {
          x: seats.reduce((sum, s) => sum + s.x, 0) / seats.length,
          y: seats.reduce((sum, s) => sum + s.y, 0) / seats.length,
        },
      },
    ];
  });
}

function insideOutline(outline: readonly RoomPoint[], point: RoomPoint): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const b = outline[j];
    if (!a || !b) continue;
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

/** The region at a point of the room; where outlines overlap, the one whose middle is nearest. */
export function regionAt(regions: readonly SeatRegion[], point: RoomPoint): SeatRegion | null {
  let best: { region: SeatRegion; d: number } | null = null;
  for (const region of regions) {
    if (!insideOutline(region.outline, point)) continue;
    const d = Math.hypot(region.center.x - point.x, region.center.y - point.y);
    if (!best || d < best.d) best = { region, d };
  }
  return best?.region ?? null;
}

const CELL_CM = 200;
const cellKey = (cx: number, cy: number) => `${cx}:${cy}`;

/** Seats by grid cell: finding the seat under a moving pointer must not scan the whole plan. */
export function seatGrid<T extends RoomPoint>(seats: readonly T[]): ReadonlyMap<string, readonly T[]> {
  const grid = new Map<string, T[]>();
  for (const seat of seats) {
    const key = cellKey(Math.floor(seat.x / CELL_CM), Math.floor(seat.y / CELL_CM));
    const cell = grid.get(key);
    if (cell) cell.push(seat);
    else grid.set(key, [seat]);
  }
  return grid;
}

/** The nearest seat within `radius` of a point, or null. */
export function seatNear<T extends RoomPoint>(
  grid: ReadonlyMap<string, readonly T[]>,
  point: RoomPoint,
  radius: number,
): T | null {
  const x0 = Math.floor((point.x - radius) / CELL_CM);
  const x1 = Math.floor((point.x + radius) / CELL_CM);
  const y0 = Math.floor((point.y - radius) / CELL_CM);
  const y1 = Math.floor((point.y + radius) / CELL_CM);
  let best: { seat: T; d: number } | null = null;
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      for (const seat of grid.get(cellKey(cx, cy)) ?? []) {
        const d = Math.hypot(seat.x - point.x, seat.y - point.y);
        if (d <= radius && (!best || d < best.d)) best = { seat, d };
      }
    }
  }
  return best?.seat ?? null;
}
