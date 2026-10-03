import { describe, expect, it } from 'vitest';
import {
  bucketize,
  bucketOf,
  daysBetween,
  defaultGrain,
  MAX_BUCKETS,
  previousPeriod,
} from '../src/money-buckets.ts';

describe('money buckets (U5)', () => {
  it('puts a day in its day, ISO week (Monday) or month', () => {
    // Sunday 8 November 2026 belongs to the week starting Monday 2 November.
    expect(bucketOf('2026-11-08', 'week')).toBe('2026-11-02');
    expect(bucketOf('2026-11-02', 'week')).toBe('2026-11-02');
    expect(bucketOf('2026-11-08', 'month')).toBe('2026-11-01');
    expect(bucketOf('2026-11-08', 'day')).toBe('2026-11-08');
    // A week can start in the previous year.
    expect(bucketOf('2027-01-01', 'week')).toBe('2026-12-28');
  });

  it('fills every bucket in the period with zeros and sums rows into theirs', () => {
    const rows = [
      { day: '2026-11-03', gross: 1000, fees: 100 },
      { day: '2026-11-08', gross: 500, fees: 50 },
      { day: '2026-11-10', gross: 1, fees: 0 },
      // Outside the period: ignored.
      { day: '2026-10-31', gross: 99, fees: 9 },
    ];
    expect(bucketize(rows, ['gross', 'fees'], 'week', '2026-11-01', '2026-11-14')).toEqual([
      { start: '2026-10-26', gross: 0, fees: 0 },
      { start: '2026-11-02', gross: 1500, fees: 150 },
      { start: '2026-11-09', gross: 1, fees: 0 },
    ]);
    const days = bucketize(rows, ['gross'], 'day', '2026-11-01', '2026-11-04');
    expect(days.map((d) => d.start)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
    expect(days.map((d) => d.gross)).toEqual([0, 0, 1000, 0]);
    expect(bucketize(rows, ['gross'], 'month', '2026-10-15', '2027-01-02').map((d) => d.start)).toEqual([
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
    ]);
  });

  it('keeps at most MAX_BUCKETS, dropping the oldest', () => {
    const b = bucketize([], ['gross'], 'day', '2020-01-01', '2026-01-01');
    expect(b).toHaveLength(MAX_BUCKETS);
    expect(b.at(-1)?.start).toBe('2026-01-01');
  });

  it('compares with the period of the same length just before', () => {
    expect(previousPeriod('2026-11-01', '2026-11-30')).toEqual({ from: '2026-10-02', to: '2026-10-31' });
    expect(previousPeriod('2026-03-01', '2026-03-01')).toEqual({ from: '2026-02-28', to: '2026-02-28' });
    expect(daysBetween('2026-11-01', '2026-11-30')).toBe(30);
  });

  it('picks a readable grain for the period', () => {
    expect(defaultGrain('2026-11-01', '2026-11-30')).toBe('day');
    expect(defaultGrain('2026-08-01', '2026-11-30')).toBe('week');
    expect(defaultGrain('2026-01-01', '2026-11-30')).toBe('month');
    expect(defaultGrain(undefined, '2026-11-30')).toBe('month');
  });
});
