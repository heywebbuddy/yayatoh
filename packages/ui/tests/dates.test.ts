import { describe, expect, it } from 'vitest';
import {
  addMonths,
  compareYmd,
  dateOrder,
  formatOffset,
  formatTimeText,
  formatYmdText,
  monthGrid,
  offsetMinutes,
  parseLocalValue,
  parseTimeText,
  parseYmdText,
  toAsciiDigits,
  toLocalValue,
  utcToZoned,
  weekStart,
  ymdString,
  zonedToUtc,
} from '../src/components/dates.ts';

describe('digits and orders', () => {
  it('reads Arabic-Indic and Persian digits', () => {
    expect(toAsciiDigits('٢٠٢٦-١١-٠٥')).toBe('2026-11-05');
    expect(toAsciiDigits('۱۲:۳۰')).toBe('12:30');
  });
  it('knows each locale’s day/month/year order', () => {
    expect(dateOrder('en')).toBe('mdy');
    expect(dateOrder('de')).toBe('dmy');
    expect(dateOrder('ja')).toBe('ymd');
    expect(dateOrder('zh-CN')).toBe('ymd');
  });
  it('knows the first day of the week (0 Sunday … 6 Saturday)', () => {
    expect(weekStart('en')).toBe(0);
    expect(weekStart('de')).toBe(1);
    expect(weekStart('ar')).toBe(6);
  });
});

describe('typed dates', () => {
  it('always accepts ISO, whatever the locale', () => {
    expect(parseYmdText('2026-11-05', 'de')).toEqual({ y: 2026, m: 11, d: 5 });
    expect(parseYmdText('2026-11-05', 'en')).toEqual({ y: 2026, m: 11, d: 5 });
  });
  it('reads the locale order with any separator', () => {
    expect(parseYmdText('05.11.2026', 'de')).toEqual({ y: 2026, m: 11, d: 5 });
    expect(parseYmdText('11/5/2026', 'en')).toEqual({ y: 2026, m: 11, d: 5 });
    expect(parseYmdText('2026/11/05', 'ja')).toEqual({ y: 2026, m: 11, d: 5 });
    expect(parseYmdText('٥/١١/٢٠٢٦', 'ar')).toEqual({ y: 2026, m: 11, d: 5 });
  });
  it('rejects impossible dates and junk', () => {
    expect(parseYmdText('2026-02-30', 'en')).toBeNull();
    expect(parseYmdText('31/04/2026', 'fr')).toBeNull();
    expect(parseYmdText('soon', 'en')).toBeNull();
    expect(parseYmdText('', 'en')).toBeNull();
  });
  it('formats in the locale (Arabic digits in ar) and parses its own output back', () => {
    const ymd = { y: 2026, m: 11, d: 5 };
    for (const l of ['en', 'de', 'fr', 'ar', 'ja', 'zh-TW', 'hi', 'ru', 'nl', 'pt', 'es', 'it', 'zh-CN']) {
      expect(parseYmdText(formatYmdText(ymd, l), l), l).toEqual(ymd);
    }
    expect(formatYmdText(ymd, 'ar')).toMatch(/[٠-٩]/);
    expect(formatYmdText(ymd, 'de')).toBe('05.11.2026');
  });
});

describe('typed times', () => {
  it('reads 24 h, 12 h with am/pm, and locale digits', () => {
    expect(parseTimeText('19:05')).toEqual({ h: 19, mi: 5 });
    expect(parseTimeText('7:05 pm')).toEqual({ h: 19, mi: 5 });
    expect(parseTimeText('12:00 AM')).toEqual({ h: 0, mi: 0 });
    expect(parseTimeText('١٩:٠٥')).toEqual({ h: 19, mi: 5 });
    expect(parseTimeText('7:05 م')).toEqual({ h: 19, mi: 5 });
    expect(parseTimeText('1905')).toEqual({ h: 19, mi: 5 });
  });
  it('rejects out-of-range times', () => {
    expect(parseTimeText('25:00')).toBeNull();
    expect(parseTimeText('10:61')).toBeNull();
    expect(parseTimeText('lunch')).toBeNull();
  });
  it('formats in the locale and parses its own output back', () => {
    for (const l of ['en', 'de', 'ar', 'ja', 'hi', 'ko']) {
      expect(parseTimeText(formatTimeText({ h: 19, mi: 5 }, l)), l).toEqual({ h: 19, mi: 5 });
    }
  });
});

