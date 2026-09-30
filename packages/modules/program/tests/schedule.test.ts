import { describe, expect, it } from 'vitest';
import {
  groupByDay,
  localDay,
  overlaps,
  type ScheduleItem,
  scheduleWarnings,
  warningsFor,
} from '../src/domain/schedule.ts';

const at = (hhmm: string, day = '2030-03-01') => new Date(`${day}T${hhmm}:00Z`);
const s = (
  id: string,
  from: string,
  to: string,
  roomId: string | null = null,
  speakerIds: string[] = [],
  day?: string,
): ScheduleItem => ({ id, startsAt: at(from, day), endsAt: at(to, day), roomId, speakerIds });

describe('overlaps (half-open intervals)', () => {
  it('touching intervals do not overlap; nested and partial ones do', () => {
    expect(overlaps(s('a', '09:00', '10:00'), s('b', '10:00', '11:00'))).toBe(false);
    expect(overlaps(s('a', '09:00', '10:00'), s('b', '09:59', '11:00'))).toBe(true);
    expect(overlaps(s('a', '09:00', '12:00'), s('b', '10:00', '11:00'))).toBe(true);
    expect(overlaps(s('a', '10:00', '11:00'), s('b', '09:00', '12:00'))).toBe(true);
    expect(overlaps(s('a', '09:00', '10:00'), s('b', '09:00', '10:00'))).toBe(true);
  });
});

describe('scheduleWarnings', () => {
  it('flags the same room at overlapping times once per pair, earlier session first', () => {
    const w = scheduleWarnings([s('b', '09:30', '10:30', 'r1'), s('a', '09:00', '10:00', 'r1')]);
    expect(w).toEqual([{ kind: 'room_overlap', sessionId: 'a', otherId: 'b', roomId: 'r1' }]);
  });

  it('back-to-back sessions and different rooms are fine', () => {
    expect(
      scheduleWarnings([
        s('a', '09:00', '10:00', 'r1'),
        s('b', '10:00', '11:00', 'r1'),
        s('c', '09:00', '10:00', 'r2'),
        s('d', '09:00', '10:00', null),
        s('e', '09:00', '10:00', null),
      ]),
    ).toEqual([]);
  });

  it('flags a speaker booked in two overlapping sessions (any rooms)', () => {
    const w = scheduleWarnings([
      s('a', '09:00', '10:00', 'r1', ['p1', 'p2']),
      s('b', '09:30', '10:30', 'r2', ['p2']),
    ]);
    expect(w).toEqual([{ kind: 'speaker_overlap', sessionId: 'a', otherId: 'b', speakerId: 'p2' }]);
  });

  it('finds every conflict of a long session, not only the next one', () => {
    const w = scheduleWarnings([
      s('long', '09:00', '17:00', 'r1'),
      s('x', '10:00', '11:00', 'r1'),
      s('y', '15:00', '16:00', 'r1'),
      s('z', '17:00', '18:00', 'r1'),
    ]);
    expect(w.map((x) => (x.kind === 'outside_event' ? x.sessionId : `${x.sessionId}-${x.otherId}`))).toEqual([
      'long-x',
      'long-y',
    ]);
  });

  it('flags sessions outside the event span', () => {
    const span = { startsAt: at('09:00'), endsAt: at('18:00') };
    const w = scheduleWarnings(
      [s('early', '08:00', '09:30'), s('ok', '09:00', '18:00'), s('late', '17:00', '18:30')],
      span,
    );
    expect(w).toEqual([
      { kind: 'outside_event', sessionId: 'early' },
      { kind: 'outside_event', sessionId: 'late' },
    ]);
  });

  it('is deterministic for identical start times (ties by id)', () => {
    const w = scheduleWarnings([s('b', '09:00', '10:00', 'r1'), s('a', '09:00', '10:00', 'r1')]);
    expect(w).toEqual([{ kind: 'room_overlap', sessionId: 'a', otherId: 'b', roomId: 'r1' }]);
  });

  it('warningsFor returns both sides of a pair, from that session’s point of view', () => {
    const w = scheduleWarnings([s('a', '09:00', '10:00', 'r1'), s('b', '09:30', '10:30', 'r1')]);
    expect(warningsFor(w, 'b')).toEqual([
      { kind: 'room_overlap', sessionId: 'b', otherId: 'a', roomId: 'r1' },
    ]);
    expect(warningsFor(w, 'a')).toEqual(w);
    expect(warningsFor(w, 'nobody')).toEqual([]);
  });
});

describe('groupByDay (event timezone)', () => {
  const item = (title: string, iso: string, hours = 1) => ({
    title,
    startsAt: new Date(iso),
    endsAt: new Date(new Date(iso).getTime() + hours * 3_600_000),
  });

  it('groups by the local day in the event timezone, not UTC', () => {
    // 02:30 UTC on 2 March is still 1 March in Chicago (UTC−6).
    const groups = groupByDay(
      [
        item('Late keynote', '2030-03-02T02:30:00Z'),
        item('Breakfast', '2030-03-02T14:00:00Z'),
        item('Opening', '2030-03-01T15:00:00Z'),
      ],
      'America/Chicago',
    );
    expect(groups.map((g) => [g.day, g.items.map((i) => i.title)])).toEqual([
      ['2030-03-01', ['Opening', 'Late keynote']],
      ['2030-03-02', ['Breakfast']],
    ]);
  });

  it('the same instants fall on other days in Tokyo', () => {
    expect(groupByDay([item('Late keynote', '2030-03-02T02:30:00Z')], 'Asia/Tokyo')[0]?.day).toBe(
      '2030-03-02',
    );
    expect(localDay(new Date('2030-03-01T23:30:00Z'), 'Asia/Tokyo')).toBe('2030-03-02');
  });

  it('orders by start, then end, then title', () => {
    const groups = groupByDay(
      [
        item('B', '2030-03-01T10:00:00Z', 2),
        item('C', '2030-03-01T10:00:00Z', 1),
        item('A', '2030-03-01T10:00:00Z', 1),
      ],
      'UTC',
    );
    expect(groups[0]?.items.map((i) => i.title)).toEqual(['A', 'C', 'B']);
  });

  it('is empty for no sessions', () => {
    expect(groupByDay([], 'UTC')).toEqual([]);
  });
});
