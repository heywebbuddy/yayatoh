import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { compileSegment } from '../src/segments/compile.ts';
import { SegmentDefinition, usesMoneyConditions, usesProfileConditions } from '../src/segments/dsl.ts';
import { computeContactStats, type StatsParticipation } from '../src/stats/compute.ts';
import {
  bandOf,
  ENGAGEMENT_BANDS,
  engagementPoints,
  engagementScore,
  NO_SHOW_BANDS,
  NO_SHOW_PRIOR_BPS,
  noShowPropensityBps,
  quintile,
  quintiles,
} from '../src/stats/formulas.ts';

const dialect = new PgDialect();
const def = (conditions: unknown[]) =>
  SegmentDefinition.parse({ version: 1, root: { type: 'group', op: 'and', conditions } });
const render = (d: SegmentDefinition) =>
  dialect.sqlToQuery(compileSegment(d, { scopes: new Map(), timezone: 'UTC' }));

describe('no-show propensity (documented formula)', () => {
  it('is (noShows + 1) / (past + 5), in basis points, rounded half up', () => {
    expect(NO_SHOW_PRIOR_BPS).toBe(2_000);
    expect(noShowPropensityBps(0, 0)).toBe(2_000);
    expect(noShowPropensityBps(2, 0)).toBe(1_429); // John Doe: 1/7
    expect(noShowPropensityBps(1, 0)).toBe(1_667); // 1/6
    expect(noShowPropensityBps(2, 2)).toBe(4_286); // 3/7
    expect(noShowPropensityBps(1, 1)).toBe(3_333); // 2/6
    expect(noShowPropensityBps(3, 0)).toBe(1_250); // 1/8, exact
    expect(noShowPropensityBps(95, 95)).toBe(9_600); // 96/100
    expect(noShowPropensityBps(10_000, 0)).toBe(1); // never 0: the prior keeps one no-show
  });

  it('refuses impossible counts', () => {
    expect(() => noShowPropensityBps(1, 2)).toThrow(RangeError);
    expect(() => noShowPropensityBps(-1, 0)).toThrow(RangeError);
    expect(() => noShowPropensityBps(1.5, 0)).toThrow(RangeError);
  });
});

describe('engagement score (placeholder until M5.7b)', () => {
  it('weights the inputs and saturates at half for 25 points', () => {
    expect(engagementPoints({ eventsAttended: 2, sessionsAttended: 4, campaignsOpened: 2 })).toBe(44);
    expect(engagementScore({ eventsAttended: 2, sessionsAttended: 4, campaignsOpened: 2 })).toBe(64);
    expect(engagementScore({})).toBe(0);
    expect(engagementScore({ sessionsAttended: 5 })).toBe(50);
    expect(engagementScore({ eventsAttended: 1 })).toBe(29);
    // M5.7b's inputs are in the formula already.
    expect(engagementPoints({ pollAnswers: 1, feedback: 1, enrollments: 1 })).toBe(8);
    expect(engagementScore({ eventsAttended: 10_000 })).toBe(100);
    expect(engagementScore({ eventsAttended: 100 })).toBe(98);
    expect(engagementScore({ sessionsAttended: 45 })).toBe(90);
    expect(() => engagementScore({ eventsAttended: -1 })).toThrow(RangeError);
  });
});

