import { describe, expect, it } from 'vitest';
import {
  CAPACITY_NEAR_PCT,
  CAPACITY_OVER_PCT,
  capacityGauge,
  medianGapSeconds,
  minuteSeries,
  minutesToClear,
  SPEED_WINDOW_MS,
  scansPerMinute,
  speedByGroup,
} from '../src/domain/live.ts';
import {
  DEFAULT_LAYOUTS,
  followedChannels,
  WIDGET_KEYS,
  WIDGET_META,
  widgetAllowed,
} from '../src/domain/widgets.ts';

const NOW = Date.parse('2027-06-01T20:00:00Z');
const ago = (s: number) => NOW - s * 1000;

describe('check-in speed (M3.3a)', () => {
  it('counts scans per minute over the last five minutes, half-open at the window start', () => {
    expect(SPEED_WINDOW_MS).toBe(300_000);
    expect(scansPerMinute([], NOW)).toBe(0);
    // 10 scans in the window → 2 a minute; the one exactly 5 minutes ago is outside, a future one too.
    const times = [...Array.from({ length: 10 }, (_, i) => ago(i * 20)), ago(300), NOW + 1_000];
    expect(scansPerMinute(times, NOW)).toBe(2);
    // One decimal.
    expect(scansPerMinute([ago(1), ago(2), ago(3)], NOW)).toBe(0.6);
  });

  it('takes the median gap between consecutive scans (seconds, one decimal), unordered input', () => {
    expect(medianGapSeconds([])).toBeNull();
    expect(medianGapSeconds([ago(5)])).toBeNull();
    expect(medianGapSeconds([ago(0), ago(10)])).toBe(10);
    // Gaps 2, 4, 30 → median 4; order doesn't matter.
    expect(medianGapSeconds([ago(36), ago(0), ago(4), ago(6)])).toBe(4);
    // Even count: the mean of the middle two (2 and 3 → 2.5).
    expect(medianGapSeconds([ago(0), ago(2), ago(5), ago(15), ago(40)])).toBe(6.5);
    expect(medianGapSeconds([ago(0), ago(1), ago(3), ago(6)])).toBe(2);
    expect(medianGapSeconds([0, 1234])).toBe(1.2);
  });

  it('estimates the minutes to let the remaining guests in at this pace', () => {
    expect(minutesToClear(0, 1, 5)).toBe(0);
    expect(minutesToClear(-3, 1, 5)).toBe(0);
    expect(minutesToClear(100, 1, 0)).toBeNull();
    expect(minutesToClear(100, 1, 10)).toBe(10);
    // Rounded up: 101 at 10 a minute is 11 minutes; half the guests at one door.
    expect(minutesToClear(101, 1, 10)).toBe(11);
    expect(minutesToClear(100, 0.5, 10)).toBe(5);
    // A share outside 0..1 is clamped.
    expect(minutesToClear(100, 3, 10)).toBe(10);
  });

  it('splits speed per entrance with each door’s share of today’s admissions', () => {
    const scans = [
      ...Array.from({ length: 20 }, (_, i) => ({ at: ago(i * 15), key: 'north' })),
      ...Array.from({ length: 5 }, (_, i) => ({ at: ago(i * 60), key: 'south' })),
      { at: ago(400), key: 'south' },
    ];
    const rows = speedByGroup(scans, ['north', 'south', 'west'], {
      now: NOW,
      remaining: 200,
      admitted: new Map([
        ['north', 300],
        ['south', 100],
      ]),
    });
    expect(rows).toEqual([
      { key: 'north', scansPerMin: 4, medianGapS: 15, queueMin: 38 },
      { key: 'south', scansPerMin: 1, medianGapS: 60, queueMin: 50 },
      { key: 'west', scansPerMin: 0, medianGapS: null, queueMin: 0 },
    ]);
    // Nobody admitted yet: shares follow the pace, so a door with no scans has no share of them.
    const fresh = speedByGroup(scans, ['north', 'south', null], { now: NOW, remaining: 50 });
    expect(fresh.map((r) => r.queueMin)).toEqual([10, 10, 0]);
  });

  it('fills a per-minute series for the last 15 minutes, oldest first', () => {
    const s = minuteSeries(
      [
        { at: NOW - 60_000, value: 3 },
        { at: NOW - 60_000 + 30_000, value: 1 },
        { at: NOW - 20 * 60_000, value: 9 },
      ],
      NOW + 12_000,
    );
    expect(s).toHaveLength(15);
    expect(s[0]?.at).toBe(NOW - 14 * 60_000);
    expect(s.at(-1)).toEqual({ at: NOW, count: 0 });
    expect(s.at(-2)).toEqual({ at: NOW - 60_000, count: 4 });
    expect(s.reduce((a, p) => a + p.count, 0)).toBe(4);
  });
});