describe('native-compatible values', () => {
  it('round-trips date and datetime-local strings', () => {
    expect(ymdString({ y: 2026, m: 1, d: 9 })).toBe('2026-01-09');
    expect(toLocalValue({ y: 2026, m: 1, d: 9 }, { h: 7, mi: 0 })).toBe('2026-01-09T07:00');
    expect(parseLocalValue('2026-01-09T07:00')).toEqual({
      ymd: { y: 2026, m: 1, d: 9 },
      time: { h: 7, mi: 0 },
    });
    expect(parseLocalValue('2026-01-09T07:00:00')).toEqual({
      ymd: { y: 2026, m: 1, d: 9 },
      time: { h: 7, mi: 0 },
    });
    expect(parseLocalValue('2026-01-09')).toEqual({ ymd: { y: 2026, m: 1, d: 9 }, time: null });
    expect(parseLocalValue('')).toBeNull();
  });
  it('compares dates', () => {
    expect(compareYmd({ y: 2026, m: 1, d: 9 }, { y: 2026, m: 1, d: 10 })).toBeLessThan(0);
    expect(compareYmd({ y: 2026, m: 2, d: 1 }, { y: 2026, m: 1, d: 31 })).toBeGreaterThan(0);
  });
});

describe('calendar grid', () => {
  it('is six weeks starting on the locale’s first day', () => {
    const g = monthGrid(2026, 11, 1); // November 2026 starts on a Sunday
    expect(g).toHaveLength(42);
    expect(g[0]).toEqual({ y: 2026, m: 10, d: 26 });
    expect(g[6]).toEqual({ y: 2026, m: 11, d: 1 });
    const s = monthGrid(2026, 11, 0);
    expect(s[0]).toEqual({ y: 2026, m: 11, d: 1 });
  });
  it('adds months across years and clamps the day', () => {
    expect(addMonths({ y: 2026, m: 12, d: 31 }, 2)).toEqual({ y: 2027, m: 2, d: 28 });
    expect(addMonths({ y: 2026, m: 1, d: 15 }, -1)).toEqual({ y: 2025, m: 12, d: 15 });
  });
});

describe('event time zones', () => {
  it('converts a wall time in a zone to the instant and back, across DST', () => {
    const utc = zonedToUtc({ y: 2026, m: 7, d: 1 }, { h: 19, mi: 0 }, 'America/New_York');
    expect(utc.toISOString()).toBe('2026-07-01T23:00:00.000Z');
    const winter = zonedToUtc({ y: 2026, m: 12, d: 1 }, { h: 19, mi: 0 }, 'America/New_York');
    expect(winter.toISOString()).toBe('2026-12-02T00:00:00.000Z');
    expect(utcToZoned(winter, 'America/New_York')).toEqual({
      ymd: { y: 2026, m: 12, d: 1 },
      time: { h: 19, mi: 0 },
    });
    expect(zonedToUtc({ y: 2026, m: 3, d: 1 }, { h: 9, mi: 30 }, 'Asia/Kolkata').toISOString()).toBe(
      '2026-03-01T04:00:00.000Z',
    );
  });
  it('shows offsets as UTC±hh:mm', () => {
    expect(formatOffset(offsetMinutes(new Date('2026-07-01T12:00:00Z'), 'Asia/Kolkata'))).toBe('UTC+05:30');
    expect(formatOffset(offsetMinutes(new Date('2026-07-01T12:00:00Z'), 'America/New_York'))).toBe(
      'UTC−04:00',
    );
    expect(formatOffset(0)).toBe('UTC±00:00');
  });
});
