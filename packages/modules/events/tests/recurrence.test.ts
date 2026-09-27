import { utcToZonedInput } from '@yayatoh/kernel';
import { describe, expect, it } from 'vitest';
import {
  expandRecurrence,
  MAX_OCCURRENCES,
  type RecurrenceRule,
  retimeLocal,
} from '../src/domain/recurrence.ts';

const weekly = (over: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  startDate: '2027-02-25',
  startTime: '19:00',
  endTime: '22:00',
  freq: 'weekly',
  interval: 1,
  byWeekday: [4],
  count: 4,
  ...over,
});
const local = (d: Date, tz: string) => utcToZonedInput(d, tz);
const problem = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as { code: string; details: { reason: string; field: string } }).details;
  }
  return null;
};

describe('recurrence expansion', () => {
  it('keeps 7 pm local across the US spring-forward (America/Chicago, 14 March 2027)', () => {
    const dates = expandRecurrence(weekly({ count: 4 }), 'America/Chicago');
    expect(dates.map((d) => d.localDate)).toEqual(['2027-02-25', '2027-03-04', '2027-03-11', '2027-03-18']);
    for (const d of dates) {
      expect(local(d.startsAt, 'America/Chicago').slice(11)).toBe('19:00');
      expect(local(d.endsAt, 'America/Chicago').slice(11)).toBe('22:00');
    }
    // CST is UTC−6, CDT UTC−5: the instant moves, the wall clock does not.
    expect(dates[2]?.startsAt.toISOString()).toBe('2027-03-12T01:00:00.000Z');
    expect(dates[3]?.startsAt.toISOString()).toBe('2027-03-19T00:00:00.000Z');
  });

  it('keeps 7 pm local across the UK clocks going back (Europe/London, 31 October 2027)', () => {
    const dates = expandRecurrence(
      weekly({ startDate: '2027-10-17', byWeekday: [7], count: 3 }),
      'Europe/London',
    );
    expect(dates.map((d) => d.localDate)).toEqual(['2027-10-17', '2027-10-24', '2027-10-31']);
    expect(dates[1]?.startsAt.toISOString()).toBe('2027-10-24T18:00:00.000Z'); // BST
    expect(dates[2]?.startsAt.toISOString()).toBe('2027-10-31T19:00:00.000Z'); // GMT
  });

  it('daily events in a DST gap move forward; overnight events end the next day', () => {
    const gap = expandRecurrence(
      { ...weekly(), freq: 'daily', startDate: '2027-03-13', startTime: '02:30', endTime: '04:00', count: 3 },
      'America/Chicago',
    );
    // 02:30 does not exist on 14 March: it becomes 03:30 CDT.
    expect(local(gap[1]?.startsAt as Date, 'America/Chicago')).toBe('2027-03-14T03:30');
    expect(local(gap[2]?.startsAt as Date, 'America/Chicago')).toBe('2027-03-15T02:30');
    const overnight = expandRecurrence(
      weekly({ startTime: '22:00', endTime: '02:00', count: 1 }),
      'America/Chicago',
    );
    expect(local(overnight[0]?.endsAt as Date, 'America/Chicago')).toBe('2027-02-26T02:00');
  });

  it('weekly on several weekdays every other week, up to an end date (inclusive)', () => {
    const dates = expandRecurrence(
      weekly({ startDate: '2027-01-04', byWeekday: [5, 1], interval: 2, count: null, until: '2027-01-29' }),
      'Europe/London',
    );
    expect(dates.map((d) => d.localDate)).toEqual(['2027-01-04', '2027-01-08', '2027-01-18', '2027-01-22']);
  });

  it('does not produce dates before the first day', () => {
    // First day is a Wednesday; Monday of that week is skipped.
    const dates = expandRecurrence(
      weekly({ startDate: '2027-01-06', byWeekday: [1, 3], count: 3 }),
      'Europe/London',
    );
    expect(dates.map((d) => d.localDate)).toEqual(['2027-01-06', '2027-01-11', '2027-01-13']);
  });

  it('monthly on the 31st skips months without one; the count counts real dates', () => {
    const dates = expandRecurrence(
      weekly({ freq: 'monthly', startDate: '2027-01-31', byMonthDay: 31, count: 4 }),
      'America/Chicago',
    );
    expect(dates.map((d) => d.localDate)).toEqual(['2027-01-31', '2027-03-31', '2027-05-31', '2027-07-31']);
    const leap = expandRecurrence(
      weekly({ freq: 'monthly', startDate: '2028-01-29', byMonthDay: 29, interval: 1, count: 2 }),
      'America/Chicago',
    );
    expect(leap.map((d) => d.localDate)).toEqual(['2028-01-29', '2028-02-29']);
  });

  it('monthly with an interval crosses year boundaries', () => {
    const dates = expandRecurrence(
      weekly({ freq: 'monthly', startDate: '2027-11-15', byMonthDay: 15, interval: 3, count: 3 }),
      'Europe/London',
    );
    expect(dates.map((d) => d.localDate)).toEqual(['2027-11-15', '2028-02-15', '2028-05-15']);
  });

  it('a daily rule for a whole leap year hits exactly the limit', () => {
    const dates = expandRecurrence(
      { ...weekly(), freq: 'daily', startDate: '2028-01-01', count: null, until: '2028-12-31' },
      'Europe/London',
    );
    expect(dates).toHaveLength(MAX_OCCURRENCES);
  });

  it('refuses rules that are too long, endless, contradictory or invalid', () => {
    expect(problem(() => expandRecurrence(weekly({ count: 367 }), 'UTC'))).toMatchObject({
      reason: 'too_many',
      field: 'count',
    });
    expect(
      problem(() =>
        expandRecurrence(
          { ...weekly(), freq: 'daily', count: null, until: '2028-12-31', startDate: '2027-01-01' },
          'UTC',
        ),
      ),
    ).toMatchObject({ reason: 'too_many', field: 'until' });
    expect(problem(() => expandRecurrence(weekly({ count: null }), 'UTC'))).toMatchObject({
      reason: 'no_end',
    });
    expect(problem(() => expandRecurrence(weekly({ until: '2027-03-30' }), 'UTC'))).toMatchObject({
      reason: 'both_ends',
    });
    expect(
      problem(() => expandRecurrence(weekly({ count: null, until: '2027-01-01' }), 'UTC')),
    ).toMatchObject({ reason: 'until_before_start', field: 'until' });
    expect(
      problem(() => expandRecurrence(weekly({ count: null, until: '2033-01-01', interval: 52 }), 'UTC')),
    ).toMatchObject({ reason: 'too_far' });
    expect(problem(() => expandRecurrence(weekly({ startDate: '2027-02-30' }), 'UTC'))).toMatchObject({
      reason: 'invalid_date',
      field: 'startDate',
    });
    expect(problem(() => expandRecurrence(weekly({ startTime: '25:00' }), 'UTC'))).toMatchObject({
      reason: 'invalid_time',
    });
    expect(problem(() => expandRecurrence(weekly({ interval: 0 }), 'UTC'))).toMatchObject({
      reason: 'invalid_interval',
    });
    expect(problem(() => expandRecurrence(weekly({ byWeekday: [8] }), 'UTC'))).toMatchObject({
      reason: 'invalid_weekday',
    });
    expect(
      problem(() =>
        expandRecurrence(
          weekly({
            freq: 'monthly',
            byMonthDay: 31,
            startDate: '2027-04-01',
            count: null,
            until: '2027-04-30',
          }),
          'UTC',
        ),
      ),
    ).toMatchObject({ reason: 'no_dates' });
  });
});

describe('retimeLocal (this and following)', () => {
  it('keeps each date and applies the new wall-clock times across DST', () => {
    const dates = expandRecurrence(weekly({ startDate: '2027-03-11', count: 2 }), 'America/Chicago');
    expect(dates).toHaveLength(2);
    for (const o of dates) {
      const r = retimeLocal(o.startsAt, 'America/Chicago', '20:00', '23:30');
      expect(local(r.startsAt, 'America/Chicago').slice(11)).toBe('20:00');
      expect(local(r.endsAt, 'America/Chicago').slice(11)).toBe('23:30');
      expect(local(r.startsAt, 'America/Chicago').slice(0, 10)).toBe(
        local(o.startsAt, 'America/Chicago').slice(0, 10),
      );
    }
  });
});
