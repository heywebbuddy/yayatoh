export interface ParsedCsv {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export type CsvErrorCode =
  | 'too_many_rows'
  | 'too_many_columns'
  | 'cell_too_long'
  | 'unterminated_quote'
  | 'empty'
  /** XLSX (M4.1b): not a readable workbook, the named sheet is missing, or it expands too far. */
  | 'not_a_spreadsheet'
  | 'sheet_not_found'
  | 'too_large';

// Plain fields, not parameter properties: Node runs this file with type stripping only.
export class CsvError extends Error {
  readonly code: CsvErrorCode;
  readonly line: number;
  constructor(code: CsvErrorCode, line: number) {
    super(`${code} at line ${line}`);
    this.name = 'CsvError';
    this.code = code;
    this.line = line;
  }
}

export interface ParseLimits {
  readonly maxRows: number;
  readonly maxColumns: number;
  readonly maxCell: number;
}

const DEFAULTS: ParseLimits = { maxRows: 20_000, maxColumns: 50, maxCell: 1_000 };

/** Comma, semicolon (European Excel) or tab: whichever appears most in the header line. */
function sniffDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  let best = ',';
  let bestCount = -1;
  for (const d of [',', ';', '\t']) {
    const n = firstLine.split(d).length - 1;
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

/**
 * RFC 4180 CSV (quoted fields, doubled quotes, CRLF or LF, a leading BOM), with the delimiter
 * sniffed from the header. Blank lines are skipped; short rows are padded to the header width.
 * Limits guard the server: rows, columns and cell length.
 */
export function parseCsv(input: string, limits: Partial<ParseLimits> = {}): ParsedCsv {
  const lim = { ...DEFAULTS, ...limits };
  const text = input.replace(/^﻿/, '');
  const delim = sniffDelimiter(text);
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let line = 1;
  const endField = () => {
    if (field.length > lim.maxCell) throw new CsvError('cell_too_long', line);
    record.push(field);
    field = '';
    if (record.length > lim.maxColumns) throw new CsvError('too_many_columns', line);
  };
  const endRecord = () => {
    endField();
    if (!(record.length === 1 && record[0] === '')) {
      records.push(record);
      if (records.length > lim.maxRows + 1) throw new CsvError('too_many_rows', line);
    }
    record = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (c === '\n') line++;
        field += c;
      }
    } else if (c === '"' && field === '') inQuotes = true;
    else if (c === delim) endField();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
    } else field += c;
  }
  if (inQuotes) throw new CsvError('unterminated_quote', line);
  if (field !== '' || record.length) endRecord();
  const [head, ...rows] = records;
  if (!head) throw new CsvError('empty', 1);
  const headers = head.map((h) => h.trim());
  return {
    headers,
    rows: rows.map((r) =>
      r.length < headers.length ? [...r, ...Array(headers.length - r.length).fill('')] : r,
    ),
  };
}
