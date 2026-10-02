import { unzipSync } from 'fflate';
import { CsvError, type ParsedCsv, type ParseLimits } from './parse.ts';

/**
 * A minimal, read-only XLSX (Office Open XML workbook) reader for imports (M4.1b). It reads cell
 * values only: shared strings, inline strings, numbers, booleans and the cached value of a
 * formula cell. Formulas are never evaluated and nothing else in the package is opened (macros,
 * external links, embedded objects and styles are ignored).
 *
 * Guards: the zip is read through its central directory and each part is inflated into a buffer
 * of its declared size, so a part can never grow past `maxPartBytes`; the declared sizes of
 * the parts we read are capped together (`maxExpandedBytes`) and so is the number of entries.
 * Rows, columns and cell length use the CSV limits.
 */
export interface XlsxLimits extends ParseLimits {
  readonly maxEntries: number;
  readonly maxPartBytes: number;
  readonly maxExpandedBytes: number;
}

export interface ParsedXlsx extends ParsedCsv {
  /** Every worksheet's name, in workbook order. */
  readonly sheets: readonly string[];
  /** The sheet that was read. */
  readonly sheet: string;
}

const DEFAULTS: XlsxLimits = {
  maxRows: 20_000,
  maxColumns: 50,
  maxCell: 1_000,
  maxEntries: 2_000,
  maxPartBytes: 60_000_000,
  maxExpandedBytes: 100_000_000,
};

/* ------------------------------------------------------------------------ tiny XML scanner ---- */

const ENTITY: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return ENTITY[e] ?? m;
  });
}

/** Excel escapes control characters in strings as `_xHHHH_` (and a literal `_x` as `_x005F_`). */
const unescapeOoxml = (s: string) =>
  s.replace(/_x([0-9A-Fa-f]{4})_/g, (_m, h: string) => String.fromCharCode(Number.parseInt(h, 16)));

type Attrs = Record<string, string>;
type Token =
  | { kind: 'open'; name: string; attrs: Attrs; selfClosing: boolean }
  | { kind: 'close'; name: string }
  | { kind: 'text'; text: string };

