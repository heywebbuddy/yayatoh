/**
 * Best available (M6.11a): given how many seats a party wants, pick the best free seats that sit
 * together. Pure, so the same choice is tested exhaustively and run on the server inside the
 * seat claim.
 *
 * Together means one table, or consecutive seats of one row (by their order in the row). The
 * best block ranks by:
 *   1. section score: the organizer's score for the section (higher first), else the section's
 *      distance to the stage (nearer first); scored sections come before unscored ones;
 *   2. row: nearer the stage (else earlier in the plan);
 *   3. not using accessible or companion seats the party did not ask for;
 *   4. for a party with an accessible seat: using companion seats;
 *   5. centre: nearer the middle of the row.
 * A party is never split when a block that fits exists. Otherwise it is split into as few
 * pieces as possible (largest first), and the caller tells the buyer.
 */

export interface PlanSeat {
  readonly seatUuid: string;
  readonly itemId: string;
  readonly itemKind: 'row' | 'table';
  /** The row's or table's position in the plan (its order in the document). */
  readonly itemOrder: number;
  /** The seat's position in its row or table (0-based, document order). */
  readonly index: number;
  readonly sectionId: string | null;
  /** Position in the room (centimetres). */
  readonly x: number;
  readonly y: number;
  readonly accessible: boolean;
  readonly companion: boolean;
  /** Can be picked: free, of the wanted price, not kept back from this buyer. */
  readonly free: boolean;
}

export interface BestAvailableRequest {
  /** Every seat of the chart (free or not): the geometry ranks rows and sections. */
  readonly seats: readonly PlanSeat[];
  readonly quantity: number;
  /** Centres of the plan's stages (centimetres); none = rank by plan order. */
  readonly stages: readonly { readonly x: number; readonly y: number }[];
  /** The organizer's section scores (0–100, higher is better), by section id. */
  readonly sectionScores: Readonly<Record<string, number>>;
  /** How many of the seats must be accessible (a party with a wheelchair user: 1). */
  readonly accessible: number;
  /** At most this many companion seats per accessible seat chosen; null = no limit. */
  readonly companionsPerAccessible: number | null;
}

export interface BestAvailablePick {
  /** The chosen seats, piece by piece, each piece in row or table order. */
  readonly seats: string[];
  /** The pieces the party was split into (1 = together). */
  readonly pieces: number;
}

export type BestAvailableFailure = 'not_enough_seats' | 'no_accessible_seat';

/** Seats sit together when they share a table, or are consecutive in one row. */
export function isTogether(seats: readonly PlanSeat[]): boolean {
  if (seats.length <= 1) return true;
  const first = seats[0] as PlanSeat;
  if (seats.some((s) => s.itemId !== first.itemId)) return false;
  if (first.itemKind === 'table') return true;
  const idx = seats.map((s) => s.index).sort((a, b) => a - b);
  return idx.every((v, i) => i === 0 || v === (idx[i - 1] as number) + 1);
}

type Key = readonly number[];

const compareKeys = (a: Key, b: Key) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

interface Item {
  readonly id: string;
  readonly kind: 'row' | 'table';
  readonly order: number;
  readonly sectionId: string | null;
  /** All seats of the item by index (free or not). */
  readonly size: number;
  readonly sectionKey: readonly [number, number];
  readonly rowKey: number;
  /** Free seats, by index. */
  readonly free: PlanSeat[];
}

const dist = (a: { x: number; y: number }, stages: readonly { x: number; y: number }[]) =>
  stages.length === 0 ? 0 : Math.min(...stages.map((s) => Math.hypot(a.x - s.x, a.y - s.y)));

function itemsOf(req: BestAvailableRequest): Item[] {
  const byItem = new Map<string, PlanSeat[]>();
  const bySection = new Map<string, PlanSeat[]>();
  for (const s of req.seats) {
    const inItem = byItem.get(s.itemId);
    if (inItem) inItem.push(s);
    else byItem.set(s.itemId, [s]);
    const k = s.sectionId ?? '';
    const inSection = bySection.get(k);
    if (inSection) inSection.push(s);
    else bySection.set(k, [s]);
  }
  const centre = (seats: readonly PlanSeat[]) => ({
    x: seats.reduce((n, s) => n + s.x, 0) / seats.length,
    y: seats.reduce((n, s) => n + s.y, 0) / seats.length,
  });
  const sectionDistance = new Map<string, number>();
  for (const [k, seats] of bySection) sectionDistance.set(k, Math.round(dist(centre(seats), req.stages)));
  const items: Item[] = [];
  for (const [id, seats] of byItem) {
    const first = seats[0] as PlanSeat;
    const score = first.sectionId === null ? undefined : req.sectionScores[first.sectionId];
    items.push({
      id,
      kind: first.itemKind,
      order: first.itemOrder,
      sectionId: first.sectionId,
      size: seats.length,
      // Scored sections first (highest score first), then the rest by distance to the stage.
      sectionKey: score === undefined ? [1, sectionDistance.get(first.sectionId ?? '') ?? 0] : [0, -score],
      rowKey: req.stages.length ? Math.round(dist(centre(seats), req.stages)) : first.itemOrder,
      free: seats.filter((s) => s.free).sort((a, b) => a.index - b.index),
    });
  }
  return items.sort((a, b) => a.order - b.order);
}

