import { utcToZonedInput } from '@yayatoh/kernel';
import { describe, expect, it } from 'vitest';
import {
  type Anchors,
  conditionHolds,
  fillPlaceholders,
  MAX_ATTEMPTS,
  planStep,
  RETRY_BACKOFF_MS,
  retryAt,
  STEP_CONDITIONS,
  StepInput,
  StepsInput,
  stepDueAt,
  stepProblems,
  visionTemplate,
} from '../src/client.ts';

const TZ = 'America/Chicago';
const H = 3_600_000;
const at = (iso: string) => new Date(iso);
const anchors = (start: string, end: string, trigger = '2027-10-01T15:00:00Z'): Anchors => ({
  trigger: at(trigger),
  eventStart: at(start),
  eventEnd: at(end),
  timeZone: TZ,
});
const wait = (w: Partial<Parameters<typeof stepDueAt>[0]>) => ({
  anchor: 'event_start' as const,
  offsetDays: 0,
  offsetMinutes: 0,
  atTime: null,
  ...w,
});
const local = (d: Date) => utcToZonedInput(d, TZ);

describe('journey timing across DST in the event timezone (M3.7a)', () => {
  // Chicago falls back on 2027-11-07 (CDT → CST) and springs forward on 2027-03-14.
  const fall = anchors('2027-11-11T01:00:00Z', '2027-11-11T05:00:00Z'); // Wed 10 Nov, 19:00–23:00 CST

  it('T−7 d keeps the wall-clock time across the fall-back change (169 hours, not 168)', () => {
    const due = stepDueAt(wait({ offsetDays: -7 }), fall);
    expect(local(due)).toBe('2027-11-03T19:00');
    expect(fall.eventStart.getTime() - due.getTime()).toBe(169 * H);
  });

  it('T−7 d across the spring-forward change is 167 hours', () => {
    const spring = anchors('2027-03-21T00:00:00Z', '2027-03-21T04:00:00Z'); // Sat 20 Mar 19:00 CDT
    const due = stepDueAt(wait({ offsetDays: -7 }), spring);
    expect(local(due)).toBe('2027-03-13T19:00');
    expect(spring.eventStart.getTime() - due.getTime()).toBe(167 * H);
  });

  it('T−1 d with no DST change in between is exactly 24 hours; minutes are exact durations', () => {
    expect(fall.eventStart.getTime() - stepDueAt(wait({ offsetDays: -1 }), fall).getTime()).toBe(24 * H);
    expect(fall.eventStart.getTime() - stepDueAt(wait({ offsetMinutes: -120 }), fall).getTime()).toBe(2 * H);
    // Minutes across the change stay exact too: 24 h of minutes before a post-change start.
    const early = anchors('2027-11-07T18:00:00Z', '2027-11-07T20:00:00Z'); // Sun 7 Nov 12:00 CST
    const due = stepDueAt(wait({ offsetMinutes: -24 * 60 }), early);
    expect(early.eventStart.getTime() - due.getTime()).toBe(24 * H);
    expect(local(due)).toBe('2027-11-06T13:00'); // 13:00 CDT the day before, not 12:00
  });

  it('a wall time that does not exist moves past the gap; an ambiguous one takes the earlier instant', () => {
    // Event Mon 15 Mar 02:30 CDT; the day before, 02:30 does not exist (clocks jump 02:00 → 03:00).
    const gap = anchors('2027-03-15T07:30:00Z', '2027-03-15T09:00:00Z');
    expect(local(stepDueAt(wait({ offsetDays: -1 }), gap))).toBe('2027-03-14T03:30');
    // Event Mon 8 Nov 01:30 CST; the day before, 01:30 happens twice: the first one (CDT) wins.
    const twice = anchors('2027-11-08T07:30:00Z', '2027-11-08T09:00:00Z');
    expect(stepDueAt(wait({ offsetDays: -1 }), twice).toISOString()).toBe('2027-11-07T06:30:00.000Z');
  });

  it('at a time of day: the event-day push at 09:00 and the survey at 10:00 the morning after', () => {
    expect(stepDueAt(wait({ atTime: '09:00' }), fall).toISOString()).toBe('2027-11-10T15:00:00.000Z');
    expect(stepDueAt(wait({ anchor: 'event_end', offsetDays: 1, atTime: '10:00' }), fall).toISOString()).toBe(
      '2027-11-11T16:00:00.000Z',
    );
  });

  it('waits from the trigger: now, or minutes and days later', () => {
    expect(stepDueAt(wait({ anchor: 'trigger' }), fall)).toEqual(fall.trigger);
    expect(stepDueAt(wait({ anchor: 'trigger', offsetMinutes: 90 }), fall).getTime()).toBe(
      fall.trigger.getTime() + 1.5 * H,
    );
    expect(local(stepDueAt(wait({ anchor: 'trigger', offsetDays: 2 }), fall))).toBe('2027-10-03T10:00');
  });

  it('an unknown zone falls back to UTC days instead of throwing', () => {
    const bad = { ...fall, timeZone: 'Mars/Olympus' };
    expect(fall.eventStart.getTime() - stepDueAt(wait({ offsetDays: -7 }), bad).getTime()).toBe(168 * H);
  });
});

