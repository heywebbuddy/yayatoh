import { strToU8, zipSync } from 'fflate';

/**
 * A minimal XLSX (Office Open XML workbook) writer for exports (M4.3b): one or more sheets of text
 * and numbers, the first row bold and frozen, columns sized to their content. Text is written as
 * inline strings, which spreadsheet apps never evaluate, so a value starting with `=` stays text
 * (no formula injection, unlike CSV). Characters XML can't hold are dropped.
 */
export interface XlsxSheet {
  readonly name: string;
  readonly rows: readonly (readonly (string | number | null | undefined)[])[];
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

// biome-ignore lint/suspicious/noControlCharactersInRegex: removing the control characters XML 1.0 forbids
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

const esc = (v: string) =>
  v.replace(INVALID_XML, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** Column letters: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let s = '';
  for (let i = index + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

/** A sheet name Excel accepts: no `[]:*?/\`, at most 31 characters, unique in the book. */
function sheetNames(sheets: readonly XlsxSheet[]): string[] {
  const seen = new Set<string>();
  return sheets.map((s, i) => {
    let base = s.name.replace(/[[\]:*?/\\]/g, ' ').replace(INVALID_XML, '').trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base;
    for (let k = 2; seen.has(name.toLowerCase()); k++) {
      base = base.slice(0, 31 - String(k).length - 1);
      name = `${base} ${k}`;
    }
    seen.add(name.toLowerCase());
    return name;
  });
}

function cell(ref: string, v: string | number | null | undefined, style: number): string {
  const s = style ? ` s="${style}"` : '';
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const widths: number[] = [];
  for (const row of sheet.rows)
    row.forEach((v, i) => {
      widths[i] = Math.max(widths[i] ?? 0, String(v ?? '').length);
    });
  const cols = widths.length
    ? `<cols>${widths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(8, w + 2))}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';
  const rows = sheet.rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row.map((v, c) => cell(`${columnName(c)}${r + 1}`, v, r === 0 ? 1 : 0)).join('')}</row>`,
    )
    .join('');
  const freeze =
    sheet.rows.length > 1
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '';
  return `${XML_HEAD}<worksheet xmlns="${NS_MAIN}">${freeze}${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

const STYLES = `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;

/** The workbook as the bytes of an .xlsx file. */
export function writeXlsx(sheets: readonly XlsxSheet[]): Uint8Array {
  if (!sheets.length) throw new Error('writeXlsx: a workbook needs at least one sheet');
  const names = sheetNames(sheets);
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('')}</Types>`,
    ),
    '_rels/.rels': strToU8(
      `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>${names
        .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">${names
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('')}<Relationship Id="rId${names.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(STYLES),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });
  // A fixed timestamp: the same rows always give the same bytes.
  return zipSync(files, { mtime: new Date('2000-01-01T00:00:00Z') });
}

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