interface Tally {
  accessible: number;
  companions: number;
}

/**
 * The best window of exactly `size` free seats in one row or table, not using `taken`, that keeps
 * the whole choice within the rules (`ok`). Null when none exists.
 */
function bestWindow(
  items: readonly Item[],
  size: number,
  taken: ReadonlySet<string>,
  want: { accessible: number; cap: number | null },
  ok: (w: Tally) => boolean,
): PlanSeat[] | null {
  let best: { seats: PlanSeat[]; key: Key } | null = null;
  for (const item of items) {
    const free = item.free.filter((s) => !taken.has(s.seatUuid));
    if (free.length < size) continue;
    for (const w of windows(item.kind, free, size, want)) {
      const tally = {
        accessible: w.filter((s) => s.accessible).length,
        companions: w.filter((s) => s.companion && !s.accessible).length,
      };
      if (!ok(tally)) continue;
      const wasted =
        Math.max(0, tally.accessible - want.accessible) + (want.accessible === 0 ? tally.companions : 0);
      const mid = w.reduce((n, s) => n + s.index, 0) / size;
      const key: Key = [
        ...item.sectionKey,
        item.rowKey,
        wasted,
        want.accessible > 0 ? -tally.companions : 0,
        item.kind === 'row' ? Math.abs(mid - (item.size - 1) / 2) : 0,
        item.order,
        (w[0] as PlanSeat).index,
      ];
      if (!best || compareKeys(key, best.key) < 0) best = { seats: w, key };
    }
  }
  return best?.seats ?? null;
}

/**
 * Candidate blocks of `size` seats in one row or table. A row: every run of consecutive seats. A
 * table: its seats are all together, so one block is enough: for a party with a wheelchair user,
 * the fewest accessible seats that work, then as many companion seats as allowed, then others;
 * for anyone else, ordinary seats first, accessible seats last.
 */
function* windows(
  kind: 'row' | 'table',
  free: readonly PlanSeat[],
  size: number,
  want: { accessible: number; cap: number | null },
): Generator<PlanSeat[]> {
  if (kind === 'row') {
    for (let i = 0; i + size <= free.length; i++) {
      const w = free.slice(i, i + size);
      if ((w[size - 1] as PlanSeat).index - (w[0] as PlanSeat).index === size - 1) yield w;
    }
    return;
  }
  const byIndex = (a: PlanSeat, b: PlanSeat) => a.index - b.index;
  const acc = free.filter((s) => s.accessible);
  const comp = free.filter((s) => s.companion && !s.accessible);
  const other = free.filter((s) => !s.accessible && !s.companion);
  if (want.accessible === 0) {
    yield [...other, ...comp, ...acc].slice(0, size).sort(byIndex);
    return;
  }
  for (let a = Math.max(1, Math.min(want.accessible, size)); a <= Math.min(acc.length, size); a++) {
    const c = Math.min(comp.length, size - a, want.cap === null ? size : a * want.cap);
    const o = size - a - c;
    if (o <= other.length) {
      yield [...acc.slice(0, a), ...comp.slice(0, c), ...other.slice(0, o)].sort(byIndex);
      return;
    }
  }
}

/** The best seats for a party, or why there are none. */
export function bestAvailable(req: BestAvailableRequest): BestAvailablePick | BestAvailableFailure {
  const items = itemsOf(req);
  const freeCount = items.reduce((n, i) => n + i.free.length, 0);
  if (req.quantity < 1 || freeCount < req.quantity) return 'not_enough_seats';
  const needAccessible = Math.min(req.accessible, req.quantity);
  const cap = req.companionsPerAccessible;
  const chosen: PlanSeat[] = [];
  const taken = new Set<string>();
  const total: Tally = { accessible: 0, companions: 0 };
  let pieces = 0;
  while (chosen.length < req.quantity) {
    const remaining = req.quantity - chosen.length;
    const accessibleLeft = Math.max(0, needAccessible - total.accessible);
    let piece: PlanSeat[] | null = null;
    // Largest piece first: the whole party when a block fits, else as few pieces as possible.
    for (let size = remaining; size >= 1 && !piece; size--) {
      piece = bestWindow(items, size, taken, { accessible: needAccessible, cap }, (w) => {
        const acc = total.accessible + w.accessible;
        const comp = total.companions + w.companions;
        // The accessible seats come with the first piece that can carry them; the whole party
        // must end with them.
        if (size === remaining && acc < needAccessible) return false;
        if (accessibleLeft > 0 && w.accessible === 0) return false;
        return cap === null || comp <= acc * cap;
      });
    }
    if (!piece) return needAccessible > total.accessible ? 'no_accessible_seat' : 'not_enough_seats';
    for (const s of piece) {
      chosen.push(s);
      taken.add(s.seatUuid);
      if (s.accessible) total.accessible++;
      else if (s.companion) total.companions++;
    }
    pieces++;
  }
  return { seats: chosen.map((s) => s.seatUuid), pieces };
}
