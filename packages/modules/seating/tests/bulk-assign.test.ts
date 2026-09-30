import { describe, expect, it } from 'vitest';
import { assignSeatState, planChunk, planUndo } from '../src/index.ts';

const seat = (id: string, free = true, accessible = false) => ({ seatUuid: id, free, accessible });
const person = (
  id: string,
  over: { refused?: 'attendee_cancelled' | 'seated_by_ticket'; there?: boolean } = {},
) => ({
  attendeeId: id,
  refused: over.refused ?? null,
  alreadyThere: over.there ?? false,
});

describe('bulk seat assignment planning (M1.8f)', () => {
  it("shows a group's kept-back seat as reserved (a chosen seat may still take it)", () => {
    expect(assignSeatState('blocked', 'group')).toBe('reserved');
  });

  it('seats people in order in the free seats, in plan order, accessible seats last', () => {
    const seats = [seat('a1', true, true), seat('s1', false), seat('s2'), seat('s3'), seat('a2', true, true)];
    const plan = planChunk(seats, [person('p1'), person('p2'), person('p3')], { skipAccessible: false });
    expect(plan.placements).toEqual([
      { attendeeId: 'p1', seatUuid: 's2' },
      { attendeeId: 'p2', seatUuid: 's3' },
      { attendeeId: 'p3', seatUuid: 'a1' },
    ]);
    expect(plan.failures).toEqual([]);
  });

  it('reports the people past the free seats as not_enough_seats (a partial result)', () => {
    const plan = planChunk(
      [seat('s1'), seat('s2')],
      [person('p1'), person('p2'), person('p3'), person('p4')],
      {
        skipAccessible: false,
      },
    );
    expect(plan.placements.map((p) => p.attendeeId)).toEqual(['p1', 'p2']);
    expect(plan.failures).toEqual([
      { attendeeId: 'p3', code: 'not_enough_seats' },
      { attendeeId: 'p4', code: 'not_enough_seats' },
    ]);
  });

  it('never uses accessible seats while an enforced keep-back applies', () => {
    const plan = planChunk([seat('a1', true, true), seat('s1')], [person('p1'), person('p2')], {
      skipAccessible: true,
    });
    expect(plan.placements).toEqual([{ attendeeId: 'p1', seatUuid: 's1' }]);
    expect(plan.failures).toEqual([{ attendeeId: 'p2', code: 'not_enough_seats' }]);
  });

  it('keeps refused people and people already in the target out of the seats', () => {
    const plan = planChunk(
      [seat('s1'), seat('s2')],
      [
        person('p1', { refused: 'seated_by_ticket' }),
        person('p2', { there: true }),
        person('p3'),
        person('p4', { refused: 'attendee_cancelled' }),
      ],
      { skipAccessible: false },
    );
    expect(plan.placements).toEqual([{ attendeeId: 'p3', seatUuid: 's1' }]);
    expect(plan.unchanged).toEqual(['p2']);
    expect(plan.failures).toEqual([
      { attendeeId: 'p1', code: 'seated_by_ticket' },
      { attendeeId: 'p4', code: 'attendee_cancelled' },
    ]);
  });
});

describe('bulk seat assignment undo mapping (M1.8f)', () => {
  const prev = { seatUuid: 'old', pinned: true, priorBlock: 'group' };

  it('unseats people still in the seat they were given and restores their previous seat exactly', () => {
    const plan = planUndo(
      [
        { attendeeId: 'p1', undo: { given: 's1', prev } },
        { attendeeId: 'p2', undo: { given: 's2', prev: null } },
      ],
      new Map([
        ['p1', 's1'],
        ['p2', 's2'],
      ]),
    );
    expect(plan.release).toEqual(['p1', 'p2']);
    expect(plan.restore).toEqual([{ attendeeId: 'p1', prev }]);
    expect(plan.skipped).toEqual([]);
  });

  it('leaves alone anyone moved or unseated since the operation', () => {
    const plan = planUndo(
      [
        { attendeeId: 'moved', undo: { given: 's1', prev } },
        { attendeeId: 'gone', undo: { given: 's2', prev: null } },
      ],
      new Map([['moved', 's9']]),
    );
    expect(plan.release).toEqual([]);
    expect(plan.restore).toEqual([]);
    expect(plan.skipped).toEqual(['moved', 'gone']);
  });
});
