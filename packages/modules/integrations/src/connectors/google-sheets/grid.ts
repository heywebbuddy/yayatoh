/**
 * The attendee sheet as a grid of strings (M6.4b), shared by the Google Sheets connector and its
 * fake's dev controls. Pure: no I/O, no clock (callers pass `now`), no randomness (callers pass
 * `newId`).
 *
 * Google Sheets has no stable row ids, no per-row edit time and no change feed, so every row
 * carries its own identity in a last, hidden column ("Yayatoh sync"): a compact JSON stamp
 * `{"id":"r…","rev":n,"h":"<hash of the visible values>","o":<origin or null>,"at":"<iso>","k":"…"}`.
 *
 * - A row without a valid stamp was typed by a person: it gets a new id (rev 1, no origin, edited
 *   now) and the stamp is written back to its sync cell, so its id is stable from then on.
 * - A row whose visible values no longer hash to its stamp's `h` was edited by a person: rev + 1,
 *   no origin, edited now; the refreshed stamp is written back.
 * - Otherwise the stamp says it all (rev, origin of the last writer, time of the last write).
 * - `k` is a hash of the idempotency key of our last write to the row: Google has no
 *   Idempotency-Key, so a retried append finds the row it already wrote instead of adding another.
 *
 * Visible columns are found by their header labels (`SHEET_COLUMNS`), so reordered columns still
 * map; fully empty rows are skipped (a cleared row reads as deleted).
 */

/** The tab the connector creates and reads. */
export const SHEET_TAB = 'Attendees';
/** The header of the hidden last column that holds each row's stamp. */
export const SYNC_LABEL = 'Yayatoh sync';
/** What the connector reads: the header row and every row below it, 26 columns wide. */
export const READ_RANGE = `${SHEET_TAB}!A1:Z`;
/** Where appended rows go: Google finds the table at A1 and appends below its last row. */
export const APPEND_RANGE = `${SHEET_TAB}!A1`;

/** The columns every linked sheet has (keys are the push mapping's targets). */
export const SHEET_COLUMNS = [
  { key: 'name', label: 'Name', type: 'string' },
  { key: 'email', label: 'Email', type: 'string' },
  { key: 'labels', label: 'Labels', type: 'string' },
  { key: 'status', label: 'Status', type: 'string' },
] as const;

/** One row as the connector sees it (and the fake's dev controls show it). */
export interface SheetRow {
  rowId: string;
  rev: number;
  updatedAt: string;
  origin: string | null;
  values: Record<string, string>;
}

export interface Stamp {
  readonly id: string;
  readonly rev: number;
  readonly h: string;
  readonly o: string | null;
  readonly at: string;
  readonly k?: string;
}

export type Grid = readonly (readonly string[])[];

export const ROW_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_CELL = 1000;
const MAX_STAMP = 600;

/** A value as it goes into a cell (RAW: never parsed as a formula). */
export const cell = (v: unknown) => (v === null || v === undefined ? '' : String(v).slice(0, MAX_CELL));

/** 0 → A, 25 → Z, 26 → AA. */
export function colLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** The API path of a values range (the range percent-encoded as one path segment). */
export const valuesPath = (spreadsheetId: string, range: string, suffix = '') =>
  `/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}${suffix}`;

/** cyrb53: a fast 53-bit string hash (change detection, not security). */
function hash53(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The hash of a row's visible values (key order does not matter). */
export const hashValues = (values: Readonly<Record<string, string>>) =>
  hash53(
    JSON.stringify(
      Object.keys(values)
        .sort()
        .map((k) => [k, values[k] ?? '']),
    ),
  );

/** What a write's idempotency key leaves in the stamp (`k`). */
export const idempotencyHash = (key: string) => hash53(`k:${key}`);

export function parseStamp(text: string | undefined): Stamp | null {
  if (!text || text.length > MAX_STAMP || !text.startsWith('{')) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (typeof s.id !== 'string' || !ROW_ID.test(s.id)) return null;
  if (typeof s.rev !== 'number' || !Number.isInteger(s.rev) || s.rev < 1) return null;
  if (typeof s.h !== 'string' || typeof s.at !== 'string') return null;
  if (s.o !== null && typeof s.o !== 'string') return null;
  if (s.k !== undefined && typeof s.k !== 'string') return null;
  return {
    id: s.id,
    rev: s.rev,
    h: s.h,
    o: s.o,
    at: s.at,
    ...(typeof s.k === 'string' ? { k: s.k } : {}),
  };
}

/** Compact JSON, keys in a fixed order. */
export const serializeStamp = (s: Stamp) =>
  JSON.stringify({ id: s.id, rev: s.rev, h: s.h, o: s.o, at: s.at, ...(s.k ? { k: s.k } : {}) });

export interface Header {
  /** Visible columns we know, by their label. */
  readonly columns: readonly { readonly index: number; readonly key: string }[];
  /** The sync column's index; null when the header has none (it then goes after the header). */
  readonly sync: number | null;
  /** How many cells the header row has. */
  readonly width: number;
}

const norm = (s: string) => s.trim().toLowerCase();

export function parseHeader(row: readonly string[] | undefined): Header {
  const cells = row ?? [];
  const columns: { index: number; key: string }[] = [];
  let sync: number | null = null;
  cells.forEach((label, index) => {
    const l = norm(label ?? '');
    if (!l) return;
    if (l === norm(SYNC_LABEL)) {
      sync ??= index;
      return;
    }
    const col = SHEET_COLUMNS.find((c) => norm(c.label) === l);
    if (col && !columns.some((c) => c.key === col.key)) columns.push({ index, key: col.key });
  });
  return { columns, sync, width: cells.length };
}

/** Where the stamps go: the sync column, or the first column after the header. */
export const syncColumn = (h: Header) => h.sync ?? h.width;

export const rowValues = (h: Header, row: readonly string[] | undefined): Record<string, string> =>
  Object.fromEntries(h.columns.map((c) => [c.key, row?.[c.index] ?? '']));

export interface ParsedRow {
  /** 1-based row number in the sheet. */
  readonly rowNumber: number;
  readonly row: SheetRow;
  /** The row's own stamp as read (null: none, invalid, or a copy of another row's). */
  readonly stamp: Stamp | null;
  /** The stamp to write into the row's sync cell (new or edited by a person); null: none. */
  readonly writeBack: string | null;
}

export interface ParsedGrid {
  readonly header: Header;
  readonly rows: readonly ParsedRow[];
}

/**
 * Read a sheet's grid (header row first). `newId` names a row a person typed (or copied with
 * another row's stamp); `now` is when a person's row or edit is first seen.
 */
export function readGrid(grid: Grid, opts: { readonly now: Date; readonly newId: () => string }): ParsedGrid {
  const header = parseHeader(grid[0]);
  const at = opts.now.toISOString();
  const seen = new Set<string>();
  const rows: ParsedRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i] ?? [];
    const values = rowValues(header, cells);
    if (Object.values(values).every((v) => v.trim() === '')) continue;
    let stamp = parseStamp(cells[syncColumn(header)]);
    // A row copied with its hidden cell carries another row's id: it is a new row.
    if (stamp && seen.has(stamp.id)) stamp = null;
    const h = hashValues(values);
    let fresh: Stamp | null = null;
    if (!stamp) fresh = { id: opts.newId(), rev: 1, h, o: null, at };
    else if (stamp.h !== h) fresh = { id: stamp.id, rev: stamp.rev + 1, h, o: null, at };
    const s = fresh ?? (stamp as Stamp);
    seen.add(s.id);
    rows.push({
      rowNumber: i + 1,
      row: { rowId: s.id, rev: s.rev, updatedAt: s.at, origin: s.o, values },
      stamp,
      writeBack: fresh ? serializeStamp(fresh) : null,
    });
  }
  return { header, rows };
}

