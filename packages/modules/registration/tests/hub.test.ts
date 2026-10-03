import { describe, expect, it } from 'vitest';
import {
  calendarFeedIcs,
  type FeedSession,
  favoriteDecision,
  MAX_FAVORITES,
  nowAndNext,
  overlaps,
  type ScheduleItem,
  scheduleConflicts,
  sequenceOf,
  signFeedToken,
  verifyFeedToken,
} from '../src/domain/hub.ts';

const at = (hhmm: string) => new Date(`2026-11-10T${hhmm}:00Z`);
const item = (
  id: string,
  from: string,
  to: string,
  kind: ScheduleItem['kind'] = 'favorite',
): ScheduleItem => ({
  sessionId: id,
  title: `Session ${id}`,
  startsAt: at(from),
  endsAt: at(to),
  kind,
});

describe('overlaps (half-open)', () => {
  it('back-to-back sessions do not overlap; nested and partial ones do', () => {
    expect(overlaps(item('a', '09:00', '10:00'), item('b', '10:00', '11:00'))).toBe(false);
    expect(overlaps(item('a', '09:00', '10:00'), item('b', '09:59', '11:00'))).toBe(true);
    expect(overlaps(item('a', '09:00', '12:00'), item('b', '10:00', '11:00'))).toBe(true);
  });
});

describe('favoriteDecision (conflict prompts)', () => {
  const target = item('t', '10:00', '11:00');
  it('stars a free slot at once, and a starred session again is a no-op', () => {
    expect(favoriteDecision({ target, mine: [], choice: 'refuse', favorites: 0 })).toEqual({
      kind: 'add',
      remove: [],
    });
    expect(
      favoriteDecision({ target, mine: [item('t', '10:00', '11:00')], choice: 'refuse', favorites: 1 }),
    ).toEqual({ kind: 'noop' });
  });

  it('asks first when it overlaps, naming every session in the way', () => {
    const mine = [
      item('f', '10:30', '11:30'),
      item('e', '09:30', '10:15', 'enrolled'),
      item('x', '12:00', '13:00'),
    ];
    const d = favoriteDecision({ target, mine, choice: 'refuse', favorites: 2 });
    expect(d.kind).toBe('refuse');
    if (d.kind === 'refuse' && d.reason === 'overlap')
      expect(d.conflicts.map((c) => c.sessionId).sort()).toEqual(['e', 'f']);
  });

  it('keep both stars it anyway; replace un-stars overlapping favorites only', () => {
    const favs = [item('f', '10:30', '11:30'), item('g', '09:00', '10:30')];
    expect(favoriteDecision({ target, mine: favs, choice: 'keep_both', favorites: 2 })).toEqual({
      kind: 'add',
      remove: [],
    });
    expect(favoriteDecision({ target, mine: favs, choice: 'replace', favorites: 2 })).toEqual({
      kind: 'add',
      remove: ['f', 'g'],
    });
    // An enrollment in the way: replace is refused (enrollments are dropped by their own button).
    const d = favoriteDecision({
      target,
      mine: [...favs, item('e', '10:00', '10:30', 'enrolled')],
      choice: 'replace',
      favorites: 2,
    });
    expect(d).toMatchObject({ kind: 'refuse', reason: 'overlap' });
  });

  it('caps the number of favorites', () => {
    expect(favoriteDecision({ target, mine: [], choice: 'refuse', favorites: MAX_FAVORITES })).toEqual({
      kind: 'refuse',
      reason: 'too_many',
    });
  });
});

describe('scheduleConflicts', () => {
  it('lists each item’s overlaps; an enrolled + starred session counts once', () => {
    const c = scheduleConflicts([
      item('a', '09:00', '10:00', 'enrolled'),
      item('a', '09:00', '10:00'),
      item('b', '09:30', '10:30'),
      item('c', '10:30', '11:00'),
    ]);
    expect(c.get('a')).toEqual(['b']);
    expect(c.get('b')).toEqual(['a']);
    expect(c.get('c')).toEqual([]);
  });
});

