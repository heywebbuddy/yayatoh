import { describe, expect, it } from 'vitest';
import {
  colLetter,
  hashValues,
  idempotencyHash,
  parseHeader,
  parseStamp,
  planWrite,
  readGrid,
  SYNC_LABEL,
  serializeStamp,
} from '../src/connectors/google-sheets/grid.ts';

/** M6.4b: the Sheets grid — row stamps, header mapping, change detection and write plans. */

const HEADER = ['Name', 'Email', 'Labels', 'Status', SYNC_LABEL];
const now = new Date('2026-10-01T10:00:00Z');
const later = new Date('2026-10-01T11:00:00Z');
const ids = () => {
  let n = 0;
  return () => `rnew${++n}`;
};
const stamped = (
  values: Record<string, string>,
  s: { id: string; rev: number; o: string | null; k?: string },
) => serializeStamp({ ...s, h: hashValues(values), at: now.toISOString() });
const ada = { name: 'Ada', email: 'ada@x.test', labels: '', status: 'active' };

describe('the Sheets grid', () => {
  it('names columns, parses and writes stamps', () => {
    expect([0, 25, 26, 51, 52].map(colLetter)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA']);
    expect(parseHeader([' email ', 'NAME', 'Notes', SYNC_LABEL])).toEqual({
      columns: [
        { index: 0, key: 'email' },
        { index: 1, key: 'name' },
      ],
      sync: 3,
      width: 4,
    });
    const s = { id: 'r1', rev: 2, h: 'abc', o: 'yayatoh:c', at: now.toISOString(), k: 'kk' };
    expect(parseStamp(serializeStamp(s))).toEqual(s);
    expect(serializeStamp({ ...s, k: undefined })).not.toContain('"k"');
    for (const bad of ['', 'x', '{', '{"id":"r 1","rev":1,"h":"","o":null,"at":""}', '{"id":"r1","rev":0}'])
      expect(parseStamp(bad)).toBeNull();
    expect(hashValues({ a: '1', b: '2' })).toBe(hashValues({ b: '2', a: '1' }));
    expect(hashValues({ a: '1' })).not.toBe(hashValues({ a: '2' }));
  });

  it('a new row a person typed gets an id and a stamp write-back; empty rows are skipped', () => {
    const { rows } = readGrid([HEADER, ['Walk-in', 'walk@x.test'], [], ['', '', '', '']], {
      now,
      newId: ids(),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rowNumber: 2,
      stamp: null,
      row: {
        rowId: 'rnew1',
        rev: 1,
        origin: null,
        updatedAt: now.toISOString(),
        values: { name: 'Walk-in', email: 'walk@x.test', labels: '', status: '' },
      },
    });
    expect(parseStamp(rows[0]?.writeBack as string)).toMatchObject({ id: 'rnew1', rev: 1, o: null });
    // Once written back, the same row reads with the same id and nothing to write.
    const grid = [HEADER, ['Walk-in', 'walk@x.test', '', '', rows[0]?.writeBack as string]];
    const again = readGrid(grid, { now: later, newId: ids() }).rows[0];
    expect(again?.writeBack).toBeNull();
    expect(again?.row).toEqual(rows[0]?.row);
  });

  it('a person’s edit bumps the revision and clears the origin; our own write keeps it', () => {
    const ours = stamped(ada, { id: 'r1', rev: 3, o: 'yayatoh:c' });
    const row = [ada.name, ada.email, ada.labels, ada.status, ours];
    const mine = readGrid([HEADER, row], { now: later, newId: ids() }).rows[0];
    expect(mine?.writeBack).toBeNull();
    expect(mine?.row).toMatchObject({
      rowId: 'r1',
      rev: 3,
      origin: 'yayatoh:c',
      updatedAt: now.toISOString(),
    });
    const edited = readGrid([HEADER, ['Ada L.', ...row.slice(1)]], { now: later, newId: ids() }).rows[0];
    expect(edited?.row).toMatchObject({
      rowId: 'r1',
      rev: 4,
      origin: null,
      updatedAt: later.toISOString(),
      values: { name: 'Ada L.' },
    });
    expect(parseStamp(edited?.writeBack as string)).toMatchObject({ id: 'r1', rev: 4, o: null });
    // A row copied with its hidden cell is a new row, not a second r1.
    const copied = readGrid([HEADER, row, row], { now: later, newId: ids() }).rows;
    expect(copied.map((r) => r.row.rowId)).toEqual(['r1', 'rnew1']);
  });

  it('maps reordered columns by their labels', () => {
    const header = ['Status', SYNC_LABEL, 'Email', 'Name', 'Labels'];
    const values = { name: 'Ada', email: 'ada@x.test', labels: 'vip', status: 'active' };
    const grid = [
      header,
      ['active', stamped(values, { id: 'r1', rev: 1, o: 'o' }), 'ada@x.test', 'Ada', 'vip'],
    ];
    const r = readGrid(grid, { now, newId: ids() }).rows[0];
    expect(r?.row).toMatchObject({ rowId: 'r1', rev: 1, origin: 'o', values });
    expect(r?.writeBack).toBeNull();
    // A write puts each value under its label and the stamp in the sync column.
    const { plan } = planWrite(grid, {
      rowId: 'r1',
      values: { ...values, labels: 'press' },
      k: idempotencyHash('k2'),
      origin: 'o',
      now: later,
      newId: ids(),
    });
    expect(plan).toMatchObject({ kind: 'update', rowId: 'r1', rev: 2, range: 'Attendees!A2:E2' });
    if (plan.kind !== 'update') throw new Error('plan');
    expect([plan.cells[0], plan.cells[2], plan.cells[3], plan.cells[4]]).toEqual([
      'active',
      'ada@x.test',
      'Ada',
      'press',
    ]);
    expect(parseStamp(plan.cells[1])).toMatchObject({ id: 'r1', rev: 2, o: 'o', at: later.toISOString() });
  });

  it('a retry with the same idempotency key does not append twice', () => {
    const k = idempotencyHash('k1:sheet');
    const write = (grid: string[][], rowId: string | null = null) =>
      planWrite(grid, { rowId, values: ada, k, origin: 'o', now, newId: ids() }).plan;
    const first = write([HEADER]);
    expect(first).toMatchObject({ kind: 'append', rowId: 'rnew1', rev: 1 });
    if (first.kind !== 'append') throw new Error('plan');
    // The append landed but its answer was lost: the retry finds the row.
    expect(write([HEADER, first.cells])).toEqual({ kind: 'none', rowId: 'rnew1', rev: 1 });
    // An update retried after it landed changes nothing either.
    expect(write([HEADER, first.cells], 'rnew1')).toEqual({ kind: 'none', rowId: 'rnew1', rev: 1 });
    // Another write (another key) to the same row does update it.
    const other = planWrite([HEADER, first.cells], {
      rowId: 'rnew1',
      values: { ...ada, labels: 'vip' },
      k: idempotencyHash('k2:sheet'),
      origin: 'o',
      now,
      newId: ids(),
    }).plan;
    expect(other).toMatchObject({ kind: 'update', rowId: 'rnew1', rev: 2 });
  });
});
