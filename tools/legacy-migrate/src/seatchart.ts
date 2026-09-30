import { createHash } from 'node:crypto';
import { buildRoundTable, canonicalJson, FloorplanDoc, type Item, layoutProblems } from '@yayatoh/floorplan';
import { legacySeatUuid, SEAT_NAMESPACE, uuidv5 } from './ids.ts';

/**
 * Legacy image seat charts → floor plan documents (roadmap §7.5 "Seat charts", M2.2c).
 *
 * A legacy chart (`seatcharts`, one per seated ticket type) is an image with seats drawn on it:
 * each `seats` row has CSS pixel coordinates of its top-left corner (`"Xpx,Ypx"`, or the older
 * `{"left": X, "top": Y}`), a width and height in pixels, and a `capacity` (1 = a chair, more = a
 * table of that many). The new document is in centimetres:
 * - the image becomes the plan's underlay at its natural size (the media manifest's pixel size
 *   when known, else the canvas the legacy page drew: the furthest seat plus 30 px);
 * - chairs sharing a letter prefix (`A1`, `A2`, …) become a row labelled with it, the rest a row
 *   named after the chart; a seat point sits at the centre of the legacy seat;
 * - a seat with capacity N becomes a round table with N places, as wide as the legacy seat.
 * Seat ids are `uuidv5(ns, "{inst}:seat:{id}")` (places 2…N add `:{k}`), so a rerun, and every
 * booking that pointed at a legacy seat, lands on the same seat.
 */
export const CM_PER_PX = 2.5;
const CANVAS_MARGIN_PX = 30;

export interface LegacySeat {
  readonly id: number;
  readonly name: string;
  readonly coordinates: string;
  readonly capacity: number;
  readonly status: number;
  readonly width: string | number | null;
  readonly height: string | number | null;
}

export interface LegacyChart {
  readonly id: number;
  readonly image: string;
  readonly label: string;
  readonly seats: readonly LegacySeat[];
  /** The chart image's natural size in pixels, from the media manifest (when loaded). */
  readonly natural?: { readonly width: number; readonly height: number } | null;
}

export interface ConvertedChart {
  readonly doc: FloorplanDoc;
  readonly checksum: string;
  /** Legacy seat id → its places' seat ids (one for a chair, N for a table), in order. */
  readonly places: ReadonlyMap<number, readonly string[]>;
  /** Legacy seats that are switched off (status 0): their places are blocked. */
  readonly disabled: ReadonlySet<number>;
  /** Seats whose coordinates could not be read (placed at the origin and reported). */
  readonly unreadable: readonly number[];
}

/** `"12px,34px"`, `"12,34"` or `{"left":12,"top":34}` → pixels; null when unreadable. */
export function parseCoordinates(raw: string): { x: number; y: number } | null {
  const t = raw.trim();
  if (t.startsWith('{')) {
    try {
      const o = JSON.parse(t) as { left?: unknown; top?: unknown };
      const x = Number(o.left);
      const y = Number(o.top);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    } catch {
      return null;
    }
  }
  const m = /^(-?\d+(?:\.\d+)?)\s*(?:px)?\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:px)?$/i.exec(t);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

