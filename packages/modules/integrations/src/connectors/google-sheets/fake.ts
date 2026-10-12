import type { FakeAccount, FakeProvider } from '../../auth/fake.ts';
import type { ProviderRequest, ProviderResponse } from '../../auth/port.ts';
import { cell, type Grid, readGrid, SHEET_TAB, type SheetRow, SYNC_LABEL } from './grid.ts';

export type { SheetRow } from './grid.ts';

/**
 * The fake Google Sheets API v4 (M6.4b) for dev and CI: the subset of the real endpoints the
 * connector calls, with Google's request and response shapes, over spreadsheets that are plain
 * 2-D grids of strings (one per tab). It knows nothing about the connector's row stamps.
 *
 * - `POST /v4/spreadsheets` `{ properties: { title }, sheets: [{ properties: { title,
 *   gridProperties } }] }` → `{ spreadsheetId, spreadsheetUrl, properties, sheets }` (the only call
 *   replayed per Idempotency-Key; the real API ignores the header, the connector does not rely on it)
 * - `GET /v4/spreadsheets/{id}/values/{range}` (`majorDimension=ROWS`) → `{ range, majorDimension,
 *   values? }`, trailing empty cells and rows left out, `values` absent when there are none
 * - `PUT /v4/spreadsheets/{id}/values/{range}` (`valueInputOption`) `{ range?, majorDimension?,
 *   values }` → `{ spreadsheetId, updatedRange, updatedRows, updatedColumns, updatedCells }`
 * - `POST /v4/spreadsheets/{id}/values/{range}:append` (`valueInputOption`, `insertDataOption`)
 *   `{ values }` → `{ spreadsheetId, tableRange, updates: { updatedRange, … } }`
 * - `POST /v4/spreadsheets/{id}:batchUpdate` `{ requests: [{ updateDimensionProperties }] }`
 *   → `{ spreadsheetId, replies }`
 *
 * Ranges are A1 notation, percent-encoded as one path segment; query parameters come in the
 * request's `query` (the port never puts a query string in a path). Anything else answers 404 (an
 * unknown spreadsheet or path) or 400 (a bad range, body or option), with Google's error shape.
 *
 * Dev controls play the organizer in the sheet: they edit visible cells, type rows in (without a
 * stamp) and delete rows, exactly as a person would; `sheetsRemoteRows` reads the rows the way the
 * connector would, without writing anything back.
 */

interface Tab {
  sheetId: number;
  title: string;
  grid: string[][];
  hiddenColumns: number[];
  frozenRowCount: number;
}

interface Spreadsheet {
  id: string;
  title: string;
  tabs: Tab[];
}

interface SheetsData {
  sheets: Spreadsheet[];
  keys: Record<string, unknown>;
}

const data = (a: FakeAccount) => a.data as SheetsData;

const error = (code: number, status: string, message: string): ProviderResponse => ({
  status: code,
  body: { error: { code, message, status } },
});
const notFound = () => error(404, 'NOT_FOUND', 'Requested entity was not found.');
const badRequest = (message: string) => error(400, 'INVALID_ARGUMENT', message);

const colIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
const colLetters = (index: number) => {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

interface Range {
  tab: Tab;
  c0: number;
  r0: number;
  /** Inclusive; null: unbounded. */
  c1: number | null;
  r1: number | null;
  /** A two-corner range (`A5:E5`, `A1:Z`), not a single cell, column, row or tab. */
  span: boolean;
}

/** `Title!A1:Z`, `'My title'!A5:E5`, `Title!E7`, `Title` (0-based indexes). */
function parseRange(s: Spreadsheet, a1: string): Range | null {
  const m = /^(?:'((?:[^']|'')+)'|([^!']+))(?:!([A-Z]{1,3})?(\d{1,7})?(:([A-Z]{1,3})?(\d{1,7})?)?)?$/.exec(
    a1,
  );
  if (!m) return null;
  const [, quoted, plain, sc, sr, colon, ec, er] = m;
  const title = quoted !== undefined ? quoted.replace(/''/g, "'") : (plain ?? '');
  const tab = s.tabs.find((t) => t.title === title);
  if (!tab) return null;
  const c0 = sc ? colIndex(sc) : 0;
  const r0 = sr ? Number(sr) - 1 : 0;
  const span = colon !== undefined;
  const c1 = span ? (ec ? colIndex(ec) : null) : sc ? c0 : null;
  const r1 = span ? (er ? Number(er) - 1 : null) : sr ? r0 : null;
  if (r0 < 0 || (c1 !== null && c1 < c0) || (r1 !== null && r1 < r0)) return null;
  return { tab, c0, r0, c1, r1, span };
}

