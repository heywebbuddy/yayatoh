import { buildRow, type FloorplanDoc, layoutProblems } from '@yayatoh/floorplan';
import { describe, expect, it } from 'vitest';
import { diffDocs, planRestore } from '../src/index.ts';

const docOf = (...items: ReturnType<typeof buildRow>[]): FloorplanDoc => ({
  version: 1,
  width: 3000,
  height: 2000,
  underlay: null,
  sections: [],
  items,
});
const relabel = (row: ReturnType<typeof buildRow>, label: string) => ({ ...row, label });

describe('layout diff (M6.11b)', () => {
  it('lists seats added, removed and renumbered, and counts moved seats and items', () => {
    const a = buildRow({ label: 'A', count: 3, x: 100, y: 100 });
    const b = buildRow({ label: 'B', count: 2, x: 100, y: 300 });
    const c = buildRow({ label: 'C', count: 2, x: 100, y: 500 });
    const from = docOf(a, b);
    const to = docOf({ ...relabel(a, 'AA'), y: 150 }, c);
    const d = diffDocs(from, to);
    expect(d.added.map((s) => s.label)).toEqual(['Row C · 1', 'Row C · 2']);
    expect(d.removed.map((s) => s.label)).toEqual(['Row B · 1', 'Row B · 2']);
    expect(d.renumbered).toEqual(
      a.seats.map((s) => ({ seatId: s.id, from: `Row A · ${s.label}`, to: `Row AA · ${s.label}` })),
    );
    expect(d.moved).toBe(0);
    expect(d.itemsAdded).toBe(1);
    expect(d.itemsRemoved).toBe(1);
    const moved = diffDocs(from, docOf({ ...a, x: 200 }, b));
    expect(moved).toMatchObject({ added: [], removed: [], renumbered: [], moved: 3, itemsAdded: 0 });
    expect(diffDocs(from, from)).toMatchObject({ added: [], removed: [], renumbered: [], moved: 0 });
  });
});

describe('restoring a revision keeps held and sold seats (M6.11b)', () => {
  const a = buildRow({ label: 'A', count: 4, x: 100, y: 100 });
  const sold = (i: number, row = a, status: 'held' | 'sold' = 'sold') => ({
    seatUuid: row.seats[i]?.id ?? '',
    label: `Row ${row.label} · ${row.seats[i]?.label}`,
    status,
  });

  it('keeps a seat that is in the revision with the same label', () => {
    const p = planRestore(docOf(a), [sold(0), sold(1, a, 'held')]);
    expect(p.ok).toBe(true);
    expect(p.outcomes.map((o) => o.outcome)).toEqual(['kept', 'kept']);
    expect(p.doc).toEqual(docOf(a));
  });

  it('remaps a sold seat onto the revision seat with its label; ids stay unique and valid', () => {
    // The revision has row A drawn again (new seat ids), the current plan sold seat A·2.
    const redrawn = buildRow({ label: 'A', count: 4, x: 100, y: 400 });
    const p = planRestore(docOf(redrawn), [sold(1)]);
    expect(p.ok).toBe(true);
    expect(p.outcomes).toEqual([
      {
        seatUuid: a.seats[1]?.id,
        label: 'Row A · 2',
        status: 'sold',
        outcome: 'remapped',
        replaces: redrawn.seats[1]?.id,
      },
    ]);
    const row = p.doc.items[0];
    expect(row?.kind === 'row' && row.seats.map((s) => s.id)).toEqual([
      redrawn.seats[0]?.id,
      a.seats[1]?.id,
      redrawn.seats[2]?.id,
      redrawn.seats[3]?.id,
    ]);
    expect(layoutProblems(p.doc)).toEqual([]);
  });

  it('refuses when a sold seat is gone or would get another label, and says which', () => {
    const b = buildRow({ label: 'B', count: 2, x: 100, y: 400 });
    const p = planRestore(docOf(relabel(a, 'Z'), b), [sold(0), sold(0, b)]);
    expect(p.ok).toBe(false);
    expect(p.outcomes).toEqual([
      {
        seatUuid: a.seats[0]?.id,
        label: 'Row A · 1',
        status: 'sold',
        outcome: 'conflict',
        reason: 'renumbered',
        newLabel: 'Row Z · 1',
      },
      { seatUuid: b.seats[0]?.id, label: 'Row B · 1', status: 'sold', outcome: 'kept' },
    ]);
    const gone = planRestore(docOf(b), [sold(2)]);
    expect(gone.outcomes).toEqual([
      {
        seatUuid: a.seats[2]?.id,
        label: 'Row A · 3',
        status: 'sold',
        outcome: 'conflict',
        reason: 'removed',
      },
    ]);
  });

  it('never remaps onto a seat that is itself held or sold', () => {
    // Current: A·1 (id x) sold; the revision's seat labelled A·1 has the id of another sold seat.
    const other = buildRow({ label: 'B', count: 1, x: 100, y: 400 });
    const swapped = {
      ...a,
      seats: a.seats.map((s, i) => (i === 0 ? { ...s, id: other.seats[0]?.id ?? '' } : s)),
    };
    const p = planRestore(docOf(swapped), [sold(0), sold(0, other)]);
    expect(p.ok).toBe(false);
    expect(p.outcomes.map((o) => [o.label, o.outcome])).toEqual([
      ['Row A · 1', 'conflict'],
      ['Row B · 1', 'conflict'],
    ]);
  });
});