describe('capacity gauges (M3.3a)', () => {
  it('uses the alert engine’s near and over thresholds', () => {
    expect([CAPACITY_NEAR_PCT, CAPACITY_OVER_PCT]).toEqual([95, 100]);
  });

  it('reports in, remaining and level: ok below 95 %, near from 95 %, over from 100 %', () => {
    expect(capacityGauge(10, null)).toEqual({
      inside: 10,
      capacity: null,
      remaining: null,
      percent: null,
      level: 'none',
    });
    expect(capacityGauge(10, 0).level).toBe('none');
    expect(capacityGauge(94, 100)).toEqual({
      inside: 94,
      capacity: 100,
      remaining: 6,
      percent: 94,
      level: 'ok',
    });
    expect(capacityGauge(95, 100).level).toBe('near');
    // Floored like the alert rule: 949 of 1000 is 94 %.
    expect(capacityGauge(949, 1000).level).toBe('ok');
    expect(capacityGauge(99, 100).level).toBe('near');
    expect(capacityGauge(100, 100)).toEqual({
      inside: 100,
      capacity: 100,
      remaining: 0,
      percent: 100,
      level: 'over',
    });
    expect(capacityGauge(130, 100)).toEqual({
      inside: 130,
      capacity: 100,
      remaining: 0,
      percent: 130,
      level: 'over',
    });
  });
});

describe('live mode widgets in the registry (M3.3a)', () => {
  const scope = (role: 'owner' | 'ops' | 'finance' | 'door' | 'marketing') => ({
    role,
    profile: 'concert' as const,
    modules: new Set(['core', 'checkin', 'reports', 'ticketing', 'seating']),
  });
  const live = ['liveFeed', 'checkinSpeed', 'scanIssues', 'capacity', 'staffPresence', 'assistance'] as const;

  it('shows the door, ops and owner the live widgets in live mode; never revenue for the door', () => {
    for (const k of live) {
      expect(WIDGET_KEYS).toContain(k);
      expect(WIDGET_META[k].revenue).toBeUndefined();
      for (const role of ['owner', 'ops', 'door'] as const) {
        expect(widgetAllowed(WIDGET_META[k], scope(role))).toBe(true);
        expect(DEFAULT_LAYOUTS[role].live).toContain(k);
      }
      for (const role of ['finance', 'marketing'] as const)
        expect(widgetAllowed(WIDGET_META[k], scope(role))).toBe(false);
    }
    expect(DEFAULT_LAYOUTS.door.live).not.toContain('sales');
    expect(DEFAULT_LAYOUTS.door.live.every((k) => !WIDGET_META[k].revenue)).toBe(true);
  });

  it('follows every channel that changes a widget (the feed: check-ins, devices, alerts)', () => {
    expect(followedChannels(WIDGET_META.liveFeed)).toEqual(['event.checkins', 'event.devices', 'org.alerts']);
    expect(followedChannels(WIDGET_META.checkinSpeed)).toEqual(['event.checkins']);
    expect(followedChannels(WIDGET_META.staffPresence)).toEqual([]);
  });
});