const TAG =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][\s\S]*?>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([^\s=>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Local name (namespace prefix dropped): `x:row` → `row`. */
const local = (name: string) => name.slice(name.indexOf(':') + 1);

function* tokens(xml: string): Generator<Token> {
  TAG.lastIndex = 0;
  for (let m = TAG.exec(xml); m; m = TAG.exec(xml)) {
    if (m[1] !== undefined) yield { kind: 'text', text: m[1] };
    else if (m[3] !== undefined) {
      if (m[2]) yield { kind: 'close', name: local(m[3]) };
      else {
        const attrs: Attrs = {};
        ATTR.lastIndex = 0;
        for (let a = ATTR.exec(m[4] ?? ''); a; a = ATTR.exec(m[4] ?? ''))
          attrs[local(a[1] as string)] = unescapeXml(a[2] ?? a[3] ?? '');
        yield { kind: 'open', name: local(m[3]), attrs, selfClosing: m[5] === '/' };
      }
    } else if (m[6] !== undefined) yield { kind: 'text', text: unescapeXml(m[6]) };
  }
}

/* --------------------------------------------------------------------------------- reader ---- */

const bad = (): never => {
  throw new CsvError('not_a_spreadsheet', 1);
};

/** `B12` → column 1 (0-based); letters only. */
function columnOf(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  let cur: string[] | null = null;
  // Phonetic runs (<rPh>, Japanese furigana) are not part of the value.
  let inPhonetic = 0;
  let inText = false;
  for (const t of tokens(xml)) {
    if (t.kind === 'open') {
      if (t.name === 'si') {
        cur = [];
        if (t.selfClosing) {
          out.push('');
          cur = null;
        }
      } else if (t.name === 'rPh' && !t.selfClosing) inPhonetic++;
      else if (t.name === 't' && !t.selfClosing) inText = true;
    } else if (t.kind === 'close') {
      if (t.name === 'si' && cur) {
        out.push(unescapeOoxml(cur.join('')));
        cur = null;
      } else if (t.name === 'rPh') inPhonetic = Math.max(0, inPhonetic - 1);
      else if (t.name === 't') inText = false;
    } else if (cur && inText && !inPhonetic) cur.push(t.text);
  }
  return out;
}

function resolveTarget(target: string): string {
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const parts: string[] = [];
  for (const p of path.split('/')) {
    if (p === '..') parts.pop();
    else if (p && p !== '.') parts.push(p);
  }
  return parts.join('/');
}

/** Worksheets in workbook order, with the zip path of each. */
function worksheets(workbook: string, rels: string): { name: string; path: string }[] {
  const targets = new Map<string, string>();
  for (const t of tokens(rels))
    if (t.kind === 'open' && t.name === 'Relationship' && /\/worksheet$/.test(t.attrs.Type ?? ''))
      targets.set(t.attrs.Id ?? '', resolveTarget(t.attrs.Target ?? ''));
  const out: { name: string; path: string }[] = [];
  for (const t of tokens(workbook))
    if (t.kind === 'open' && t.name === 'sheet') {
      const path = targets.get(t.attrs.id ?? '');
      if (path) out.push({ name: t.attrs.name ?? '', path });
    }
  return out;
}

function numberText(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  // Binary floats: 0.1 + 0.2 is stored as 0.30000000000000004; show what the sheet shows.
  return String(Number(n.toPrecision(15)));
}

function readSheet(xml: string, shared: readonly string[], lim: XlsxLimits): string[][] {
  const rows: string[][] = [];
  let row: string[] | null = null;
  let rowNo = 0;
  let col = -1;
  let cell: {
    col: number;
    type: string;
    value: string[];
    inline: string[];
    inV: boolean;
    inIs: number;
  } | null = null;
  let inT = false;
  const put = (c: NonNullable<typeof cell>) => {
    let v: string;
    if (c.type === 's') v = shared[Number.parseInt(c.value.join(''), 10)] ?? '';
    else if (c.type === 'inlineStr') v = unescapeOoxml(c.inline.join(''));
    else if (c.type === 'b') v = c.value.join('') === '1' ? 'TRUE' : 'FALSE';
    else if (c.type === 'str' || c.type === 'e') v = unescapeOoxml(c.value.join(''));
    else v = numberText(c.value.join(''));
    if (v === '' || !row) return;
    if (c.col >= lim.maxColumns) throw new CsvError('too_many_columns', rowNo);
    if (v.length > lim.maxCell) throw new CsvError('cell_too_long', rowNo);
    while (row.length < c.col) row.push('');
    row[c.col] = v;
  };
  for (const t of tokens(xml)) {
    if (t.kind === 'open') {
      if (t.name === 'row') {
        rowNo = t.attrs.r ? Number.parseInt(t.attrs.r, 10) : rowNo + 1;
        row = [];
        col = -1;
        if (t.selfClosing) row = null;
      } else if (t.name === 'c' && row) {
        col = t.attrs.r ? columnOf(t.attrs.r) : col + 1;
        if (col < 0) bad();
        cell = { col, type: t.attrs.t ?? 'n', value: [], inline: [], inV: false, inIs: 0 };
        if (t.selfClosing) cell = null;
      } else if (cell && !t.selfClosing) {
        if (t.name === 'v') cell.inV = true;
        else if (t.name === 'is') cell.inIs++;
        else if (t.name === 't' && cell.inIs) inT = true;
      }
    } else if (t.kind === 'close') {
      if (t.name === 'row' && row) {
        if (row.some((v) => v.trim() !== '')) {
          rows.push(row);
          if (rows.length > lim.maxRows + 1) throw new CsvError('too_many_rows', rowNo);
        }
        row = null;
      } else if (t.name === 'c' && cell) {
        put(cell);
        cell = null;
      } else if (cell) {
        if (t.name === 'v') cell.inV = false;
        else if (t.name === 'is') cell.inIs--;
        else if (t.name === 't') inT = false;
      }
    } else if (cell) {
      if (cell.inV) cell.value.push(t.text);
      else if (cell.inIs && inT) cell.inline.push(t.text);
    }
  }
  return rows;
}

const utf8 = (b: Uint8Array | undefined) => (b ? new TextDecoder('utf-8').decode(b) : undefined);

/**
 * Read one worksheet (the first, or the one named `sheet`) of an XLSX file: the first non-blank
 * row is the header, blank rows are skipped, short rows are padded to the header width.
 */
export function parseXlsx(
  bytes: Uint8Array,
  opts: { sheet?: string | null; limits?: Partial<XlsxLimits> } = {},
): ParsedXlsx {
  const lim = { ...DEFAULTS, ...opts.limits };
  // A zip starts with a local file header ("PK\3\4").
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) bad();
  const wanted = (name: string) =>
    name === 'xl/workbook.xml' ||
    name === 'xl/_rels/workbook.xml.rels' ||
    name === 'xl/sharedStrings.xml' ||
    /^xl\/worksheets\/[^/]+\.xml$/.test(name);
  let entries = 0;
  let expanded = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        entries++;
        if (entries > lim.maxEntries) throw new CsvError('too_large', 1);
        if (!wanted(f.name)) return false;
        expanded += f.originalSize;
        if (f.originalSize > lim.maxPartBytes || expanded > lim.maxExpandedBytes)
          throw new CsvError('too_large', 1);
        return true;
      },
    });
  } catch (err) {
    if (err instanceof CsvError) throw err;
    return bad();
  }
  const workbook = utf8(files['xl/workbook.xml']);
  const rels = utf8(files['xl/_rels/workbook.xml.rels']);
  if (!workbook || !rels) return bad();
  const sheets = worksheets(workbook, rels);
  if (sheets.length === 0) return bad();
  const chosen = opts.sheet?.trim()
    ? sheets.find((s) => s.name.trim().toLocaleLowerCase() === opts.sheet?.trim().toLocaleLowerCase())
    : sheets[0];
  if (!chosen) throw new CsvError('sheet_not_found', 1);
  const xml = utf8(files[chosen.path]);
  if (xml === undefined) return bad();
  const all = readSheet(xml, sharedStrings(utf8(files['xl/sharedStrings.xml'])), lim);
  const [head, ...rest] = all;
  if (!head) throw new CsvError('empty', 1);
  const width = Math.max(head.length, ...rest.map((r) => r.length));
  const pad = (r: string[]) => (r.length < width ? [...r, ...Array(width - r.length).fill('')] : r);
  return {
    sheets: sheets.map((s) => s.name),
    sheet: chosen.name,
    headers: pad(head).map((h) => h.trim()),
    rows: rest.map(pad),
  };
}