const a1Of = (r: { tab: Tab; c0: number; r0: number }, rows: number, cols: number) =>
  `${r.tab.title}!${colLetters(r.c0)}${r.r0 + 1}:${colLetters(r.c0 + Math.max(cols, 1) - 1)}${r.r0 + Math.max(rows, 1)}`;

/** The cells a GET returns: trailing empty cells and rows left out. */
function readValues(r: Range): string[][] {
  const out: string[][] = [];
  const last = r.r1 === null ? r.tab.grid.length - 1 : Math.min(r.r1, r.tab.grid.length - 1);
  for (let i = r.r0; i <= last; i++) {
    const row = r.tab.grid[i] ?? [];
    const end = r.c1 === null ? row.length : Math.min(r.c1 + 1, row.length);
    const cells = row.slice(r.c0, Math.max(end, r.c0));
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    out.push(cells);
  }
  while (out.length && out[out.length - 1]?.length === 0) out.pop();
  return out;
}

/** Validates a `values` body: rows of cells (strings, numbers, booleans; null leaves a cell as is). */
function valuesOf(body: unknown): (string | null)[][] | null {
  const v = (body as { values?: unknown } | null)?.values;
  if (!Array.isArray(v)) return null;
  const rows: (string | null)[][] = [];
  for (const row of v) {
    if (!Array.isArray(row)) return null;
    const cells: (string | null)[] = [];
    for (const c of row) {
      if (c === null || c === undefined) cells.push(null);
      else if (typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean')
        cells.push(String(c).slice(0, 50_000));
      else return null;
    }
    rows.push(cells);
  }
  return rows;
}

/** The tab's row at `index` (0-based), created (with any rows above it) when missing. */
function gridRow(tab: Tab, index: number): string[] {
  for (let i = 0; i <= index; i++) tab.grid[i] ??= [];
  return tab.grid[index] as string[];
}

function writeValues(tab: Tab, r0: number, c0: number, values: (string | null)[][]) {
  values.forEach((row, i) => {
    const target = gridRow(tab, r0 + i);
    row.forEach((v, j) => {
      if (v === null) return;
      while (target.length < c0 + j) target.push('');
      target[c0 + j] = v;
    });
  });
  for (let i = 0; i < tab.grid.length; i++) tab.grid[i] ??= [];
}

const lastRow = (tab: Tab) => {
  for (let i = tab.grid.length - 1; i >= 0; i--) if ((tab.grid[i] ?? []).some((c) => c !== '')) return i;
  return -1;
};

const updated = (s: Spreadsheet, r: { tab: Tab; c0: number; r0: number }, values: (string | null)[][]) => {
  const cols = Math.max(0, ...values.map((row) => row.length));
  return {
    spreadsheetId: s.id,
    updatedRange: a1Of(r, values.length, cols),
    updatedRows: values.length,
    updatedColumns: cols,
    updatedCells: values.reduce((n, row) => n + row.length, 0),
  };
};

const VALUE_INPUT = new Set(['RAW', 'USER_ENTERED']);

function createSpreadsheet(d: SheetsData, body: unknown): ProviderResponse {
  const b = (body ?? {}) as {
    properties?: { title?: unknown };
    sheets?: { properties?: { title?: unknown; gridProperties?: { frozenRowCount?: unknown } } }[];
  };
  if (b.sheets !== undefined && !Array.isArray(b.sheets)) return badRequest('Invalid sheets');
  const id = `fakesheet_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const specs = b.sheets?.length ? b.sheets : [{ properties: { title: 'Sheet1' } }];
  const tabs: Tab[] = [];
  for (const [i, spec] of specs.entries()) {
    const title = cell(spec?.properties?.title).slice(0, 100) || `Sheet${i + 1}`;
    if (tabs.some((t) => t.title === title))
      return badRequest(`A sheet with the name "${title}" already exists.`);
    const frozen = spec?.properties?.gridProperties?.frozenRowCount;
    tabs.push({
      sheetId: i === 0 ? 0 : 1_000_000 + i,
      title,
      grid: [],
      hiddenColumns: [],
      frozenRowCount: typeof frozen === 'number' && Number.isInteger(frozen) && frozen >= 0 ? frozen : 0,
    });
  }
  const s: Spreadsheet = {
    id,
    title: cell(b.properties?.title).slice(0, 200) || 'Untitled spreadsheet',
    tabs,
  };
  d.sheets.push(s);
  return {
    status: 200,
    body: {
      spreadsheetId: id,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`,
      properties: { title: s.title },
      sheets: tabs.map((t, index) => ({
        properties: {
          sheetId: t.sheetId,
          title: t.title,
          index,
          sheetType: 'GRID',
          gridProperties: { rowCount: 1000, columnCount: 26, frozenRowCount: t.frozenRowCount },
        },
      })),
    },
  };
}

