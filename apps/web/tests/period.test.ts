import { describe, expect, it } from 'vitest';
import { localDay, resolvePeriod } from '../src/lib/period.ts';

// 02:30 UTC on 1 March is still 28 February in Chicago.
const now = new Date('2027-03-01T02:30:00Z');
const tz = 'America/Chicago';

describe('report periods (M1.12b)', () => {
  it("uses the org's timezone for today", () => {
    expect(localDay(now, tz)).toBe('2027-02-28');
    expect(localDay(now, 'Europe/Paris')).toBe('2027-03-01');
  });

  it('resolves presets to inclusive calendar days', () => {
    expect(resolvePeriod({ period: '7d' }, tz, now)).toEqual({
      period: '7d',
      from: '2027-02-22',
      to: '2027-02-28',
    });
    expect(resolvePeriod({}, tz, now)).toEqual({ period: '30d', from: '2027-01-30', to: '2027-02-28' });
    expect(resolvePeriod({ period: 'month' }, tz, now)).toEqual({
      period: 'month',
      from: '2027-02-01',
      to: '2027-02-28',
    });
    expect(resolvePeriod({ period: 'year' }, tz, now)).toEqual({
      period: 'year',
      from: '2027-01-01',
      to: '2027-02-28',
    });
    expect(resolvePeriod({ period: 'all' }, tz, now)).toEqual({ period: 'all' });
    expect(resolvePeriod({ period: 'bogus' }, tz, now).period).toBe('30d');
  });

  it('accepts custom days and refuses a backwards or invalid range', () => {
    expect(resolvePeriod({ period: 'custom', from: '2026-12-01', to: '2026-12-31' }, tz, now)).toEqual({
      period: 'custom',
      from: '2026-12-01',
      to: '2026-12-31',
    });
    expect(resolvePeriod({ period: 'custom', from: '2027-01-10', to: '2027-01-01' }, tz, now)).toMatchObject({
      period: '30d',
      error: 'badRange',
    });
    expect(resolvePeriod({ period: 'custom', from: '2027-02-30', to: '2027-03-01' }, tz, now)).toMatchObject({
      error: 'badDate',
    });
    expect(resolvePeriod({ period: 'custom' }, tz, now).error).toBe('badDate');
  });
});