/** One row's cells: the old ones (if any) with `values` over the known columns and a new stamp. */
export function buildRow(
  header: Header,
  existing: readonly string[] | null,
  values: Readonly<Record<string, unknown>>,
  stamp: Omit<Stamp, 'h'>,
): string[] {
  const sync = syncColumn(header);
  const width = Math.max(header.width, sync + 1, existing?.length ?? 0);
  const cells = Array.from({ length: width }, (_, i) => existing?.[i] ?? '');
  for (const c of header.columns) if (c.key in values) cells[c.index] = cell(values[c.key]);
  cells[sync] = serializeStamp({ ...stamp, h: hashValues(rowValues(header, cells)) });
  return cells;
}

/** The A1 range of a whole row (`Attendees!A5:E5`). */
export const rowRange = (rowNumber: number, width: number) =>
  `${SHEET_TAB}!A${rowNumber}:${colLetter(Math.max(width, 1) - 1)}${rowNumber}`;

/** The A1 range of one cell (`Attendees!E5`). */
export const cellRange = (rowNumber: number, column: number) =>
  `${SHEET_TAB}!${colLetter(column)}${rowNumber}`;

export type WritePlan =
  | { readonly kind: 'none'; readonly rowId: string; readonly rev: number }
  | {
      readonly kind: 'update';
      readonly rowId: string;
      readonly rev: number;
      readonly range: string;
      readonly cells: string[];
    }
  | { readonly kind: 'append'; readonly rowId: string; readonly rev: number; readonly cells: string[] };

/**
 * What one push write does to the sheet: update the row `rowId` names if it is still there (or
 * nothing, when that row already holds this very write), else return the row an earlier attempt
 * of this write appended (same `k`), else append a new row.
 */
export function planWrite(
  grid: Grid,
  input: {
    readonly rowId: string | null;
    readonly values: Readonly<Record<string, unknown>>;
    /** `idempotencyHash` of the write's idempotency key. */
    readonly k: string;
    readonly origin: string;
    readonly now: Date;
    readonly newId: () => string;
  },
): { readonly plan: WritePlan; readonly header: Header } {
  const parsed = readGrid(grid, { now: input.now, newId: () => '' });
  const { header } = parsed;
  const at = input.now.toISOString();
  const target = input.rowId ? parsed.rows.find((p) => p.stamp?.id === input.rowId) : undefined;
  if (target) {
    const existing = grid[target.rowNumber - 1] ?? [];
    const draft = buildRow(header, existing, input.values, {
      id: target.row.rowId,
      rev: target.row.rev,
      o: input.origin,
      at,
      k: input.k,
    });
    const same = target.stamp?.k === input.k && target.writeBack === null;
    if (same && hashValues(rowValues(header, draft)) === target.stamp?.h)
      return { plan: { kind: 'none', rowId: target.row.rowId, rev: target.row.rev }, header };
    const rev = target.row.rev + 1;
    const cells = buildRow(header, existing, input.values, {
      id: target.row.rowId,
      rev,
      o: input.origin,
      at,
      k: input.k,
    });
    return {
      plan: {
        kind: 'update',
        rowId: target.row.rowId,
        rev,
        range: rowRange(target.rowNumber, cells.length),
        cells,
      },
      header,
    };
  }
  const retried = parsed.rows.find((p) => p.stamp?.k === input.k);
  if (retried?.stamp)
    return { plan: { kind: 'none', rowId: retried.stamp.id, rev: retried.row.rev }, header };
  const id = input.newId();
  const cells = buildRow(header, null, input.values, { id, rev: 1, o: input.origin, at, k: input.k });
  return { plan: { kind: 'append', rowId: id, rev: 1, cells }, header };
}