function batchUpdate(s: Spreadsheet, body: unknown): ProviderResponse {
  const requests = (body as { requests?: unknown } | null)?.requests;
  if (!Array.isArray(requests) || requests.length === 0)
    return badRequest('Must specify at least one request.');
  const apply: (() => void)[] = [];
  for (const req of requests) {
    const u = (req as { updateDimensionProperties?: unknown } | null)?.updateDimensionProperties as
      | {
          range?: { sheetId?: unknown; dimension?: unknown; startIndex?: unknown; endIndex?: unknown };
          properties?: { hiddenByUser?: unknown };
          fields?: unknown;
        }
      | undefined;
    if (!u) return badRequest('Unsupported request');
    const tab = s.tabs.find((t) => t.sheetId === u.range?.sheetId);
    if (!tab) return badRequest(`No grid with id: ${String(u.range?.sheetId)}`);
    const start = u.range?.startIndex;
    const end = u.range?.endIndex;
    if (
      u.range?.dimension !== 'COLUMNS' ||
      typeof start !== 'number' ||
      typeof end !== 'number' ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      u.fields !== 'hiddenByUser' ||
      typeof u.properties?.hiddenByUser !== 'boolean'
    )
      return badRequest('Invalid updateDimensionProperties request');
    const hidden = u.properties.hiddenByUser;
    apply.push(() => {
      for (let c = start; c < end; c++) {
        tab.hiddenColumns = tab.hiddenColumns.filter((x) => x !== c);
        if (hidden) tab.hiddenColumns.push(c);
      }
    });
  }
  for (const f of apply) f();
  return { status: 200, body: { spreadsheetId: s.id, replies: requests.map(() => ({})) } };
}

