import type { FakeAccount, FakeProvider } from '../../auth/fake.ts';
import type { ProviderRequest, ProviderResponse } from '../../auth/port.ts';

/**
 * The fake Google Sheets API (M6.4b) for dev and CI. It models what the connector needs from
 * Sheets: spreadsheets created by the app (`drive.file` scope), a header row of columns, and rows
 * that keep a stable row id (developer metadata on the real API), a revision, the time of their
 * last edit (the real adapter reads it from the row's "Last updated" cell, kept by an installable
 * onEdit trigger) and the origin stamp of the last writer (a hidden column).
 *
 * - `POST /v4/spreadsheets` `{ properties: { title }, headers: [{ key, label }] }` (Idempotency-Key)
 *   → `{ spreadsheetId, spreadsheetUrl }`
 * - `GET /v4/spreadsheets/{id}/rows` → `{ headers, rows: [{ rowId, rev, updatedAt, origin, values }] }`
 * - `POST /v4/spreadsheets/{id}/rows` and `PATCH /v4/spreadsheets/{id}/rows/{rowId}`
 *   `{ values, origin }` (Idempotency-Key) → `{ rowId, rev }`
 *
 * Dev controls play the organizer editing the sheet: edit, add and delete rows.
 */

export interface SheetRow {
  rowId: string;
  rev: number;
  updatedAt: string;
  origin: string | null;
  values: Record<string, string>;
}

interface Spreadsheet {
  id: string;
  title: string;
  headers: { key: string; label: string }[];
  rows: SheetRow[];
  nextRow: number;
}

interface SheetsData {
  sheets: Spreadsheet[];
  keys: Record<string, unknown>;
}

const data = (a: FakeAccount) => a.data as SheetsData;

const cell = (v: unknown) => (v === null || v === undefined ? '' : String(v).slice(0, 1000));

function writeRow(
  s: Spreadsheet,
  row: SheetRow | null,
  values: unknown,
  origin: unknown,
  now: Date,
): SheetRow {
  const clean: Record<string, string> = {};
  for (const h of s.headers)
    if (values && typeof values === 'object' && h.key in values)
      clean[h.key] = cell((values as Record<string, unknown>)[h.key]);
  const r: SheetRow = row ?? { rowId: `r${s.nextRow++}`, rev: 0, updatedAt: '', origin: null, values: {} };
  r.values = { ...r.values, ...clean };
  r.rev += 1;
  r.updatedAt = now.toISOString();
  r.origin = typeof origin === 'string' ? origin.slice(0, 200) : null;
  if (!row) s.rows.push(r);
  return r;
}

export const googleSheetsFakeProvider: FakeProvider = {
  accountLabel: 'organizer@sheets-sandbox.test (sandbox)',
  seed: (): SheetsData => ({ sheets: [], keys: {} }),
  handle(account, req: ProviderRequest): ProviderResponse {
    const d = data(account);
    const remember = (body: unknown, status = 200): ProviderResponse => {
      if (req.idempotencyKey) d.keys[req.idempotencyKey] = body;
      return { status, body };
    };
    if (req.idempotencyKey && req.idempotencyKey in d.keys && req.method !== 'GET')
      return { status: 200, body: d.keys[req.idempotencyKey] };
    if (req.path === '/v4/spreadsheets' && req.method === 'POST') {
      const body = (req.body ?? {}) as { properties?: { title?: unknown }; headers?: unknown };
      const headers = Array.isArray(body.headers)
        ? body.headers
            .filter(
              (h): h is { key: string; label: string } =>
                typeof h?.key === 'string' && typeof h?.label === 'string',
            )
            .slice(0, 50)
        : [];
      const id = `fakesheet_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
      d.sheets.push({
        id,
        title: cell(body.properties?.title).slice(0, 200) || 'Untitled spreadsheet',
        headers,
        rows: [],
        nextRow: 1,
      });
      return remember(
        { spreadsheetId: id, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit` },
        201,
      );
    }
    const m = /^\/v4\/spreadsheets\/([A-Za-z0-9_-]+)\/rows(?:\/([A-Za-z0-9_-]+))?$/.exec(req.path);
    const s = m ? d.sheets.find((x) => x.id === m[1]) : undefined;
    if (!m || !s) return { status: 404, body: { error: { code: 404, status: 'NOT_FOUND' } } };
    const rowId = m[2];
    const now = new Date();
    if (req.method === 'GET' && !rowId)
      return { status: 200, body: { headers: s.headers, rows: structuredClone(s.rows) } };
    const body = (req.body ?? {}) as { values?: unknown; origin?: unknown };
    if (req.method === 'POST' && !rowId) {
      const r = writeRow(s, null, body.values, body.origin, now);
      return remember({ rowId: r.rowId, rev: r.rev }, 201);
    }
    if (req.method === 'PATCH' && rowId) {
      const row = s.rows.find((x) => x.rowId === rowId);
      if (!row) return { status: 404, body: { error: { code: 404, status: 'NOT_FOUND' } } };
      const r = writeRow(s, row, body.values, body.origin, now);
      return remember({ rowId: r.rowId, rev: r.rev });
    }
    return { status: 405, body: { error: { code: 405 } } };
  },
};

function sheet(a: FakeAccount, spreadsheetId: string): Spreadsheet | null {
  return (data(a).sheets ?? []).find((s) => s.id === spreadsheetId) ?? null;
}

/** Dev control and tests: the sheet's rows as the organizer sees them. */
export function sheetsRemoteRows(a: FakeAccount, spreadsheetId: string): SheetRow[] {
  return structuredClone(sheet(a, spreadsheetId)?.rows ?? []);
}

/** Dev control and tests: the account's spreadsheets (ids and titles). */
export function sheetsRemoteList(a: FakeAccount): { id: string; title: string; headers: string[] }[] {
  return (data(a).sheets ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    headers: s.headers.map((h) => h.label),
  }));
}

/** The organizer edits cells of a row in the sheet (no origin stamp: a person did it). */
export function sheetsRemoteEdit(
  a: FakeAccount,
  spreadsheetId: string,
  rowId: string,
  values: Record<string, string>,
  now = new Date(),
): SheetRow | null {
  const s = sheet(a, spreadsheetId);
  const row = s?.rows.find((r) => r.rowId === rowId);
  return s && row ? writeRow(s, row, values, null, now) : null;
}

/** The organizer types a new row into the sheet. */
export function sheetsRemoteAdd(
  a: FakeAccount,
  spreadsheetId: string,
  values: Record<string, string>,
  now = new Date(),
): SheetRow | null {
  const s = sheet(a, spreadsheetId);
  return s ? writeRow(s, null, values, null, now) : null;
}

/** The organizer deletes a row from the sheet. */
export function sheetsRemoteDelete(a: FakeAccount, spreadsheetId: string, rowId: string): boolean {
  const s = sheet(a, spreadsheetId);
  if (!s) return false;
  const before = s.rows.length;
  s.rows = s.rows.filter((r) => r.rowId !== rowId);
  return s.rows.length < before;
}
