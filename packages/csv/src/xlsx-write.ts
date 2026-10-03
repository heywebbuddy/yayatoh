import { strToU8, zipSync } from 'fflate';

/**
 * A minimal XLSX (Office Open XML workbook) writer for exports (M4.8g): one worksheet of plain
 * values. Strings are written as inline strings and numbers as numbers; there are never formulas,
 * so a value that looks like one (`=HYPERLINK(…)`) stays text when the file is opened. Characters
 * XML 1.0 cannot carry are dropped; cells are cut at Excel's 32,767-character limit.
 */
export type XlsxCell = string | number | null | undefined;

const CELL_MAX = 32_767;
// Control characters other than tab, line feed and carriage return are not allowed in XML 1.0.
// biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point.
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

const escapeXml = (s: string) =>
  s
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** `0 → A`, `25 → Z`, `26 → AA`. */
export function columnName(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function cellXml(value: XlsxCell, ref: string): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  const text = escapeXml(value.slice(0, CELL_MAX));
  const space = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}" t="inlineStr"><is><t${space}>${text}</t></is></c>`;
}

/** Sheet names: at most 31 characters, none of `[]:*?/\`. */
const sheetName = (name: string) =>
  escapeXml(
    name
      .replace(/[[\]:*?/\\]/g, ' ')
      .slice(0, 31)
      .trim() || 'Sheet1',
  );

export function writeXlsx(rows: readonly (readonly XlsxCell[])[], opts: { sheet?: string } = {}): Uint8Array {
  const body = rows
    .map((row, r) => {
      const cells = row.map((v, c) => cellXml(v, `${columnName(c)}${r + 1}`)).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const ns = 'http://schemas.openxmlformats.org';
  const files: Record<string, string> = {
    '[Content_Types].xml': `${xml}<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels': `${xml}<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${xml}<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets><sheet name="${sheetName(opts.sheet ?? 'Sheet1')}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${xml}<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `${xml}<worksheet xmlns="${ns}/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 });
}

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