export const googleSheetsFakeProvider: FakeProvider = {
  accountLabel: 'organizer@sheets-sandbox.test (sandbox)',
  seed: (): SheetsData => ({ sheets: [], keys: {} }),
  handle(account, req: ProviderRequest): ProviderResponse {
    const d = data(account);
    const query = req.query ?? {};
    if (req.path === '/v4/spreadsheets') {
      if (req.method !== 'POST') return error(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
      if (req.idempotencyKey && req.idempotencyKey in d.keys)
        return { status: 200, body: d.keys[req.idempotencyKey] };
      const res = createSpreadsheet(d, req.body);
      if (req.idempotencyKey && res.status === 200) d.keys[req.idempotencyKey] = res.body;
      return res;
    }
    const batch = /^\/v4\/spreadsheets\/([A-Za-z0-9_-]+):batchUpdate$/.exec(req.path);
    if (batch) {
      const s = d.sheets.find((x) => x.id === batch[1]);
      if (!s) return notFound();
      if (req.method !== 'POST') return error(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
      return batchUpdate(s, req.body);
    }
    const m = /^\/v4\/spreadsheets\/([A-Za-z0-9_-]+)\/values\/([^/]+?)(:append)?$/.exec(req.path);
    const s = m ? d.sheets.find((x) => x.id === m[1]) : undefined;
    if (!m || !s) return notFound();
    let a1: string;
    try {
      a1 = decodeURIComponent(m[2] ?? '');
    } catch {
      return badRequest('Unable to parse range');
    }
    const range = parseRange(s, a1);
    if (!range) return badRequest(`Unable to parse range: ${a1}`);
    if (m[3]) {
      if (req.method !== 'POST') return error(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
      if (!VALUE_INPUT.has(query.valueInputOption ?? '')) return badRequest('Invalid valueInputOption');
      const insert = query.insertDataOption ?? 'OVERWRITE';
      if (insert !== 'OVERWRITE' && insert !== 'INSERT_ROWS') return badRequest('Invalid insertDataOption');
      const values = valuesOf(req.body);
      if (!values) return badRequest('Invalid values');
      const tableEnd = lastRow(range.tab);
      const at = { tab: range.tab, c0: range.c0, r0: Math.max(tableEnd + 1, range.r0) };
      if (insert === 'INSERT_ROWS') range.tab.grid.splice(at.r0, 0, ...values.map(() => []));
      writeValues(range.tab, at.r0, at.c0, values);
      const width = Math.max(1, ...range.tab.grid.slice(0, tableEnd + 1).map((r) => r.length));
      return {
        status: 200,
        body: {
          spreadsheetId: s.id,
          ...(tableEnd >= 0
            ? { tableRange: a1Of({ tab: range.tab, c0: 0, r0: 0 }, tableEnd + 1, width) }
            : {}),
          updates: updated(s, at, values),
        },
      };
    }
    if (req.method === 'GET') {
      const dim = query.majorDimension ?? 'ROWS';
      if (dim !== 'ROWS') return badRequest('Only ROWS is supported here');
      const values = readValues(range);
      return {
        status: 200,
        body: {
          range: a1Of(range, Math.max(values.length, 1), Math.max(1, ...values.map((r) => r.length))),
          majorDimension: 'ROWS',
          ...(values.length ? { values } : {}),
        },
      };
    }
    if (req.method === 'PUT') {
      if (!VALUE_INPUT.has(query.valueInputOption ?? '')) return badRequest('Invalid valueInputOption');
      const body = (req.body ?? {}) as { range?: unknown; majorDimension?: unknown };
      if (body.range !== undefined && body.range !== a1)
        return badRequest(
          `Requested writing within range [${a1}], but tried writing to [${String(body.range)}]`,
        );
      if (body.majorDimension !== undefined && body.majorDimension !== 'ROWS')
        return badRequest('Only ROWS is supported here');
      const values = valuesOf(req.body);
      if (!values) return badRequest('Invalid values');
      // A bounded range must hold the data; a single cell is only where the data starts.
      const rows = values.length;
      const cols = Math.max(0, ...values.map((r) => r.length));
      if (
        range.span &&
        ((range.r1 !== null && range.r0 + rows - 1 > range.r1) ||
          (range.c1 !== null && range.c0 + cols - 1 > range.c1))
      )
        return badRequest(`Requested writing within range [${a1}], but tried writing beyond it`);
      writeValues(range.tab, range.r0, range.c0, values);
      return { status: 200, body: updated(s, range, values) };
    }
    return error(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  },
};

function spreadsheet(a: FakeAccount, spreadsheetId: string): Spreadsheet | null {
  return (data(a).sheets ?? []).find((s) => s.id === spreadsheetId) ?? null;
}

/** The attendee tab (the one the connector writes), or the first one. */
function attendeeTab(a: FakeAccount, spreadsheetId: string): Tab | null {
  const s = spreadsheet(a, spreadsheetId);
  return s?.tabs.find((t) => t.title === SHEET_TAB) ?? s?.tabs[0] ?? null;
}

/**
 * The tab's rows the way the connector reads them, but read only: nothing is written back, and a
 * row without a stamp of its own (typed in by a person, not synced yet) is named after its row
 * number (`n7`), so it has the same id on every read until the connector stamps it.
 */
function rowsOf(tab: Tab) {
  const { header, rows } = readGrid(tab.grid as Grid, { now: new Date(), newId: () => '' });
  return {
    header,
    rows: rows.map((p) => ({
      rowNumber: p.rowNumber,
      row: { ...p.row, rowId: p.stamp?.id ?? `n${p.rowNumber}` } as SheetRow,
    })),
  };
}

const rowAt = (tab: Tab, rowNumber: number) =>
  rowsOf(tab).rows.find((r) => r.rowNumber === rowNumber)?.row ?? null;

/** Dev control and tests: the sheet's rows as the organizer sees them (read only). */
export function sheetsRemoteRows(a: FakeAccount, spreadsheetId: string): SheetRow[] {
  const tab = attendeeTab(a, spreadsheetId);
  return tab ? rowsOf(tab).rows.map((r) => r.row) : [];
}

/** Dev control and tests: the account's spreadsheets (ids, titles and visible header labels). */
export function sheetsRemoteList(a: FakeAccount): { id: string; title: string; headers: string[] }[] {
  return (data(a).sheets ?? []).map((s) => {
    const tab = s.tabs.find((t) => t.title === SHEET_TAB) ?? s.tabs[0];
    return {
      id: s.id,
      title: s.title,
      headers: (tab?.grid[0] ?? []).filter(
        (label, i) => label !== '' && label !== SYNC_LABEL && !tab?.hiddenColumns.includes(i),
      ),
    };
  });
}

/** The organizer edits visible cells of a row (the hidden stamp stays as it was). */
export function sheetsRemoteEdit(
  a: FakeAccount,
  spreadsheetId: string,
  rowId: string,
  values: Record<string, string>,
): SheetRow | null {
  const tab = attendeeTab(a, spreadsheetId);
  if (!tab) return null;
  const { header, rows } = rowsOf(tab);
  const found = rows.find((r) => r.row.rowId === rowId);
  if (!found) return null;
  const cells = gridRow(tab, found.rowNumber - 1);
  for (const c of header.columns)
    if (c.key in values) {
      while (cells.length <= c.index) cells.push('');
      cells[c.index] = cell(values[c.key]);
    }
  return rowAt(tab, found.rowNumber);
}

/** The organizer types a new row below the last one (no stamp: a person did it). */
export function sheetsRemoteAdd(
  a: FakeAccount,
  spreadsheetId: string,
  values: Record<string, string>,
): SheetRow | null {
  const tab = attendeeTab(a, spreadsheetId);
  if (!tab) return null;
  const cells: string[] = [];
  for (const c of rowsOf(tab).header.columns) {
    while (cells.length <= c.index) cells.push('');
    cells[c.index] = cell(values[c.key]);
  }
  const at = lastRow(tab) + 1;
  tab.grid.splice(at, 0, cells);
  return rowAt(tab, at + 1);
}

/** The organizer deletes a row from the sheet (the rows below move up). */
export function sheetsRemoteDelete(a: FakeAccount, spreadsheetId: string, rowId: string): boolean {
  const tab = attendeeTab(a, spreadsheetId);
  const found = tab ? rowsOf(tab).rows.find((r) => r.row.rowId === rowId) : undefined;
  if (!tab || !found) return false;
  tab.grid.splice(found.rowNumber - 1, 1);
  return true;
}
