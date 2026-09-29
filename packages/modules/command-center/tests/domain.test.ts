import { describe, expect, it } from 'vitest';
import {
  addZonedDays,
  availableWidgets,
  CC_ROLES,
  commandCenterRole,
  computeEventMode,
  DEFAULT_LAYOUTS,
  EVENT_MODES,
  type ModeDate,
  modeWindows,
  moveWidget,
  type ReadinessRule,
  readinessScore,
  resolveLayout,
  timelineItems,
  WIDGET_KEYS,
  WIDGET_META,
  type WidgetScope,
  widgetAllowed,
} from '../src/client.ts';

const at = (iso: string) => new Date(iso);
const H = 3_600_000;
const ALL_MODULES = new Set(['core', 'ticketing', 'orders', 'checkin', 'seating', 'reports', 'sessions']);

describe('event modes', () => {
  // A single-date event in Chicago: 2027-06-10 19:00–23:00 CDT (UTC−5).
  const single = {
    startsAt: at('2027-06-11T00:00:00Z'),
    endsAt: at('2027-06-11T04:00:00Z'),
    timeZone: 'America/Chicago',
    occurrences: [] as ModeDate[],
  };
  const mode = (now: string) => computeEventMode({ ...single, now: at(now) });

  it('goes planning → pre-show (T−1 day) → live (doors −2 h … end +2 h) → wrap (+7 days) → settled', () => {
    expect(mode('2027-06-01T00:00:00Z')).toMatchObject({ mode: 'planning', nextMode: 'pre_show' });
    expect(mode('2027-06-01T00:00:00Z').nextChangeAt).toEqual(at('2027-06-10T00:00:00Z'));
    expect(mode('2027-06-09T23:59:59Z').mode).toBe('planning');
    expect(mode('2027-06-10T00:00:00Z')).toMatchObject({ mode: 'pre_show', nextMode: 'live' });
    expect(mode('2027-06-10T00:00:00Z').nextChangeAt).toEqual(at('2027-06-10T22:00:00Z'));
    expect(mode('2027-06-10T21:59:59Z').mode).toBe('pre_show');
    expect(mode('2027-06-10T22:00:00Z')).toMatchObject({ mode: 'live', nextMode: 'wrap' });
    expect(mode('2027-06-11T05:59:59Z').mode).toBe('live');
    const wrap = mode('2027-06-11T06:00:00Z');
    expect(wrap).toMatchObject({ mode: 'wrap', nextMode: null, settled: false });
    expect(wrap.nextChangeAt).toEqual(at('2027-06-18T04:00:00Z'));
    expect(mode('2027-06-18T03:59:59Z').settled).toBe(false);
    expect(mode('2027-06-18T04:00:00Z')).toMatchObject({ mode: 'wrap', settled: true, nextChangeAt: null });
  });

  it('uses doors when set (live two hours before the doors)', () => {
    const r = computeEventMode({
      ...single,
      doorsAt: at('2027-06-10T23:00:00Z'),
      now: at('2027-06-10T21:30:00Z'),
    });
    expect(r.mode).toBe('live');
    expect(r.window.liveAt).toEqual(at('2027-06-10T21:00:00Z'));
  });

  it('counts the pre-show day in wall-clock time across the spring DST change (23 real hours)', () => {
    // New York, DST starts 2027-03-14 02:00. Start 2027-03-14 19:00 EDT = 23:00Z.
    const start = at('2027-03-14T23:00:00Z');
    const r = computeEventMode({
      startsAt: start,
      endsAt: at('2027-03-15T02:00:00Z'),
      timeZone: 'America/New_York',
      occurrences: [],
      now: at('2027-03-14T00:30:00Z'),
    });
    // Pre-show: 2027-03-13 19:00 EST = 2027-03-14 00:00Z, 23 hours before the start.
    expect(r.window.preShowAt).toEqual(at('2027-03-14T00:00:00Z'));
    expect(start.getTime() - r.window.preShowAt.getTime()).toBe(23 * H);
    expect(r.mode).toBe('pre_show');
    expect(
      computeEventMode({
        ...r.window,
        timeZone: 'America/New_York',
        occurrences: [],
        now: at('2027-03-13T23:59:00Z'),
      }).mode,
    ).toBe('planning');
  });

  it('and across the autumn change (25 real hours); the wrap ends seven wall-clock days later', () => {
    // New York, DST ends 2027-11-07 02:00. Start 2027-11-07 19:00 EST = 2027-11-08 00:00Z.
    const w = modeWindows({
      startsAt: at('2027-11-08T00:00:00Z'),
      endsAt: at('2027-11-08T03:00:00Z'),
      timeZone: 'America/New_York',
      occurrences: [],
    })[0];
    expect(w?.preShowAt).toEqual(at('2027-11-06T23:00:00Z'));
    expect(at('2027-11-08T00:00:00Z').getTime() - (w?.preShowAt.getTime() ?? 0)).toBe(25 * H);
    // End 2027-11-07 22:00 EST → 2027-11-14 22:00 EST.
    expect(w?.wrapEndsAt).toEqual(at('2027-11-15T03:00:00Z'));
  });

  it('computes the same instant boundaries in half-hour and southern zones', () => {
    // Kolkata (UTC+5:30, no DST): 2027-01-20 18:00 IST = 12:30Z.
    const k = modeWindows({
      startsAt: at('2027-01-20T12:30:00Z'),
      endsAt: at('2027-01-20T16:30:00Z'),
      timeZone: 'Asia/Kolkata',
      occurrences: [],
    })[0];
    expect(k?.preShowAt).toEqual(at('2027-01-19T12:30:00Z'));
    expect(k?.liveAt).toEqual(at('2027-01-20T10:30:00Z'));
    // Auckland: DST ends 2027-04-04 03:00 NZDT → NZST. Start 2027-04-04 19:00 NZST = 07:00Z.
    const nz = modeWindows({
      startsAt: at('2027-04-04T07:00:00Z'),
      endsAt: at('2027-04-04T10:00:00Z'),
      timeZone: 'Pacific/Auckland',
      occurrences: [],
    })[0];
    // 2027-04-03 19:00 NZDT = 06:00Z: 25 hours earlier.
    expect(nz?.preShowAt).toEqual(at('2027-04-03T06:00:00Z'));
  });

  it('keeps seconds when shifting wall-clock days', () => {
    expect(addZonedDays(at('2027-06-10T12:00:30.500Z'), 1, 'Europe/Berlin')).toEqual(
      at('2027-06-11T12:00:30.500Z'),
    );
    expect(addZonedDays(at('2027-03-27T12:00:00Z'), 1, 'Europe/Berlin')).toEqual(at('2027-03-28T11:00:00Z'));
  });

  describe('multi-date events use the current date', () => {
    const dates: ModeDate[] = [
      {
        id: '00000000-0000-7000-8000-000000000001',
        startsAt: at('2027-06-11T00:00:00Z'),
        endsAt: at('2027-06-11T04:00:00Z'),
        status: 'scheduled',
      },
      {
        id: '00000000-0000-7000-8000-000000000002',
        startsAt: at('2027-06-18T00:00:00Z'),
        endsAt: at('2027-06-18T04:00:00Z'),
        status: 'scheduled',
      },
      {
        id: '00000000-0000-7000-8000-000000000003',
        startsAt: at('2027-06-12T00:00:00Z'),
        endsAt: at('2027-06-12T04:00:00Z'),
        status: 'cancelled',
      },
    ];
    const series = (now: string) =>
      computeEventMode({
        startsAt: at('2027-06-11T00:00:00Z'),
        endsAt: at('2027-06-18T04:00:00Z'),
        timeZone: 'America/Chicago',
        occurrences: dates,
        now: at(now),
      });

    it('is live on a date, wraps it, then pre-shows the next one (cancelled dates ignored)', () => {
      expect(series('2027-06-11T01:00:00Z')).toMatchObject({ mode: 'live' });
      expect(series('2027-06-11T01:00:00Z').window.occurrenceId).toBe(dates[0]?.id);
      // The cancelled 2027-06-12 date is never live.
      expect(series('2027-06-12T01:00:00Z')).toMatchObject({ mode: 'wrap', nextMode: 'pre_show' });
      expect(series('2027-06-12T01:00:00Z').nextChangeAt).toEqual(at('2027-06-17T00:00:00Z'));
      expect(series('2027-06-17T00:00:00Z')).toMatchObject({ mode: 'pre_show' });
      expect(series('2027-06-17T00:00:00Z').window.occurrenceId).toBe(dates[1]?.id);
      expect(series('2027-06-18T01:00:00Z').window.occurrenceId).toBe(dates[1]?.id);
      expect(series('2027-06-26T00:00:00Z')).toMatchObject({ mode: 'wrap', settled: true });
    });

    it('is planning before the first pre-show and between dates once a wrap is over', () => {
      expect(series('2027-06-01T00:00:00Z')).toMatchObject({ mode: 'planning' });
      const far = [
        dates[0] as ModeDate,
        {
          ...(dates[1] as ModeDate),
          startsAt: at('2027-07-18T00:00:00Z'),
          endsAt: at('2027-07-18T04:00:00Z'),
        },
      ];
      const r = (now: string) => computeEventMode({ ...single, occurrences: far, now: at(now) });
      expect(r('2027-06-12T00:00:00Z')).toMatchObject({ mode: 'wrap', nextMode: 'planning' });
      expect(r('2027-06-12T00:00:00Z').nextChangeAt).toEqual(at('2027-06-18T04:00:00Z'));
      expect(r('2027-06-20T00:00:00Z')).toMatchObject({ mode: 'planning', nextMode: 'pre_show' });
    });

    it('falls back to the event span when every date is cancelled', () => {
      const r = computeEventMode({
        ...single,
        occurrences: dates.map((d) => ({ ...d, status: 'cancelled' as const })),
        now: at('2027-06-10T23:00:00Z'),
      });
      expect(r.window.occurrenceId).toBeNull();
      expect(r.mode).toBe('live');
    });
  });
});