const cm = (px: number) => Math.round(px * CM_PER_PX);
const pxOf = (v: string | number | null, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const clip = (s: string, n: number) => (s.trim() || '?').slice(0, n);

/** Convert one legacy chart for instance `instance`. Throws when the result is not a valid plan. */
export function convertChart(instance: string, chart: LegacyChart): ConvertedChart {
  const key = `${instance}:seatchart:${chart.id}`;
  const id = (part: string) => uuidv5(SEAT_NAMESPACE, `${key}:${part}`);
  const unreadable: number[] = [];
  const placed = chart.seats.map((s) => {
    const p = parseCoordinates(s.coordinates);
    if (!p) unreadable.push(s.id);
    const w = pxOf(s.width, 20);
    const h = pxOf(s.height, 20);
    return { s, x: Math.max(0, p?.x ?? 0), y: Math.max(0, p?.y ?? 0), w, h };
  });
  const widthPx = Math.max(
    chart.natural?.width ?? 0,
    ...placed.map((p) => p.x + p.w + CANVAS_MARGIN_PX),
    CANVAS_MARGIN_PX * 2,
  );
  const heightPx = Math.max(
    chart.natural?.height ?? 0,
    ...placed.map((p) => p.y + p.h + CANVAS_MARGIN_PX),
    CANVAS_MARGIN_PX * 2,
  );
  const places = new Map<number, string[]>();
  const items: Item[] = [];

  // Chairs grouped into rows by their letter prefix.
  const rows = new Map<string, typeof placed>();
  for (const p of placed.filter((q) => q.s.capacity <= 1)) {
    const prefix = /^([A-Za-z]+)\s*-?\s*\d/.exec(p.s.name.trim())?.[1]?.toUpperCase() ?? '';
    rows.set(prefix, [...(rows.get(prefix) ?? []), p]);
  }
  for (const [prefix, members] of [...rows.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const ox = Math.min(...members.map((m) => cm(m.x + m.w / 2)));
    const oy = Math.min(...members.map((m) => cm(m.y + m.h / 2)));
    const used = new Set<string>();
    const seats = members
      .sort((a, b) => a.s.id - b.s.id)
      .map((m) => {
        const uuid = legacySeatUuid(instance, m.s.id);
        places.set(m.s.id, [uuid]);
        let label = clip(
          prefix
            ? m.s.name
                .trim()
                .slice(prefix.length)
                .replace(/^[\s-]+/, '')
            : m.s.name,
          40,
        );
        if (used.has(label.toLowerCase())) label = clip(`${label} (${m.s.id})`, 40);
        used.add(label.toLowerCase());
        return {
          id: uuid,
          label,
          x: cm(m.x + m.w / 2) - ox,
          y: cm(m.y + m.h / 2) - oy,
          accessible: false,
        };
      });
    for (let i = 0; i < seats.length; i += 500)
      items.push({
        kind: 'row',
        id: id(`row:${prefix}:${i}`),
        label: clip(`${prefix || chart.label}${i ? ` ${i / 500 + 1}` : ''}`, 40),
        sectionId: null,
        x: ox,
        y: oy,
        rotation: 0,
        seats: seats.slice(i, i + 500),
      });
  }
  // Tables: a seat with a capacity.
  const tableLabels = new Set<string>();
  for (const p of placed.filter((q) => q.s.capacity > 1).sort((a, b) => a.s.id - b.s.id)) {
    const n = Math.min(40, Math.floor(p.s.capacity));
    let label = clip(p.s.name, 40);
    if (tableLabels.has(label.toLowerCase())) label = clip(`${label} (${p.s.id})`, 40);
    tableLabels.add(label.toLowerCase());
    const t = buildRoundTable({
      label,
      seats: n,
      x: cm(p.x + p.w / 2),
      y: cm(p.y + p.h / 2),
      diameter: Math.max(60, cm(Math.min(p.w, p.h))),
    });
    const ids = t.seats.map((_, k) => legacySeatUuid(instance, p.s.id, k + 1));
    places.set(p.s.id, ids);
    items.push({
      ...t,
      id: id(`table:${p.s.id}`),
      seats: t.seats.map((s, k) => ({ ...s, id: ids[k] as string })),
    });
  }

  // Seats near the edge of a table may fall outside the drawn canvas: grow the room to hold them.
  const draft = FloorplanDoc.parse({
    version: 1,
    width: cm(widthPx),
    height: cm(heightPx),
    underlay: {
      url: legacyMediaUrl(instance, chart.image),
      x: 0,
      y: 0,
      width: cm(widthPx),
      height: cm(heightPx),
    },
    sections: [],
    items,
  });
  const reach = items.flatMap((it) =>
    it.kind === 'object' ? [] : it.seats.map((s) => ({ x: it.x + s.x, y: it.y + s.y })),
  );
  const doc: FloorplanDoc = {
    ...draft,
    width: Math.max(draft.width, ...reach.map((r) => r.x + 50)),
    height: Math.max(draft.height, ...reach.map((r) => r.y + 50)),
  };
  const problems = layoutProblems(doc);
  if (problems.length)
    throw new Error(`seat chart ${instance}:${chart.id}: ${problems.map((p) => p.code).join(', ')}`);
  return {
    doc,
    checksum: checksumOf(doc),
    places,
    disabled: new Set(chart.seats.filter((s) => Number(s.status) !== 1).map((s) => s.id)),
    unreadable,
  };
}

/**
 * Several charts of one event (one per seated ticket type) side by side in one event plan: one
 * section per chart, charts stacked top to bottom with a 2 m gap. The underlay is kept only when
 * there is a single chart (the per-chart layouts keep every image).
 */
export function mergeCharts(
  instance: string,
  eventKey: string,
  charts: readonly { label: string; converted: ConvertedChart }[],
): FloorplanDoc {
  if (charts.length === 1) return (charts[0] as { converted: ConvertedChart }).converted.doc;
  let offset = 0;
  const sections: FloorplanDoc['sections'] = [];
  const items: Item[] = [];
  const labels = new Set<string>();
  for (const [i, c] of charts.entries()) {
    const sectionId = uuidv5(SEAT_NAMESPACE, `${instance}:event-plan:${eventKey}:section:${i}`);
    sections.push({ id: sectionId, label: clip(c.label, 40), vip: false });
    for (const it of c.converted.doc.items) {
      if (it.kind === 'object') continue;
      let label = it.label;
      if (labels.has(`${it.kind}:${label.toLowerCase()}`)) label = clip(`${label} · ${i + 1}`, 40);
      labels.add(`${it.kind}:${label.toLowerCase()}`);
      items.push({ ...it, label, sectionId, y: it.y + offset });
    }
    offset += c.converted.doc.height + 200;
  }
  const doc = FloorplanDoc.parse({
    version: 1,
    width: Math.max(...charts.map((c) => c.converted.doc.width)),
    height: Math.max(offset - 200, 1),
    underlay: null,
    sections,
    items,
  });
  const problems = layoutProblems(doc);
  if (problems.length)
    throw new Error(`event plan ${instance}:${eventKey}: ${problems.map((p) => p.code).join(', ')}`);
  return doc;
}

export const checksumOf = (doc: FloorplanDoc) =>
  createHash('sha256').update(canonicalJson(doc)).digest('hex');

/** Where the media copy puts a legacy upload (roadmap §7.5 "Media": R2 under `legacy/{inst}/…`). */
export const legacyMediaUrl = (instance: string, path: string) =>
  `legacy/${instance}/storage/${path.replace(/^\/+/, '').replace(/^storage\//, '')}`.slice(0, 500);
