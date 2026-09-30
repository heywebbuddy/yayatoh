import { type FloorplanDoc, MAX_SEATS } from './document.ts';

export interface PlacedSeat {
  readonly seatId: string;
  readonly itemId: string;
  readonly itemLabel: string;
  readonly sectionId: string | null;
  /** "Row A · 5", "Table 3 · 2" — what goes on the ticket. */
  readonly label: string;
  /** Absolute position in the room, centimetres, rounded. */
  readonly x: number;
  readonly y: number;
  readonly accessible: boolean;
}

const rotate = (x: number, y: number, deg: number) => {
  const r = (deg * Math.PI) / 180;
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
};

/** Every seat with its absolute position and printable label. */
export function placedSeats(doc: FloorplanDoc): PlacedSeat[] {
  const out: PlacedSeat[] = [];
  for (const item of doc.items) {
    if (item.kind === 'object') continue;
    const prefix = item.kind === 'row' ? 'Row' : 'Table';
    for (const s of item.seats) {
      const p = rotate(s.x, s.y, item.rotation);
      out.push({
        seatId: s.id,
        itemId: item.id,
        itemLabel: item.label,
        sectionId: item.sectionId,
        label: `${prefix} ${item.label} · ${s.label}`,
        x: Math.round(item.x + p.x),
        y: Math.round(item.y + p.y),
        accessible: s.accessible,
      });
    }
  }
  return out;
}

export interface LayoutProblem {
  readonly code:
    | 'duplicate_item'
    | 'duplicate_seat'
    | 'duplicate_label'
    | 'unknown_section'
    | 'too_many_seats'
    | 'outside_room';
  readonly id: string;
}

/**
 * Structural checks the schema cannot express: unique ids across the whole document, unique
 * seat labels within an item, unique item labels, known sections, the seat ceiling, and every
 * seat inside the room.
 */
export function layoutProblems(doc: FloorplanDoc): LayoutProblem[] {
  const problems: LayoutProblem[] = [];
  const itemIds = new Set<string>();
  const seatIds = new Set<string>();
  const itemLabels = new Set<string>();
  const sections = new Set(doc.sections.map((s) => s.id));
  let seats = 0;
  for (const item of doc.items) {
    if (itemIds.has(item.id)) problems.push({ code: 'duplicate_item', id: item.id });
    itemIds.add(item.id);
    if (item.kind === 'object') continue;
    const key = `${item.kind}:${item.label.toLowerCase()}`;
    if (itemLabels.has(key)) problems.push({ code: 'duplicate_label', id: item.id });
    itemLabels.add(key);
    if (item.sectionId && !sections.has(item.sectionId))
      problems.push({ code: 'unknown_section', id: item.id });
    const labels = new Set<string>();
    for (const s of item.seats) {
      seats++;
      if (seatIds.has(s.id)) problems.push({ code: 'duplicate_seat', id: s.id });
      seatIds.add(s.id);
      if (labels.has(s.label.toLowerCase())) problems.push({ code: 'duplicate_label', id: s.id });
      labels.add(s.label.toLowerCase());
    }
  }
  if (seats > MAX_SEATS) problems.push({ code: 'too_many_seats', id: String(seats) });
  for (const p of placedSeats(doc))
    if (p.x < 0 || p.y < 0 || p.x > doc.width || p.y > doc.height)
      problems.push({ code: 'outside_room', id: p.seatId });
  return problems;
}

/** Canonical JSON (sorted keys) so equal layouts have equal checksums. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export const seatCount = (doc: FloorplanDoc) =>
  doc.items.reduce((n, i) => n + (i.kind === 'object' ? 0 : i.seats.length), 0);

export interface Hit {
  readonly itemId: string;
  /** The seat under the point, or null for the table or row around it. */
  readonly seatId: string | null;
}

/**
 * What is at a point of the room (centimetres): a seat (within `seatRadius`), else the table or
 * row whose outline — grown by `pad` to take in the seats around a table — contains it; objects
 * are never hit. Used to drop a guest onto the plan.
 */
export function hitTest(
  doc: FloorplanDoc,
  point: { readonly x: number; readonly y: number },
  opts: { readonly seatRadius?: number; readonly pad?: number } = {},
): Hit | null {
  const seatRadius = opts.seatRadius ?? 25;
  const pad = opts.pad ?? 60;
  let best: { seat: PlacedSeat; d: number } | null = null;
  for (const seat of placedSeats(doc)) {
    const d = Math.hypot(seat.x - point.x, seat.y - point.y);
    if (d <= seatRadius && (!best || d < best.d)) best = { seat, d };
  }
  if (best) return { itemId: best.seat.itemId, seatId: best.seat.seatId };
  // Later items are drawn on top: test them first.
  for (const item of [...doc.items].reverse()) {
    if (item.kind === 'object') continue;
    const local = rotate(point.x - item.x, point.y - item.y, -item.rotation);
    if (item.kind === 'table') {
      const inside =
        item.shape === 'round'
          ? Math.hypot(local.x, local.y) <= item.width / 2 + pad
          : Math.abs(local.x) <= item.width / 2 + pad && Math.abs(local.y) <= item.height / 2 + pad;
      if (inside) return { itemId: item.id, seatId: null };
      continue;
    }
    const xs = item.seats.map((s) => s.x);
    const ys = item.seats.map((s) => s.y);
    if (
      local.x >= Math.min(...xs) - pad &&
      local.x <= Math.max(...xs) + pad &&
      local.y >= Math.min(...ys) - pad &&
      local.y <= Math.max(...ys) + pad
    )
      return { itemId: item.id, seatId: null };
  }
  return null;
}
