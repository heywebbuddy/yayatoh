import { describe, expect, it } from 'vitest';
import { fixPath, RULES } from '../src/domain/config.ts';
import { type EventFacts, evaluateEventRules, type SocialEventFacts } from '../src/domain/rules.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = new Date('2030-05-01T12:00:00Z');
const at = (ms: number) => new Date(now.getTime() + ms);

const social: SocialEventFacts = {
  rsvpDeadline: null,
  rsvpPending: 0,
  rsvpPendingParties: 0,
  guestsUnseated: null,
  mealsMissing: null,
};
const wedding = (s: Partial<SocialEventFacts>, startsIn = 30 * DAY, status = 'published'): EventFacts => ({
  startsAt: at(startsIn),
  endsAt: at(startsIn + 8 * HOUR),
  status,
  publishedAt: null,
  unseated: null,
  undistributed: 0,
  activeTickets: 0,
  failedPayments: 0,
  stuckPayments: 0,
  recentRefunds: 0,
  devicesOffline: 0,
  devicesLowBattery: 0,
  devicesBacklog: 0,
  capacity: 0,
  sold: 0,
  admitted: 0,
  salesTarget: null,
  ticketTypes: 1,
  assistanceOverdue: 0,
  assistanceUrgent: 0,
  social: { ...social, ...s },
});

describe('RSVP pending (M4.6a): deadline −7 d and −1 d', () => {
  const pending = { rsvpPending: 42, rsvpPendingParties: 17 };

  it('nothing before deadline −7 d, nor without a deadline', () => {
    expect(evaluateEventRules(wedding({ ...pending, rsvpDeadline: at(8 * DAY) }), now)).toEqual({});
    expect(evaluateEventRules(wedding({ ...pending }), now)).toEqual({});
  });

  it('a warning from deadline −7 d, critical from −1 d, counting guests', () => {
    expect(evaluateEventRules(wedding({ ...pending, rsvpDeadline: at(7 * DAY) }), now).rsvpPending).toEqual({
      severity: 'warning',
      count: 42,
      params: { count: 42, parties: 17, days: 7 },
      liveCritical: false,
    });
    expect(evaluateEventRules(wedding({ ...pending, rsvpDeadline: at(DAY) }), now).rsvpPending?.severity).toBe(
      'critical',
    );
    // Past the deadline it stays critical until the event starts.
    const past = evaluateEventRules(wedding({ ...pending, rsvpDeadline: at(-DAY) }), now).rsvpPending;
    expect(past?.severity).toBe('critical');
    expect(past?.params.days).toBe(0);
    expect(evaluateEventRules(wedding({ ...pending, rsvpDeadline: at(-DAY) }, -HOUR), now).rsvpPending).toBeUndefined();
  });

  it('clears when everyone has answered; cancelled events raise nothing', () => {
    expect(evaluateEventRules(wedding({ rsvpDeadline: at(DAY), rsvpPending: 0 }), now)).toEqual({});
    expect(
      evaluateEventRules(wedding({ ...pending, rsvpDeadline: at(DAY) }, 30 * DAY, 'cancelled'), now),
    ).toEqual({});
  });
});

describe('guests without a table and missing meals (M4.6a)', () => {
  it('unseated: only with a guest chart, in the last 7 days (critical in the last day and while live)', () => {
    expect(evaluateEventRules(wedding({ guestsUnseated: 3 }, 8 * DAY), now)).toEqual({});
    expect(evaluateEventRules(wedding({ guestsUnseated: null }, 2 * DAY), now)).toEqual({});
    expect(evaluateEventRules(wedding({ guestsUnseated: 3 }, 7 * DAY), now).guestsUnseated?.severity).toBe('warning');
    expect(evaluateEventRules(wedding({ guestsUnseated: 3 }, 12 * HOUR), now).guestsUnseated?.severity).toBe(
      'critical',
    );
    expect(evaluateEventRules(wedding({ guestsUnseated: 3 }, -HOUR), now).guestsUnseated).toMatchObject({
      severity: 'critical',
      count: 3,
    });
    expect(evaluateEventRules(wedding({ guestsUnseated: 0 }, DAY), now)).toEqual({});
  });

  it('meals: attending guests without a meal when there is a menu, in the last 7 days', () => {
    expect(evaluateEventRules(wedding({ mealsMissing: 5 }, 8 * DAY), now)).toEqual({});
    expect(evaluateEventRules(wedding({ mealsMissing: 5 }, 6 * DAY), now).mealsMissing).toMatchObject({
      severity: 'warning',
      count: 5,
    });
    expect(evaluateEventRules(wedding({ mealsMissing: null }, 6 * DAY), now)).toEqual({});
    expect(evaluateEventRules(wedding({ mealsMissing: 5 }, -HOUR), now).mealsMissing).toBeUndefined();
  });

  it('each links to the page that fixes it and needs guests:read', () => {
    expect(fixPath('rsvpPending', 'w')).toBe('/e/w/guests/rsvp');
    expect(fixPath('guestsUnseated', 'w')).toBe('/e/w/seating/guests');
    expect(fixPath('mealsMissing', 'w')).toBe('/e/w/guests/answers');
    for (const k of ['rsvpPending', 'guestsUnseated', 'mealsMissing'] as const) {
      expect(RULES[k]).toMatchObject({ scope: 'event', category: 'attendees', permission: 'guests:read' });
    }
  });
});
