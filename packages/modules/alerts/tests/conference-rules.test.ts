import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTING, fixPath, RULES, THRESHOLDS } from '../src/domain/config.ts';
import {
  type ConferenceFacts,
  type EventFacts,
  evaluateEventRules,
  roomTooSmall,
  sessionNearlyFull,
} from '../src/domain/rules.ts';

/**
 * M5.9a conference pack rules (pure): sessions ≥ 95 % full, long session lines, rooms smaller than
 * enrollment, exhibitors without leads or people, overdue speaker tasks and sponsor deliverables,
 * printers or kiosks offline, the approval backlog and overdue invoices.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = new Date('2030-05-01T12:00:00Z');
const at = (ms: number) => new Date(now.getTime() + ms);

const session = (
  s: Partial<ConferenceFacts['sessions'][number]> = {},
): ConferenceFacts['sessions'][number] => ({
  capacity: 100,
  enrolled: 10,
  roomCapacity: 200,
  inRoom: 0,
  running: false,
  waiting: 0,
  ...s,
});

const calm: ConferenceFacts = {
  sessions: [session(), session()],
  exhibitors: [
    { people: 2, leads: 4 },
    { people: 1, leads: 1 },
  ],
  speakerTasksOverdue: 0,
  speakersOverdue: 0,
  deliverablesOverdue: 0,
  printersOffline: 0,
  kiosksOffline: 0,
  approvalsPending: 0,
  oldestApplicationAt: null,
  invoicesOverdue: 0,
};

const base: EventFacts = {
  startsAt: at(20 * DAY),
  endsAt: at(22 * DAY),
  status: 'published',
  publishedAt: at(-10 * DAY),
  unseated: null,
  undistributed: 0,
  activeTickets: 200,
  failedPayments: 0,
  stuckPayments: 0,
  recentRefunds: 0,
  devicesOffline: 0,
  devicesLowBattery: 0,
  devicesBacklog: 0,
  capacity: 1000,
  sold: 200,
  admitted: 0,
  salesTarget: null,
  ticketTypes: 2,
  assistanceOverdue: 0,
  assistanceUrgent: 0,
};
const LIVE = { startsAt: at(-HOUR), endsAt: at(8 * HOUR) };
const PRE_SHOW = { startsAt: at(12 * HOUR), endsAt: at(20 * HOUR) };
const SOON = { startsAt: at(3 * DAY), endsAt: at(4 * DAY) };

const fired = (c: Partial<ConferenceFacts>, e: Partial<EventFacts> = {}) =>
  evaluateEventRules({ ...base, ...e, conference: { ...calm, ...c } }, now);

describe('conference pack rules (M5.9a)', () => {
  it('a calm conference raises nothing, in any mode', () => {
    for (const e of [{}, SOON, PRE_SHOW, LIVE]) expect(fired({}, e)).toEqual({});
  });

  it('no conference facts (an event without a program) raises nothing from the pack', () => {
    expect(evaluateEventRules({ ...base, ...LIVE }, now)).toEqual({});
  });

  it('acceptance: exactly 3 sessions at or over 95 % raise "3 sessions are over 95 % capacity"', () => {
    const r = fired({
      sessions: [
        session({ capacity: 40, enrolled: 38 }), // 95 % exactly
        session({ capacity: 40, enrolled: 40 }), // full
        session({ capacity: 100, enrolled: 99 }),
        session({ capacity: 100, enrolled: 94 }), // 94 %: not yet
        session({ capacity: null, enrolled: 150 }), // no limit
      ],
    });
    expect(Object.keys(r)).toEqual(['sessionsNearCapacity']);
    expect(r.sessionsNearCapacity).toMatchObject({
      severity: 'warning',
      count: 3,
      params: { count: 3, full: 1 },
    });
    // Fixed (places added): it no longer fires.
    expect(fired({ sessions: [session({ capacity: 60, enrolled: 38 })] })).toEqual({});
  });

  it('a running session counts people in the room against its places, else its room', () => {
    const inRoom = session({ capacity: null, roomCapacity: 50, enrolled: 0, inRoom: 48, running: true });
    expect(sessionNearlyFull(inRoom)).toBe(true);
    expect(sessionNearlyFull({ ...inRoom, running: false })).toBe(false);
    expect(sessionNearlyFull({ ...inRoom, inRoom: 47 })).toBe(false);
    expect(sessionNearlyFull(session({ capacity: 20, roomCapacity: 50, inRoom: 19, running: true }))).toBe(
      true,
    );
    expect(
      sessionNearlyFull(session({ capacity: null, roomCapacity: null, inRoom: 900, running: true })),
    ).toBe(false);
  });

  it('a line longer than the threshold raises the waitlist alert with the longest line', () => {
    expect(fired({ sessions: [session({ waiting: THRESHOLDS.waitlistMax })] })).toEqual({});
    const r = fired({
      sessions: [session({ waiting: 11 }), session({ waiting: 30 }), session({ waiting: 2 })],
    });
    expect(r.sessionWaitlists).toMatchObject({ count: 2, params: { longest: 30, max: 10 } });
  });

  it('a session holding more places than its room seats raises "rooms too small"', () => {
    expect(roomTooSmall(session({ enrolled: 81, roomCapacity: 80 }))).toBe(true);
    expect(roomTooSmall(session({ enrolled: 80, roomCapacity: 80 }))).toBe(false);
    expect(roomTooSmall(session({ enrolled: 81, roomCapacity: null }))).toBe(false);
    expect(fired({ sessions: [session({ enrolled: 90, roomCapacity: 80 })] }).roomsTooSmall).toMatchObject({
      count: 1,
    });
  });

  it('acceptance: exactly 5 exhibitors without leads while live; none before; quiet without a lead source', () => {
    const exhibitors = [
      ...Array.from({ length: 5 }, () => ({ people: 2, leads: 0 })),
      { people: 2, leads: 3 },
      { people: 1, leads: 1 },
    ];
    const r = fired({ exhibitors }, LIVE);
    expect(r.exhibitorsNoLeads).toMatchObject({ severity: 'warning', count: 5, params: { exhibitors: 7 } });
    expect(fired({ exhibitors }, PRE_SHOW).exhibitorsNoLeads).toBeUndefined();
    expect(fired({ exhibitors: exhibitors.map((e) => ({ ...e, leads: null })) }, LIVE)).toEqual({});
    // Fixed (each has a lead): clears.
    expect(fired({ exhibitors: exhibitors.map((e) => ({ ...e, leads: 1 })) }, LIVE)).toEqual({});
  });

  it('exhibitors without people are raised from 7 days before and while live, not earlier', () => {
    const exhibitors = [
      { people: 0, leads: 1 },
      { people: 0, leads: 1 },
      { people: 3, leads: 1 },
    ];
    expect(fired({ exhibitors }).exhibitorsNoStaff).toBeUndefined();
    expect(fired({ exhibitors }, SOON).exhibitorsNoStaff).toMatchObject({
      count: 2,
      params: { exhibitors: 3 },
    });
    expect(fired({ exhibitors }, LIVE).exhibitorsNoStaff).toMatchObject({ count: 2 });
  });

  it('overdue speaker tasks and sponsor deliverables raise their own alerts; an unconnected source is quiet', () => {
    const r = fired({ speakerTasksOverdue: 4, speakersOverdue: 3, deliverablesOverdue: 2 });
    expect(r.speakerTasksOverdue).toMatchObject({ count: 4, params: { speakers: 3 } });
    expect(r.deliverablesOverdue).toMatchObject({ count: 2 });
    expect(fired({ deliverablesOverdue: null })).toEqual({});
  });

  it('printers or kiosks offline: around the event only, live-critical while the doors are open', () => {
    expect(fired({ printersOffline: 1, kiosksOffline: 2 })).toEqual({});
    expect(fired({ printersOffline: 1, kiosksOffline: 2 }, PRE_SHOW).printersKiosksOffline).toMatchObject({
      severity: 'warning',
      count: 3,
      params: { printers: 1, kiosks: 2 },
      liveCritical: false,
    });
    expect(fired({ printersOffline: null, kiosksOffline: 1 }, LIVE).printersKiosksOffline).toMatchObject({
      severity: 'critical',
      count: 1,
      params: { printers: 0, kiosks: 1 },
      liveCritical: true,
    });
  });

  it('approval backlog: from 10 waiting, or any application older than 48 hours', () => {
    expect(fired({ approvalsPending: 9, oldestApplicationAt: at(-47 * HOUR) })).toEqual({});
    expect(fired({ approvalsPending: 10, oldestApplicationAt: at(-HOUR) }).approvalBacklog).toMatchObject({
      count: 10,
      params: { stale: 0 },
    });
    expect(fired({ approvalsPending: 1, oldestApplicationAt: at(-48 * HOUR) }).approvalBacklog).toMatchObject(
      {
        count: 1,
        params: { stale: 1 },
      },
    );
  });

  it('overdue invoices raise a payments alert (counts only, never amounts)', () => {
    const r = fired({ invoicesOverdue: 2 });
    expect(r.invoicesOverdue).toEqual({
      severity: 'warning',
      count: 2,
      params: { count: 2 },
      liveCritical: false,
    });
  });

  it('nothing is raised once the event wraps or is cancelled', () => {
    const noisy: Partial<ConferenceFacts> = {
      sessions: [session({ capacity: 10, enrolled: 10, waiting: 50, roomCapacity: 5 })],
      speakerTasksOverdue: 1,
      approvalsPending: 50,
      invoicesOverdue: 3,
    };
    expect(fired(noisy, { startsAt: at(-3 * DAY), endsAt: at(-2 * DAY) })).toEqual({});
    expect(fired(noisy, { status: 'cancelled' })).toEqual({});
  });

  it('catalogue: each rule fixes on its own page; who sees it; door only the stations', () => {
    expect(fixPath('sessionsNearCapacity', 'summit')).toBe('/e/summit/sessions');
    expect(fixPath('sessionWaitlists', 'summit')).toBe('/e/summit/registration/enrollment');
    expect(fixPath('exhibitorsNoStaff', 'summit')).toBe('/e/summit/exhibitors/portal');
    expect(fixPath('speakerTasksOverdue', 'summit')).toBe('/e/summit/speakers/tasks');
    expect(fixPath('approvalBacklog', 'summit')).toBe('/e/summit/registration/applications');
    expect(fixPath('invoicesOverdue', 'summit')).toBe('/e/summit/registration/invoices');
    expect(RULES.invoicesOverdue).toMatchObject({ category: 'payments', permission: 'orders:read' });
    expect(RULES.printersKiosksOffline.category).toBe('door');
    expect(RULES.sessionsNearCapacity.category).toBe('conference');
    expect(DEFAULT_ROUTING.owner?.conference).toEqual(['in_app', 'email']);
    expect(DEFAULT_ROUTING.scanner?.conference).toBeUndefined();
  });
});
