import { describe, expect, it } from 'vitest';
import { CsvError, csvCell, csvRow, parseCsv } from '../src/index.ts';

describe('parseCsv', () => {
  it('reads quoted fields, doubled quotes, embedded newlines, CRLF and a BOM', () => {
    const r = parseCsv('﻿Name,Email\r\n"Hopper, Grace","g@x.test"\r\n"Say ""hi""\nthere",b@x.test\r\n');
    expect(r.headers).toEqual(['Name', 'Email']);
    expect(r.rows).toEqual([
      ['Hopper, Grace', 'g@x.test'],
      ['Say "hi"\nthere', 'b@x.test'],
    ]);
  });

  it('sniffs semicolon and tab delimiters; skips blank lines; pads short rows', () => {
    expect(parseCsv('a;b\n1;2\n\n3').rows).toEqual([
      ['1', '2'],
      ['3', ''],
    ]);
    expect(parseCsv('a\tb\nx\ty').rows).toEqual([['x', 'y']]);
  });

  it('enforces limits and reports malformed input', () => {
    expect(() => parseCsv('a\n1\n2\n3', { maxRows: 2 })).toThrow(CsvError);
    expect(() => parseCsv('a,b,c', { maxColumns: 2 })).toThrow(/too_many_columns/);
    expect(() => parseCsv(`a\n${'x'.repeat(20)}`, { maxCell: 10 })).toThrow(/cell_too_long/);
    expect(() => parseCsv('a\n"open')).toThrow(/unterminated_quote/);
    expect(() => parseCsv('')).toThrow(/empty/);
  });

  it('round-trips what csvRow writes (formula cells come back neutralised)', () => {
    const out = `h1,h2\r\n${csvRow(['a, "b"', '=1+1'])}`;
    expect(parseCsv(out).rows).toEqual([['a, "b"', "'=1+1"]]);
    expect(csvCell(' pad ')).toBe('" pad "');
  });
});