describe('command center roles', () => {
  it('maps org roles and event roles to the five layouts', () => {
    expect(commandCenterRole('owner')).toBe('owner');
    expect(commandCenterRole('admin')).toBe('owner');
    expect(commandCenterRole('manager')).toBe('ops');
    expect(commandCenterRole('box_office')).toBe('ops');
    expect(commandCenterRole('finance')).toBe('finance');
    expect(commandCenterRole('marketing')).toBe('marketing');
    expect(commandCenterRole('viewer')).toBe('ops');
    expect(commandCenterRole('scanner')).toBe('door');
    expect(commandCenterRole(null)).toBeNull();
    expect(commandCenterRole('stranger')).toBeNull();
  });

  it('lets the job at this event win over a generic role, never over a specific one', () => {
    expect(commandCenterRole('viewer', ['door_staff'])).toBe('door');
    expect(commandCenterRole('viewer', ['session_scanner'])).toBe('door');
    expect(commandCenterRole('viewer', ['event_manager'])).toBe('ops');
    expect(commandCenterRole('finance', ['event_manager'])).toBe('ops');
    expect(commandCenterRole('finance', ['door_staff'])).toBe('finance');
    expect(commandCenterRole('owner', ['door_staff'])).toBe('owner');
    expect(commandCenterRole('manager', ['door_staff'])).toBe('ops');
  });
});

