import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { columnName, parseXlsx, writeXlsx } from '../src/index.ts';

describe('writeXlsx (M4.8g exports)', () => {
  it('round-trips through the reader: text, numbers, empty cells, unicode and RTL text', () => {
    const bytes = writeXlsx(
      [
        ['Donor', 'Amount', 'Note'],
        ['García & Kim <family>', 1000.5, null],
        ['山田', 0, ' leading space'],
        ['مريم', -25, 'line\nbreak'],
      ],
      { sheet: 'Gifts' },
    );
    const r = parseXlsx(bytes);
    expect(r.sheets).toEqual(['Gifts']);
    expect(r.headers).toEqual(['Donor', 'Amount', 'Note']);
    expect(r.rows).toEqual([
      ['García & Kim <family>', '1000.5', ''],
      ['山田', '0', ' leading space'],
      ['مريم', '-25', 'line\nbreak'],
    ]);
  });

  it('never writes a formula: a formula-looking value stays inline text', () => {
    const bytes = writeXlsx([['=HYPERLINK("http://evil","x")', '+1', '@SUM(A1)']]);
    const sheet = new TextDecoder().decode(unzipSync(bytes)['xl/worksheets/sheet1.xml']);
    expect(sheet).not.toContain('<f>');
    expect(sheet).toContain('t="inlineStr"');
    expect(parseXlsx(bytes).headers).toEqual(['=HYPERLINK("http://evil","x")', '+1', '@SUM(A1)']);
  });

  it('drops characters XML cannot carry and cuts cells at 32,767 characters; names columns', () => {
    const bytes = writeXlsx([['a\u0000b\u0007c', 'x'.repeat(40_000)]], { sheet: 'a/b:c' });
    const sheet = new TextDecoder().decode(unzipSync(bytes)['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('<t>abc</t>');
    expect(sheet).toContain(`<t>${'x'.repeat(32_767)}</t>`);
    expect(parseXlsx(bytes, { limits: { maxCell: 40_000 } }).sheets).toEqual(['a b c']);
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });
});
