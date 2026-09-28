import { describe, expect, it } from 'vitest';
import { planReminder, reminderTime } from '../src/reminder-time.ts';

const at = (iso: string) => new Date(iso);

describe('reminderTime: the day before, same wall-clock time in the event timezone', () => {
  it('is exactly 24 h before when no DST change is involved', () => {
    expect(reminderTime(at('2030-06-01T23:00:00Z'), 'UTC').toISOString()).toBe('2030-05-31T23:00:00.000Z');
    // 19:00 in Chicago (CDT, UTC-5) → 19:00 the evening before.
    expect(reminderTime(at('2030-06-02T00:00:00Z'), 'America/Chicago').toISOString()).toBe(
      '2030-06-01T00:00:00.000Z',
    );
  });

  it('is 23 h before across spring forward (US: 2027-03-14)', () => {
    // Show at 19:00 CDT on Mar 14 (00:00Z Mar 15); the evening before is 19:00 CST (01:00Z Mar 14).
    const r = reminderTime(at('2027-03-15T00:00:00Z'), 'America/Chicago');
    expect(r.toISOString()).toBe('2027-03-14T01:00:00.000Z');
    expect((at('2027-03-15T00:00:00Z').getTime() - r.getTime()) / 3_600_000).toBe(23);
  });

  it('is 25 h before across fall back (EU: 2027-10-31)', () => {
    // 20:00 CET on Oct 31 (19:00Z); the evening before is 20:00 CEST (18:00Z Oct 30).
    const r = reminderTime(at('2027-10-31T19:00:00Z'), 'Europe/Paris');
    expect(r.toISOString()).toBe('2027-10-30T18:00:00.000Z');
    expect((at('2027-10-31T19:00:00Z').getTime() - r.getTime()) / 3_600_000).toBe(25);
  });

  it('moves forward when the wall time does not exist the day before (spring-forward gap)', () => {
    // 02:30 on Mar 15 in New York; 02:30 on Mar 14 does not exist → 03:30 EDT (07:30Z).
    const r = reminderTime(at('2027-03-15T06:30:00Z'), 'America/New_York');
    expect(r.toISOString()).toBe('2027-03-14T07:30:00.000Z');
  });

  it('takes the earlier instant when the wall time happens twice (fall-back overlap)', () => {
    // 01:30 on Nov 8 in New York (EST, 06:30Z); 01:30 on Nov 7 happens twice → the EDT one (05:30Z).
    const r = reminderTime(at('2027-11-08T06:30:00Z'), 'America/New_York');
    expect(r.toISOString()).toBe('2027-11-07T05:30:00.000Z');
  });

  it('falls back to 24 h for an unknown timezone', () => {
    expect(reminderTime(at('2030-06-01T23:00:00Z'), 'Not/AZone').toISOString()).toBe(
      '2030-05-31T23:00:00.000Z',
    );
  });
});

describe('planReminder: where a queued reminder goes after a reschedule', () => {
  const now = at('2030-06-01T12:00:00Z');
  it('moves to the new reminder time', () => {
    expect(planReminder({ startsAt: at('2030-06-10T18:00:00Z'), timeZone: 'UTC' }, now)).toEqual({
      sendAfter: at('2030-06-09T18:00:00Z'),
    });
  });
  it('goes out now when the new start is less than a day away', () => {
    expect(planReminder({ startsAt: at('2030-06-02T06:00:00Z'), timeZone: 'UTC' }, now)).toEqual({
      sendAfter: now,
    });
  });
  it('is cancelled when the event already started, was cancelled, or parked while postponed', () => {
    expect(planReminder({ startsAt: at('2030-06-01T11:00:00Z'), timeZone: 'UTC' }, now)).toEqual({
      cancel: 'event_started',
    });
    expect(
      planReminder({ startsAt: at('2030-06-10T18:00:00Z'), timeZone: 'UTC', cancelled: true }, now),
    ).toEqual({ cancel: 'event_cancelled' });
    expect(
      planReminder({ startsAt: at('2030-06-10T18:00:00Z'), timeZone: 'UTC', postponed: true }, now),
    ).toEqual({ cancel: 'event_postponed' });
  });
});
