import { describe, expect, it } from 'vitest';
import { planStep, stepDueAt } from '../src/index.ts';

/** M4.1f: RSVP reminder steps wait from the deadline, in the event's zone, DST-safe. */
describe('rsvp_deadline anchor', () => {
  const anchors = {
    trigger: new Date('2030-03-01T12:00:00Z'),
    eventStart: new Date('2030-06-01T20:00:00Z'),
    eventEnd: new Date('2030-06-02T04:00:00Z'),
    timeZone: 'America/Chicago',
    // April 15, 23:00 in Chicago (CDT).
    rsvpDeadline: new Date('2030-04-16T04:00:00Z'),
  };
  const wait = (days: number) => ({
    anchor: 'rsvp_deadline' as const,
    offsetDays: -days,
    offsetMinutes: 0,
    atTime: null,
  });

  it('is due N calendar days before the deadline at its wall-clock time, across DST', () => {
    expect(stepDueAt(wait(3), anchors).toISOString()).toBe('2030-04-13T04:00:00.000Z');
    // 14 days before 23:00 CDT on April 15 is 23:00 CDT on April 1.
    expect(stepDueAt(wait(14), anchors).toISOString()).toBe('2030-04-02T04:00:00.000Z');
    // 40 days before crosses the March DST change: still 23:00 local (CST = UTC-6).
    expect(stepDueAt(wait(40), anchors).toISOString()).toBe('2030-03-07T05:00:00.000Z');
  });

  it('is skipped without a deadline, and too late once its time passed on enrollment', () => {
    expect(planStep(wait(3), { ...anchors, rsvpDeadline: null }, anchors.trigger, 'enroll')).toEqual({
      skip: 'no_deadline',
    });
    expect(planStep(wait(14), anchors, new Date('2030-04-10T00:00:00Z'), 'enroll')).toEqual({
      skip: 'too_late',
    });
    expect(planStep(wait(3), anchors, new Date('2030-04-10T00:00:00Z'), 'enroll')).toEqual({
      dueAt: new Date('2030-04-13T04:00:00.000Z'),
    });
  });
});