describe('nowAndNext', () => {
  const list = [
    item('a', '09:00', '10:00'),
    item('b', '09:30', '11:00'),
    item('c', '11:00', '12:00'),
    item('d', '11:00', '11:30'),
  ];
  it('on now = started and not ended; next = the earliest start after now (ties together)', () => {
    const r = nowAndNext(list, at('09:45'));
    expect(r.now.map((x) => x.sessionId)).toEqual(['a', 'b']);
    expect(r.next.map((x) => x.sessionId)).toEqual(['c', 'd']);
  });
  it('a session ending now is over; nothing next beyond the window', () => {
    expect(nowAndNext(list, at('10:00')).now.map((x) => x.sessionId)).toEqual(['b']);
    expect(nowAndNext(list, new Date('2026-11-09T09:00:00Z')).next).toEqual([]);
  });
});

describe('signed feed tokens', () => {
  const claim = {
    orgId: '01900000-0000-7000-8000-000000000001',
    registrantId: '01900000-0000-7000-8000-000000000002',
    version: 3,
  };
  it('round-trips and refuses tampering, other secrets and other purposes', () => {
    const tok = signFeedToken(claim, 's3cret');
    expect(verifyFeedToken(tok, 's3cret')).toEqual(claim);
    expect(verifyFeedToken(tok, 'other')).toBeNull();
    expect(verifyFeedToken(tok.replace('~3~', '~4~'), 's3cret')).toBeNull();
    expect(verifyFeedToken(`${tok}x`, 's3cret')).toBeNull();
    expect(verifyFeedToken('a~b~c~d', 's3cret')).toBeNull();
    expect(verifyFeedToken('x'.repeat(201), 's3cret')).toBeNull();
    // A token with the same shape for another purpose (a big-screen link) is not a feed token.
    expect(tok.split('~')).toHaveLength(4);
    expect(tok).not.toContain('.');
  });
});

describe('calendarFeedIcs', () => {
  const base: FeedSession = {
    sessionId: '01900000-0000-7000-8000-0000000000aa',
    title: 'Keynote; the future, today',
    startsAt: at('09:00'),
    endsAt: at('10:00'),
    roomName: 'Hall A',
    updatedAt: new Date('2026-10-01T12:00:00Z'),
    confirmed: true,
  };
  it('one event per session, escaped, CRLF, confirmed vs tentative', () => {
    const ics = calendarFeedIcs({
      calendarName: 'Summit 2026',
      timezone: 'Europe/Paris',
      sessions: [
        base,
        { ...base, sessionId: `${base.sessionId.slice(0, -2)}bb`, confirmed: false, roomName: null },
      ],
    });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('SUMMARY:Keynote\\; the future\\, today');
    expect(ics).toContain('DTSTART:20261110T090000Z');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('STATUS:TENTATIVE');
    expect(ics).toContain('LOCATION:Hall A');
    expect(ics).toContain('X-WR-CALNAME:Summit 2026');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  it('a moved session keeps its UID and gets a higher SEQUENCE', () => {
    const before = calendarFeedIcs({ calendarName: 'x', timezone: 'UTC', sessions: [base] });
    const moved = calendarFeedIcs({
      calendarName: 'x',
      timezone: 'UTC',
      sessions: [
        { ...base, startsAt: at('14:00'), endsAt: at('15:00'), updatedAt: new Date('2026-10-01T12:00:05Z') },
      ],
    });
    const uid = (s: string) => s.match(/UID:(.+)\r\n/)?.[1];
    const seq = (s: string) => Number(s.match(/SEQUENCE:(\d+)/)?.[1]);
    expect(uid(moved)).toBe(uid(before));
    expect(seq(moved)).toBeGreaterThan(seq(before));
    expect(moved).toContain('DTSTART:20261110T140000Z');
    expect(sequenceOf(new Date('2088-01-01T00:00:00Z'))).toBeLessThan(2 ** 31);
  });

  it('folds long titles at 75 octets without splitting a character', () => {
    const ics = calendarFeedIcs({
      calendarName: 'x',
      timezone: 'UTC',
      sessions: [{ ...base, title: 'مؤتمر '.repeat(40) }],
    });
    const lines = ics.split('\r\n');
    expect(lines.every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(`SUMMARY:${'مؤتمر '.repeat(40)}`);
  });
});