describe('planning a step', () => {
  const ev = anchors('2027-11-11T01:00:00Z', '2027-11-11T05:00:00Z', '2027-11-08T12:00:00Z');
  const now = at('2027-11-08T12:00:00Z'); // three days before

  it('on enrollment: future steps keep their time, past ones are skipped, trigger ones run now', () => {
    expect(planStep(wait({ offsetDays: -1 }), ev, now, 'enroll')).toEqual({
      dueAt: stepDueAt(wait({ offsetDays: -1 }), ev),
    });
    expect(planStep(wait({ offsetDays: -7 }), ev, now, 'enroll')).toEqual({ skip: 'too_late' });
    const late = { ...ev, trigger: at('2027-11-08T11:00:00Z') };
    expect(planStep(wait({ anchor: 'trigger' }), late, now, 'enroll')).toEqual({ dueAt: now });
  });

  it('on a reschedule: past-due runs now while its anchor is ahead, else it is too late', () => {
    expect(planStep(wait({ offsetDays: -7 }), ev, now, 'reschedule')).toEqual({ dueAt: now });
    const after = at('2027-11-12T00:00:00Z');
    expect(planStep(wait({ offsetDays: -1 }), ev, after, 'reschedule')).toEqual({ skip: 'too_late' });
    // A step after the end whose time passed still runs (the survey after a date moved earlier).
    const survey = wait({ anchor: 'event_end', offsetMinutes: 60 });
    expect(planStep(survey, ev, after, 'reschedule')).toEqual({ dueAt: after });
  });

  it('retries back off 1, 5, 15, 60 minutes and give up after five attempts', () => {
    const t = at('2027-01-01T00:00:00Z');
    expect([1, 2, 3, 4, 9].map((n) => (retryAt(n, t).getTime() - t.getTime()) / 60_000)).toEqual([
      1, 5, 15, 60, 60,
    ]);
    expect(MAX_ATTEMPTS).toBe(RETRY_BACKOFF_MS.length + 1);
  });
});

describe('conditions', () => {
  const facts = { checkedIn: true, hasSeat: false, answeredSurvey: false };
  it.each([
    ['checked_in', true],
    ['not_checked_in', false],
    ['has_seat', false],
    ['no_seat', true],
    ['answered_survey', false],
    ['not_answered_survey', true],
  ] as const)('%s → %s', (c, expected) => {
    expect(conditionHolds(c, facts)).toBe(expected);
  });
  it('no condition always holds; a missing fact counts as false', () => {
    expect(conditionHolds(null, {})).toBe(true);
    for (const c of STEP_CONDITIONS)
      expect(conditionHolds(c, {})).toBe(c.startsWith('not_') || c === 'no_seat');
  });
});

describe('step rules', () => {
  const email = { anchor: 'trigger', action: 'email', subject: 'Hi', body: 'Thanks!' } as const;

  it('message steps need a subject and a body; label steps a label; copy is tidied', () => {
    expect(StepInput.safeParse({ ...email, subject: '  ' }).error?.issues[0]?.path).toEqual(['subject']);
    expect(StepInput.safeParse({ ...email, body: null }).error?.issues[0]?.path).toEqual(['body']);
    expect(StepInput.safeParse({ anchor: 'trigger', action: 'label' }).error?.issues[0]?.path).toEqual([
      'label',
    ]);
    const ok = StepInput.parse({ ...email, subject: '  Hi   there ', label: 'ignored' });
    expect(ok).toMatchObject({
      subject: 'Hi there',
      offsetDays: 0,
      offsetMinutes: 0,
      atTime: null,
      condition: null,
    });
    expect(StepInput.parse({ anchor: 'event_end', action: 'survey' }).subject).toBeNull();
  });

  it('waits: never before the trigger, days and minutes in one direction, a valid time of day', () => {
    expect(StepInput.safeParse({ ...email, offsetDays: -1 }).success).toBe(false);
    expect(
      StepInput.safeParse({ ...email, anchor: 'event_start', offsetDays: -1, offsetMinutes: 30 }).success,
    ).toBe(false);
    expect(
      StepInput.safeParse({ ...email, anchor: 'event_start', offsetDays: -1, offsetMinutes: -30 }).success,
    ).toBe(true);
    expect(StepInput.safeParse({ ...email, atTime: '24:00' }).success).toBe(false);
    expect(StepInput.safeParse({ ...email, offsetDays: 366 }).success).toBe(false);
    expect(StepsInput.safeParse(Array.from({ length: 21 }, () => email)).success).toBe(false);
  });

  it('a journey at a time relative to the event has no trigger moment to wait from', () => {
    const steps = StepsInput.parse([email, { ...email, anchor: 'event_start' }]);
    expect(stepProblems('event_time', steps)).toEqual([{ index: 0, field: 'anchor' }]);
    expect(stepProblems('order_paid', steps)).toEqual([]);
  });

  it('placeholders are filled per person; unknown braces stay', () => {
    expect(
      fillPlaceholders('Hi {name}, {event} is {when}. {other}', {
        name: 'Ana',
        event: 'Gala',
        when: 'Friday',
      }),
    ).toBe('Hi Ana, Gala is Friday. {other}');
  });

  it('the vision journey: purchase → confirmation, T−7 d, T−24 h text, event-day push, survey', () => {
    const copy = { subject: 'S', body: 'B' };
    const t = visionTemplate({ confirmation: copy, week: copy, day: copy, eventDay: copy });
    expect(t.trigger).toBe('order_paid');
    const steps = StepsInput.parse(t.steps);
    expect(steps.map((s) => [s.anchor, s.offsetDays, s.atTime, s.action])).toEqual([
      ['trigger', 0, null, 'email'],
      ['event_start', -7, null, 'email'],
      ['event_start', -1, null, 'sms'],
      ['event_start', 0, '09:00', 'push'],
      ['event_end', 1, '10:00', 'survey'],
    ]);
    expect(stepProblems(t.trigger, steps)).toEqual([]);
  });
});