describe('RFM quintiles', () => {
  it('ranks by values strictly below; ties share a quintile; order does not matter', () => {
    expect(quintile(0, 0)).toBeNull();
    expect(quintile(0, 1)).toBe(1);
    expect(quintiles([3, 2, 1, 1])).toEqual([4, 3, 1, 1]);
    expect(quintiles([180_000, 70_000, 120_000, 30_000])).toEqual([4, 2, 3, 1]);
    expect(quintiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(quintiles([5, 5, 5])).toEqual([1, 1, 1]);
    const v = [9, 1, 4, 4, 7, 2];
    const q = quintiles(v);
    const reversed = quintiles([...v].reverse()).reverse();
    expect(reversed).toEqual(q);
    expect(() => quintile(4, 4)).toThrow(RangeError);
  });

  it('bands', () => {
    expect(bandOf(64, ENGAGEMENT_BANDS)).toBe(3);
    expect(bandOf(0, ENGAGEMENT_BANDS)).toBe(0);
    expect(bandOf(14.29, NO_SHOW_BANDS)).toBe(1);
    expect(bandOf(100, NO_SHOW_BANDS)).toBe(4);
  });
});

const row = (eventId: string, extra: Partial<StatsParticipation> = {}): StatsParticipation => ({
  eventId,
  registered: true,
  checkedIn: false,
  tickets: 1,
  orders: 1,
  spendMinor: 30_000,
  currency: 'USD',
  registeredAt: new Date('2025-03-01T00:00:00Z'),
  ...extra,
});

describe('computeContactStats', () => {
  it('reproduces John Doe from his rows', () => {
    const r = computeContactStats({
      participation: [
        row('A', { checkedIn: true, registeredAt: new Date('2025-03-15T12:00:00Z') }),
        row('B', { checkedIn: true, spendMinor: 120_000, registeredAt: new Date('2025-08-20T12:00:00Z') }),
        row('C', { registeredAt: new Date('2025-12-01T12:00:00Z') }),
      ],
      signals: {
        sessionsAttended: 4,
        campaignsOpened: 2,
        firstAt: new Date('2025-06-10T09:00:00Z'),
        lastAt: new Date('2025-09-18T19:31:00Z'),
      },
      orgCurrency: 'USD',
      isOver: (id) => id !== 'C',
    });
    expect(r?.scores).toMatchObject({
      events: 3,
      eventsRegistered: 3,
      eventsAttended: 2,
      pastRegistered: 2,
      noShows: 0,
      sessionsAttended: 4,
      campaignsOpened: 2,
      orders: 3,
      monetaryMinor: 180_000,
      monetaryCurrency: 'USD',
      engagementScore: 64,
      noShowBps: 1_429,
      firstSeenAt: new Date('2025-03-15T12:00:00Z'),
      lastSeenAt: new Date('2025-12-01T12:00:00Z'),
    });
    expect(r?.currencies).toEqual([
      {
        currency: 'USD',
        orders: 3,
        tickets: 3,
        events: 3,
        eventsAttended: 2,
        spendMinor: 180_000,
        firstSeenAt: new Date('2025-03-15T12:00:00Z'),
        lastSeenAt: new Date('2025-12-01T12:00:00Z'),
      },
    ]);
  });

  it('keeps currencies apart, counts buyers off the list, and only counts ended events', () => {
    const r = computeContactStats({
      participation: [
        row('A', { currency: 'EUR', spendMinor: 5_000 }),
        row('B', { registered: false, tickets: 0, spendMinor: 9_000 }),
        row('C', { checkedIn: true }),
      ],
      signals: { sessionsAttended: 0, campaignsOpened: 0, firstAt: null, lastAt: null },
      orgCurrency: 'USD',
      isOver: () => true,
    });
    expect(r?.scores).toMatchObject({
      events: 3,
      eventsRegistered: 2,
      eventsAttended: 1,
      pastRegistered: 2,
      noShows: 1,
      monetaryMinor: 39_000,
      noShowBps: noShowPropensityBps(2, 1),
    });
    expect(r?.currencies.map((c) => [c.currency, c.spendMinor, c.events])).toEqual([
      ['EUR', 5_000, 1],
      ['USD', 39_000, 2],
    ]);
  });

  it('is null with nothing to count; signals alone still count', () => {
    const none = { sessionsAttended: 0, campaignsOpened: 0, firstAt: null, lastAt: null };
    expect(
      computeContactStats({ participation: [], signals: none, orgCurrency: 'USD', isOver: () => true }),
    ).toBeNull();
    const opens = computeContactStats({
      participation: [],
      signals: { ...none, campaignsOpened: 1, firstAt: new Date(0), lastAt: new Date(0) },
      orgCurrency: 'USD',
      isOver: () => true,
    });
    expect(opens?.scores).toMatchObject({
      events: 0,
      campaignsOpened: 1,
      noShowBps: 2_000,
      engagementScore: 7,
    });
    expect(opens?.currencies).toEqual([]);
  });
});

describe('segment conditions on contact stats', () => {
  it('validates metrics, ranges and currencies', () => {
    for (const bad of [
      { type: 'stats', metric: 'ltv', op: 'gt', value: 1 },
      { type: 'stats', metric: 'noShowPct', op: 'lt', value: 101 },
      { type: 'stats', metric: 'engagement', op: 'gt', value: 101 },
      { type: 'stats', metric: 'rfmRecency', op: 'eq', value: 6 },
      { type: 'stats', metric: 'engagement', op: '> 0 or true', value: 1 },
      { type: 'stats', metric: 'engagement', op: 'gt', value: 1.5 },
      { type: 'ltv', currency: 'usd', op: 'gt', amountMinor: 1 },
      { type: 'ltv', currency: 'USD', op: 'gt', amountMinor: -1 },
      { type: 'ltv', currency: 'USD', op: 'gt', amountMinor: 1, extra: 1 },
    ])
      expect(
        SegmentDefinition.safeParse({ version: 1, root: { type: 'group', op: 'and', conditions: [bad] } })
          .success,
      ).toBe(false);
  });

  it('compiles to bound parameters over contact_scores, contact_stats and the RFM ranks', () => {
    const d = def([
      { type: 'ltv', currency: 'USD', op: 'gt', amountMinor: 100_000 },
      { type: 'stats', metric: 'noShowPct', op: 'lt', value: 20 },
      { type: 'stats', metric: 'rfmFrequency', op: 'gte', value: 4 },
    ]);
    const q = render(d);
    expect(q.sql).toContain('from crm.contact_stats v');
    expect(q.sql).toContain('crm.contact_scores s');
    expect(q.sql).toContain('rank() over (order by s.events)');
    expect(q.sql).toMatch(/q\.frequency >= \$\d+/);
    // noShowPct 20 → 2 000 bps; a missing row counts as the prior.
    expect(q.params).toEqual(expect.arrayContaining(['USD', 100_000, 2_000, NO_SHOW_PRIOR_BPS, 4]));
    expect(q.sql).not.toContain('100000');
  });

  it('money and profile conditions are recognised', () => {
    expect(usesMoneyConditions(def([{ type: 'ltv', currency: 'USD', op: 'gt', amountMinor: 1 }]))).toBe(true);
    expect(usesMoneyConditions(def([{ type: 'stats', metric: 'rfmMonetary', op: 'gte', value: 4 }]))).toBe(
      true,
    );
    expect(usesMoneyConditions(def([{ type: 'stats', metric: 'noShowPct', op: 'lt', value: 20 }]))).toBe(
      false,
    );
    expect(
      usesMoneyConditions(
        def([{ type: 'spend', scope: { kind: 'any' }, currency: 'USD', op: 'gt', amountMinor: 1 }]),
      ),
    ).toBe(false);
    expect(usesProfileConditions(def([{ type: 'stats', metric: 'engagement', op: 'gt', value: 1 }]))).toBe(
      true,
    );
    expect(usesProfileConditions(def([{ type: 'ltv', currency: 'USD', op: 'gt', amountMinor: 1 }]))).toBe(
      true,
    );
  });
});
