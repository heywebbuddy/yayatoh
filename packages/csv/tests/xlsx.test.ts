import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { CsvError, decodeText, parseXlsx } from '../src/index.ts';

const WB = (sheets: string[]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
    .map((s, i) => `<sheet name="${s}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')}</sheets></workbook>`;
const RELS = (n: number) =>
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Array.from(
    { length: n },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join(
    '',
  )}<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
const SHEET = (rows: string) =>
  `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;

function book(sheets: Record<string, string>, shared?: string, extra: Record<string, Uint8Array> = {}) {
  const names = Object.keys(sheets);
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/workbook.xml': strToU8(WB(names)),
    'xl/_rels/workbook.xml.rels': strToU8(RELS(names.length)),
    ...extra,
  };
  names.forEach((n, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(SHEET(sheets[n] as string));
  });
  if (shared) files['xl/sharedStrings.xml'] = strToU8(`<sst>${shared}</sst>`);
  return zipSync(files);
}

describe('parseXlsx (M4.1b)', () => {
  it('reads shared, rich, inline, numeric, boolean and cached formula values; skips blank rows', () => {
    const x = book(
      {
        Guests: `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Age</t></is></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>34</v></c><c r="D2" t="b"><v>1</v></c></row>
<row r="3"/>
<row r="5"><c r="A5" t="str"><f>CONCAT("A","B")</f><v>AB</v></c><c r="C5"><f>1+1</f><v>2</v></c><c r="E5"><v>0.30000000000000004</v></c></row>`,
      },
      `<si><t>Household</t></si><si><t xml:space="preserve">Name </t></si><si><r><rPr><b/></rPr><t>The </t></r><r><t>García &amp; Kim</t></r></si><si><t>山田</t><rPh sb="0" eb="2"><t>ヤマダ</t></rPh></si>`,
    );
    const r = parseXlsx(x);
    expect(r.sheets).toEqual(['Guests']);
    expect(r.sheet).toBe('Guests');
    expect(r.headers).toEqual(['Household', 'Name', 'Age', '', '']);
    expect(r.rows).toEqual([
      ['The García & Kim', '山田', '34', 'TRUE', ''],
      ['AB', '', '2', '', '0.3'],
    ]);
  });

  it('reads the first sheet or the one chosen by name (case-insensitive)', () => {
    const x = book({
      Guests: '<row r="1"><c r="A1" t="inlineStr"><is><t>First</t></is></c></row>',
      'Old list': '<row r="1"><c r="A1" t="inlineStr"><is><t>Second</t></is></c></row>',
    });
    expect(parseXlsx(x).headers).toEqual(['First']);
    expect(parseXlsx(x, { sheet: 'old LIST' }).headers).toEqual(['Second']);
    expect(parseXlsx(x, { sheet: 'old LIST' }).sheets).toEqual(['Guests', 'Old list']);
    expect(() => parseXlsx(x, { sheet: 'Nope' })).toThrow(/sheet_not_found/);
  });

  it('decodes _xHHHH_ escapes and namespace-prefixed markup; never opens macros', () => {
    const x = book(
      { S: '<x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>a_x000D_b</x:t></x:is></x:c></x:row>' },
      undefined,
      { 'xl/vbaProject.bin': new Uint8Array(1_000).fill(7) },
    );
    expect(parseXlsx(x).headers).toEqual(['a\rb']);
  });

  it('refuses what is not a workbook, and enforces entry, expansion, row, column and cell limits', () => {
    expect(() => parseXlsx(strToU8('Name,Email\nA,b@x.test'))).toThrow(/not_a_spreadsheet/);
    expect(() => parseXlsx(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/not_a_spreadsheet/);
    const big = book({ S: `<row r="1"><c r="A1"><v>1</v></c></row>${' '.repeat(50_000)}` });
    expect(() => parseXlsx(big, { limits: { maxPartBytes: 10_000 } })).toThrow(/too_large/);
    expect(() => parseXlsx(big, { limits: { maxExpandedBytes: 10_000 } })).toThrow(/too_large/);
    expect(() => parseXlsx(big, { limits: { maxEntries: 2 } })).toThrow(/too_large/);
    const rows = Array.from(
      { length: 5 },
      (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`,
    );
    expect(() => parseXlsx(book({ S: rows.join('') }), { limits: { maxRows: 3 } })).toThrow(CsvError);
    expect(() =>
      parseXlsx(book({ S: '<row r="1"><c r="C1"><v>1</v></c></row>' }), { limits: { maxColumns: 2 } }),
    ).toThrow(/too_many_columns/);
    expect(() =>
      parseXlsx(
        book({ S: `<row r="1"><c r="A1" t="inlineStr"><is><t>${'x'.repeat(20)}</t></is></c></row>` }),
        {
          limits: { maxCell: 10 },
        },
      ),
    ).toThrow(/cell_too_long/);
    expect(() => parseXlsx(book({ S: '' }))).toThrow(/empty/);
  });

  it('a zip bomb that lies about its size inflates no further than it declared', () => {
    // A 5 MB run of zeros, declared as 100 bytes: the reader inflates into 100 bytes and fails
    // on the truncated XML instead of allocating the payload.
    const x = zipSync({
      'xl/workbook.xml': strToU8(WB(['S'])),
      'xl/_rels/workbook.xml.rels': strToU8(RELS(1)),
      'xl/worksheets/sheet1.xml': new Uint8Array(5_000_000),
    });
    // Patch the declared uncompressed size of the sheet in the central directory.
    const view = new DataView(x.buffer, x.byteOffset, x.byteLength);
    let patched = 0;
    for (let i = x.length - 22; i > 0; i--)
      if (
        view.getUint32(i, true) === 0x02014b50 &&
        new TextDecoder().decode(x.subarray(i + 46, i + 46 + 24)) === 'xl/worksheets/sheet1.xml'
      ) {
        view.setUint32(i + 24, 100, true);
        patched++;
      }
    expect(patched).toBe(1);
    expect(() => parseXlsx(x)).toThrow(/empty/);
  });
});

describe('decodeText (M4.1b)', () => {
  it('honours byte-order marks and falls back from UTF-8 to Windows-1252', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('A');
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0xe9, 0x00]))).toBe('Aé');
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x41]))).toBe('A');
    expect(decodeText(new TextEncoder().encode('Zoë Ñúñez'))).toBe('Zoë Ñúñez');
    // "José" as Windows-1252 (é = 0xE9 is not valid UTF-8 on its own).
    expect(decodeText(new Uint8Array([0x4a, 0x6f, 0x73, 0xe9]))).toBe('José');
    expect(decodeText(new Uint8Array([0x80]))).toBe('€');
  });
});