describe('widget registry and layouts', () => {
  const scope = (
    role: WidgetScope['role'],
    profile: WidgetScope['profile'] = 'concert',
    modules = ALL_MODULES,
  ): WidgetScope => ({
    role,
    profile,
    modules,
  });

  it('never gives the door role a revenue widget, in any mode or profile', () => {
    for (const mode of EVENT_MODES)
      for (const profile of ['concert', 'gala', 'conference', 'wedding'] as const) {
        const keys = availableWidgets(WIDGET_META, scope('door', profile), mode).map((m) => m.key);
        expect(keys).not.toContain('sales');
        expect(
          resolveLayout(WIDGET_META, scope('door', profile), mode, { order: ['sales'], hidden: [] }).map(
            (s) => s.key,
          ),
        ).not.toContain('sales');
      }
    // Even if a registration listed the door role, the revenue flag still refuses it.
    expect(widgetAllowed({ ...WIDGET_META.sales, roles: ['door'] }, scope('door'))).toBe(false);
    for (const layout of Object.values(DEFAULT_LAYOUTS.door)) expect(layout).not.toContain('sales');
  });

  it('filters by role, profile, module and mode', () => {
    expect(widgetAllowed(WIDGET_META.sales, scope('owner'))).toBe(true);
    expect(widgetAllowed(WIDGET_META.sales, scope('marketing'))).toBe(false);
    expect(widgetAllowed(WIDGET_META.sales, scope('owner', 'wedding'))).toBe(false);
    expect(widgetAllowed(WIDGET_META.seatFill, scope('owner', 'concert'))).toBe(false);
    expect(widgetAllowed(WIDGET_META.seatFill, scope('owner', 'gala'))).toBe(true);
    expect(widgetAllowed(WIDGET_META.sales, scope('owner', 'concert', new Set(['core', 'ticketing'])))).toBe(
      false,
    );
    expect(widgetAllowed(undefined, scope('owner'))).toBe(false);
    const planning = availableWidgets(WIDGET_META, scope('owner'), 'planning').map((m) => m.key);
    expect(planning).toContain('readiness');
    expect(planning).not.toContain('checkins');
    const live = availableWidgets(WIDGET_META, scope('owner'), 'live').map((m) => m.key);
    expect(live).toContain('checkins');
    expect(live).not.toContain('readiness');
  });

  it('gives every role a default layout per mode, made of registry widgets only', () => {
    for (const role of CC_ROLES)
      for (const mode of EVENT_MODES)
        for (const k of DEFAULT_LAYOUTS[role][mode]) {
          expect(WIDGET_KEYS).toContain(k);
          expect(WIDGET_META[k].roles).toContain(role);
          expect(WIDGET_META[k].modes).toContain(mode);
        }
  });

  it('changes the layout with the mode', () => {
    const keys = (mode: (typeof EVENT_MODES)[number]) =>
      resolveLayout(WIDGET_META, scope('owner', 'gala'), mode, null)
        .filter((s) => !s.hidden)
        .map((s) => s.key);
    expect(keys('planning')).toEqual(['readiness', 'sales', 'tickets', 'alerts', 'timeline']);
    // M3.3a live mode: the feed, speed, capacity, the duplicate/invalid monitor, the device board,
    // staff presence and the guest-assistance slot join the owner's live layout.
    expect(keys('live')).toEqual([
      'checkins',
      'alerts',
      'liveFeed',
      'checkinSpeed',
      'capacity',
      'scanIssues',
      'devices',
      'deviceBoard',
      'staffPresence',
      'assistance',
      'seatFill',
      'sales',
      'tickets',
      'timeline',
    ]);
    expect(keys('wrap')[0]).toBe('sales');
  });

  it('applies a saved order and hidden widgets, drops unknown ones and appends new ones', () => {
    const r = resolveLayout(WIDGET_META, scope('owner', 'gala'), 'live', {
      order: ['timeline', 'bogus', 'readiness', 'sales', 'timeline'],
      hidden: ['sales'],
    });
    expect(r.map((s) => s.key)).toEqual([
      'timeline',
      'sales',
      'checkins',
      'alerts',
      'liveFeed',
      'checkinSpeed',
      'capacity',
      'scanIssues',
      'devices',
      'deviceBoard',
      'staffPresence',
      'assistance',
      'seatFill',
      'tickets',
      // Batch 3d merge: M3.4a's counts per entrance are offered to owners (hidden until shown).
      'entrances',
    ]);
    expect(r.find((s) => s.key === 'sales')?.hidden).toBe(true);
    expect(r.find((s) => s.key === 'entrances')?.hidden).toBe(true);
    expect(r.find((s) => s.key === 'checkins')?.hidden).toBe(false);
    // Available in the mode but not in the role's default list: offered hidden.
    const door = resolveLayout(WIDGET_META, scope('door', 'gala'), 'wrap', null);
    expect(door.filter((s) => s.hidden).map((s) => s.key)).toEqual([
      'seatFill',
      'alerts',
      'entrances',
      'scanIssues',
    ]);
  });

  it('moves widgets up and down (the keyboard alternative to dragging)', () => {
    expect(moveWidget(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveWidget(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveWidget(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveWidget(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(moveWidget(['a', 'b'], 'z' as 'a', 1)).toEqual(['a', 'b']);
  });
});

describe('readiness score', () => {
  const rule = (key: string, done: boolean): ReadinessRule => ({
    key,
    done,
    path: key === 'published' ? '' : key,
  });

  it('weighs blocking rules double and lists them with their fix links', () => {
    const s = readinessScore([
      rule('detailsAdded', true),
      rule('venueSet', false),
      rule('taglineWritten', false),
      rule('descriptionAdded', true),
      rule('ticketsCreated', false),
      rule('published', false),
    ]);
    // Weights: details 2 ✓, venue 2, tagline 1, description 1 ✓, tickets 2, published 2 → 3/10.
    expect(s.score).toBe(30);
    expect(s.blocking.map((r) => r.key)).toEqual(['venueSet', 'ticketsCreated', 'published']);
    expect(s.blocking.map((r) => r.path)).toEqual(['venueSet', 'ticketsCreated', '']);
    expect(s.todo.map((r) => r.key)).toEqual(['taglineWritten']);
    expect(s.done).toBe(2);
    expect(s.total).toBe(6);
  });

  it('is 100 with everything done or nothing to do', () => {
    expect(readinessScore([rule('detailsAdded', true), rule('published', true)]).score).toBe(100);
    expect(readinessScore([]).score).toBe(100);
  });
});

describe('timeline', () => {
  it('lists the upcoming boundaries, other dates and sessions, soonest first', () => {
    const input = {
      startsAt: at('2027-06-11T00:00:00Z'),
      endsAt: at('2027-06-11T04:00:00Z'),
      timeZone: 'America/Chicago',
      occurrences: [] as ModeDate[],
      now: at('2027-06-10T12:00:00Z'),
    };
    const items = timelineItems({
      mode: computeEventMode(input),
      windows: modeWindows(input),
      sessions: [
        { title: 'Keynote', startsAt: at('2027-06-11T00:30:00Z') },
        { title: 'Past', startsAt: at('2027-06-01T00:00:00Z') },
      ],
      now: input.now,
    });
    expect(items.map((i) => i.kind)).toEqual(['live', 'start', 'session', 'end', 'wrap', 'wrapEnd']);
    expect(items.find((i) => i.kind === 'session')?.title).toBe('Keynote');
    expect(
      timelineItems({
        mode: computeEventMode(input),
        windows: modeWindows(input),
        sessions: [],
        now: input.now,
        limit: 2,
      }),
    ).toHaveLength(2);
  });
});
