import { describe, expect, it } from 'vitest';
import {
  escapeLike,
  freeTable,
  icsEscape,
  MAX_INTERESTS,
  MAX_SLOT_SERIES,
  meetingIcs,
  normalizeInterests,
  slotSeries,
} from '../src/domain/networking.ts';

describe('freeTable (a location never double-books)', () => {
  it('takes the lowest free table, up to the capacity', () => {
    expect(freeTable(3, [])).toBe(1);
    expect(freeTable(3, [1])).toBe(2);
    expect(freeTable(3, [2, 1])).toBe(3);
    expect(freeTable(3, [1, 3])).toBe(2);
  });
  it('is null when every table is taken, or the capacity shrank below what is booked', () => {
    expect(freeTable(2, [1, 2])).toBeNull();
    expect(freeTable(1, [1, 2])).toBeNull();
    expect(freeTable(0, [])).toBeNull();
  });
  it('never returns a table that is taken or beyond the capacity (exhaustive for small sizes)', () => {
    for (let cap = 0; cap <= 6; cap++)
      for (let mask = 0; mask < 1 << 8; mask++) {
        const taken = [...Array(8).keys()].filter((i) => mask & (1 << i)).map((i) => i + 1);
        const t = freeTable(cap, taken);
        const free = [...Array(cap).keys()].map((i) => i + 1).filter((n) => !taken.includes(n));
        if (free.length === 0) expect(t).toBeNull();
        else expect(t).toBe(free[0]);
      }
  });
});

describe('slotSeries', () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2027, 4, 10, h, m));
  it('cuts a window into back-to-back slots; a short remainder is dropped', () => {
    const s = slotSeries(at(10), at(11, 10), 20);
    expect(s).toEqual([
      { startsAt: at(10), endsAt: at(10, 20) },
      { startsAt: at(10, 20), endsAt: at(10, 40) },
      { startsAt: at(10, 40), endsAt: at(11) },
    ]);
  });
  it('is empty for an empty or backwards window, and refuses silly lengths', () => {
    expect(slotSeries(at(10), at(10), 15)).toEqual([]);
    expect(slotSeries(at(11), at(10), 15)).toEqual([]);
    expect(() => slotSeries(at(10), at(11), 4)).toThrow();
    expect(() => slotSeries(at(10), at(11), 241)).toThrow();
  });
  it('stops at the series cap', () => {
    expect(slotSeries(at(0), new Date(at(0).getTime() + 10 * 86_400_000), 5)).toHaveLength(MAX_SLOT_SERIES);
  });
});

describe('normalizeInterests', () => {
  it('splits on commas and new lines, trims, drops duplicates (case-insensitive) and empties', () => {
    expect(normalizeInterests('AI, design ,\nai,, Data ')).toEqual(['AI', 'design', 'Data']);
  });
  it('caps the count and the length of each', () => {
    const many = Array.from({ length: 20 }, (_, i) => `topic ${i}`).join(',');
    expect(normalizeInterests(many)).toHaveLength(MAX_INTERESTS);
    expect(normalizeInterests('x'.repeat(50))[0]).toHaveLength(40);
  });
});

describe('escapeLike', () => {
  it('escapes the LIKE wildcards and the escape character', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});

describe('meetingIcs', () => {
  const ics = meetingIcs({
    uid: '0190-abc@yayatoh',
    startsAt: new Date(Date.UTC(2027, 4, 10, 15, 0)),
    endsAt: new Date(Date.UTC(2027, 4, 10, 15, 15)),
    stamp: new Date(Date.UTC(2027, 4, 1, 9, 30, 5)),
    summary: 'Meeting with Ana, Lima; Peru',
    location: 'Booth 12 · table 2',
    description: 'Line one\nLine two',
  });
  it('is a valid VEVENT in UTC with CRLF line ends', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics).toContain('\r\nDTSTART:20270510T150000Z\r\n');
    expect(ics).toContain('\r\nDTEND:20270510T151500Z\r\n');
    expect(ics).toContain('\r\nDTSTAMP:20270501T093005Z\r\n');
    expect(ics).toContain('\r\nUID:0190-abc@yayatoh\r\n');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.split('\r\n').every((l) => !l.includes('\n'))).toBe(true);
  });
  it('escapes commas, semicolons, backslashes and new lines in text', () => {
    expect(ics).toContain('SUMMARY:Meeting with Ana\\, Lima\\; Peru');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two');
    expect(icsEscape('a\\b')).toBe('a\\\\b');
  });
  it('folds lines longer than 75 octets', () => {
    const long = meetingIcs({
      uid: 'u',
      startsAt: new Date(0),
      endsAt: new Date(60_000),
      stamp: new Date(0),
      summary: 'é'.repeat(80),
      location: '',
      description: '',
    });
    for (const line of long.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(long).toContain('\r\n ');
  });
});
