import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { columnName, parseXlsx, writeXlsx } from '../src/index.ts';

describe('writeXlsx (M4.3b)', () => {
  it('round-trips text, numbers, blanks and non-Latin text through our reader', () => {
    const bytes = writeXlsx([
      {
        name: 'Seating chart',
        rows: [
          ['Table', 'Guest', 'Meal', 'Count'],
          ['Table 1', 'Ana García', 'Beef', 2],
          ['طاولة ٢', 'ليلى', null, 0],
          ['Table 10', '山田 太郎', '', 1.5],
        ],
      },
    ]);
    const r = parseXlsx(bytes);
    expect(r.sheets).toEqual(['Seating chart']);
    expect(r.headers).toEqual(['Table', 'Guest', 'Meal', 'Count']);
    expect(r.rows).toEqual([
      ['Table 1', 'Ana García', 'Beef', '2'],
      ['طاولة ٢', 'ليلى', '', '0'],
      ['Table 10', '山田 太郎', '', '1.5'],
    ]);
  });

  it('writes formula-like text as inline strings, never as formulas; escapes XML', () => {
    const bytes = writeXlsx([{ name: 'S', rows: [['h'], ['=HYPERLINK("x")'], ['<b>&</b>'], ['a\u0001b']] }]);
    const sheet = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml'] as Uint8Array);
    expect(sheet).not.toContain('<f>');
    expect(sheet).toContain('t="inlineStr"');
    expect(parseXlsx(bytes).rows).toEqual([['=HYPERLINK("x")'], ['<b>&</b>'], ['ab']]);
  });

  it('several sheets with names Excel accepts (unique, ≤31 characters, no []:*?/\\)', () => {
    const bytes = writeXlsx([
      { name: 'Meals: by table / total', rows: [['a']] },
      { name: 'Meals  by table   total', rows: [['b']] },
      { name: 'x'.repeat(40), rows: [['c']] },
      { name: '', rows: [['d']] },
    ]);
    const { sheets } = parseXlsx(bytes);
    expect(sheets).toEqual([
      'Meals  by table   total',
      'Meals  by table   total 2',
      'x'.repeat(31),
      'Sheet4',
    ]);
    expect(parseXlsx(bytes, { sheet: 'Sheet4' }).headers).toEqual(['d']);
  });

  it('bold, frozen header row; deterministic bytes', () => {
    const rows = [
      ['Table', 'Guests'],
      ['T1', 3],
    ];
    const a = writeXlsx([{ name: 'S', rows }]);
    expect(writeXlsx([{ name: 'S', rows }])).toEqual(a);
    const sheet = strFromU8(unzipSync(a)['xl/worksheets/sheet1.xml'] as Uint8Array);
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toMatch(/<c r="A1" s="1"/);
    expect(sheet).toMatch(/<c r="B2"><v>3<\/v><\/c>/);
    expect(() => writeXlsx([])).toThrow();
  });

  it('names columns A…Z, AA…', () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
  });
});
