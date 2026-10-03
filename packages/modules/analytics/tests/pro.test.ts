import type { TenantTx } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { describe, expect, it } from 'vitest';
import {
  attributionRowsOf,
  changePct,
  comboProblem,
  creditTouches,
  csvValue,
  decimalOf,
  diffAttribution,
  duePeriods,
  type EventSnapshot,
  EXPLORE_CSV_COLUMNS,
  ExploreDto,
  exploreCsv,
  exploreRange,
  fakeTinybird,
  hashSnapshot,
  measureValue,
  nextSendAt,
  ORDER_CREDIT_BPS,
  periodContaining,
  periodDueAt,
  periodLabel,
  periodOfKey,
  REPORT_LABELS,
  REPORT_LOCALES,
  reportHtml,
  reportLocale,
  ruleFires,
  splitEvenly,
  TINYBIRD_DATASOURCES,
  tinybirdWarehouse,
} from '../src/index.ts';

const ORG_A = '01900000-0000-7000-8000-00000000000a';
const ORG_B = '01900000-0000-7000-8000-00000000000b';
const EV_A = '01900000-0000-7000-8000-0000000000a1';
const EV_B = '01900000-0000-7000-8000-0000000000b1';
const LINK_1 = '01900000-0000-7000-8000-0000000000c1';
const NOW = new Date('2027-05-10T12:00:00Z');
const noTx = {} as TenantTx;

describe('multi-touch attribution (hand-computed)', () => {
  it('splits evenly in whole units, the remainder to the last share', () => {
    expect(splitEvenly(10_000, 3)).toEqual([3333, 3333, 3334]);
    expect(splitEvenly(1001, 4)).toEqual([250, 250, 250, 251]);
    expect(splitEvenly(5, 7)).toEqual([0, 0, 0, 0, 0, 0, 5]);
    expect(splitEvenly(0, 2)).toEqual([0, 0]);
    expect(splitEvenly(999, 1)).toEqual([999]);
    for (const [t, n] of [
      [123_457, 11],
      [1, 50],
      [99_999_999, 7],
    ] as const)
      expect(splitEvenly(t, n).reduce((a, b) => a + b, 0)).toBe(t);
    expect(() => splitEvenly(10, 0)).toThrow();
    expect(() => splitEvenly(-1, 2)).toThrow();
    expect(() => splitEvenly(1.5, 2)).toThrow();
  });

  const email = { source: 'newsletter', medium: 'email', campaignKey: 'c.camp-1', linkId: LINK_1 };
  const social = { source: 'facebook', medium: 'social', campaignKey: 'u.spring', linkId: null };
  const referral = { source: 'blog.example', medium: 'referral', campaignKey: null, linkId: null };

  it('first, last and linear credit', () => {
    const path = [email, social, referral];
    expect(creditTouches(path, 'first', 10_000)).toEqual([
      { touch: email, creditBps: ORDER_CREDIT_BPS, revenueMinor: 10_000 },
    ]);
    expect(creditTouches(path, 'last', 10_000)).toEqual([
      { touch: referral, creditBps: ORDER_CREDIT_BPS, revenueMinor: 10_000 },
    ]);
    expect(creditTouches(path, 'linear', 10_000).map((c) => [c.touch.source, c.creditBps, c.revenueMinor])).toEqual([
      ['newsletter', 3333, 3333],
      ['facebook', 3333, 3333],
      ['blog.example', 3334, 3334],
    ]);
    expect(creditTouches([], 'linear', 500)).toEqual([]);
  });

  it('rows per day, model and touch; the same touch twice gets two shares; currencies stay apart', () => {
    const rows = attributionRowsOf(
      [
        { orderId: 'o1', day: '2027-05-01', currency: 'USD', totalMinor: 10_000 },
        { orderId: 'o2', day: '2027-05-01', currency: 'USD', totalMinor: 2_501 },
        { orderId: 'o3', day: '2027-05-02', currency: 'EUR', totalMinor: 900 },
        { orderId: 'o4', day: '2027-05-02', currency: 'USD', totalMinor: 7_000 }, // no path: unattributed
      ],
      [
        { orderId: 'o1', touches: [email, social, referral] },
        { orderId: 'o2', touches: [email, email] },
        { orderId: 'o3', touches: [social] },
      ],
    );
    const pick = (model: string, source: string, day: string, currency: string) =>
      rows.find((r) => r.model === model && r.source === source && r.day === day && r.currency === currency);
    // o1 linear 3333/3333/3334; o2 linear 1250 + 1251 to the same email touch.
    expect(pick('linear', 'newsletter', '2027-05-01', 'USD')).toMatchObject({
      creditBps: 3333 + 10_000,
      revenueMinor: 3333 + 2501,
      medium: 'email',
      campaign: 'c.camp-1',
      linkId: LINK_1,
    });
    expect(pick('linear', 'blog.example', '2027-05-01', 'USD')).toMatchObject({
      creditBps: 3334,
      revenueMinor: 3334,
      campaign: '',
    });
    expect(pick('first', 'newsletter', '2027-05-01', 'USD')).toMatchObject({ creditBps: 20_000, revenueMinor: 12_501 });
    expect(pick('last', 'blog.example', '2027-05-01', 'USD')).toMatchObject({ creditBps: 10_000, revenueMinor: 10_000 });
    expect(pick('last', 'facebook', '2027-05-02', 'EUR')).toMatchObject({ creditBps: 10_000, revenueMinor: 900 });
    for (const model of ['first', 'last', 'linear']) {
      const usd = rows.filter((r) => r.model === model && r.currency === 'USD');
      expect(usd.reduce((a, r) => a + r.revenueMinor, 0)).toBe(12_501);
      expect(usd.reduce((a, r) => a + r.creditBps, 0)).toBe(20_000);
    }
    expect(rows.some((r) => r.revenueMinor === 7_000)).toBe(false);
  });

  it('diffs stored rows: only changed ones are written, vanished ones removed', () => {
    const next = attributionRowsOf(
      [{ orderId: 'o1', day: '2027-05-01', currency: 'USD', totalMinor: 100 }],
      [{ orderId: 'o1', touches: [email] }],
    );
    const stored = next.map((r, i) => ({ ...r, id: `id${i}` }));
    expect(diffAttribution(stored, next)).toEqual({ upserts: [], removed: [] });
    const changed = next.map((r) => ({ ...r, revenueMinor: r.revenueMinor + 1 }));
    expect(diffAttribution(stored, changed).upserts).toHaveLength(3);
    expect(diffAttribution(stored, []).removed).toHaveLength(3);
  });

  it('keeps M6.2a snapshot hashes for events without attribution', () => {
    const base: EventSnapshot = {
      eventId: EV_A,
      timeZone: 'UTC',
      daily: [{ day: '2027-05-01', metric: 'orders', currency: '', value: 1 }],
      state: null,
    };
    expect(hashSnapshot({ ...base, attribution: [] })).toBe(hashSnapshot(base));
    const withAttr = {
      ...base,
      attribution: attributionRowsOf(
        [{ orderId: 'o1', day: '2027-05-01', currency: 'USD', totalMinor: 100 }],
        [{ orderId: 'o1', touches: [email] }],
      ),
    };
    expect(hashSnapshot(withAttr)).not.toBe(hashSnapshot(base));
  });
});

describe('Tinybird attribution (fake)', () => {
  it('appends attribution under the event version and reads one org only, newest version', async () => {
    const tb = fakeTinybird({ now: () => NOW });
    const wh = tinybirdWarehouse({ ...tb.config, fetch: tb.fetch, now: () => NOW });
    const scope = (orgId: string) => ({ ctx: createCtx({ orgId, now: NOW }), tx: noTx });
    const state = { startsAt: NOW, endsAt: NOW, endDay: '2027-05-10', validTickets: 1, checkedIn: 0 };
    const attr = (total: number) =>
      attributionRowsOf(
        [{ orderId: 'o1', day: '2027-05-01', currency: 'USD', totalMinor: total }],
        [{ orderId: 'o1', touches: [{ source: 'newsletter', medium: 'email', campaignKey: null, linkId: null }] }],
      );
    await wh.writeEvent(scope(ORG_A), { eventId: EV_A, timeZone: 'UTC', daily: [], state, attribution: attr(500) }, 1);
    await wh.writeEvent(scope(ORG_A), { eventId: EV_A, timeZone: 'UTC', daily: [], state, attribution: attr(700) }, 2);
    await wh.writeEvent(scope(ORG_B), { eventId: EV_B, timeZone: 'UTC', daily: [], state, attribution: attr(9_999) }, 1);
    for (const r of tb.datasources[TINYBIRD_DATASOURCES.attribution] ?? []) expect(typeof r.org_id).toBe('string');
    const a = await wh.attributionTotals(scope(ORG_A), { from: '2027-05-01', to: '2027-05-31', model: 'linear' });
    expect(a).toEqual([
      {
        eventId: EV_A,
        day: '2027-05-01',
        source: 'newsletter',
        medium: 'email',
        campaign: '',
        linkId: null,
        currency: 'USD',
        creditBps: 10_000,
        revenueMinor: 700,
      },
    ]);
    // A later write without attribution empties it (the version moves on).
    await wh.writeEvent(scope(ORG_A), { eventId: EV_A, timeZone: 'UTC', daily: [], state, attribution: [] }, 3);
    expect(await wh.attributionTotals(scope(ORG_A), { from: '2027-05-01', to: '2027-05-31', model: 'linear' })).toEqual(
      [],
    );
    tb.assertEveryQueryScoped();
  });
});

describe('explorer', () => {
  it('touch dimensions only for attribution measures', () => {
    expect(comboProblem('registrations', 'channel')).toBe('touch_dimension');
    expect(comboProblem('gross', 'campaign')).toBe('touch_dimension');
    expect(comboProblem('attributed_revenue', 'source')).toBeNull();
    expect(comboProblem('tickets', 'event')).toBeNull();
  });

  it('presets end today in the org time zone; custom needs both dates', () => {
    // 2027-05-10 12:00 UTC is still 2027-05-10 in Los Angeles, already 2027-05-11 in Kiritimati.
    expect(exploreRange({ range: '7d' }, 'America/Los_Angeles', NOW)).toEqual({ from: '2027-05-04', to: '2027-05-10' });
    expect(exploreRange({ range: '30d' }, 'Pacific/Kiritimati', NOW)).toEqual({ from: '2027-04-12', to: '2027-05-11' });
    expect(() => exploreRange({ range: 'custom', from: '2027-01-01' }, 'UTC', NOW)).toThrow(/both dates/);
    expect(() => exploreRange({ range: 'custom', from: '2027-02-01', to: '2027-01-01' }, 'UTC', NOW)).toThrow();
    expect(exploreRange({ range: 'custom', from: '2027-01-01', to: '2027-01-31' }, 'UTC', NOW)).toEqual({
      from: '2027-01-01',
      to: '2027-01-31',
    });
  });

  it('CSV: allowlisted columns, units, formula-safe cells and the total', () => {
    expect(decimalOf(12_345, 2)).toBe('123.45');
    expect(decimalOf(5, 2)).toBe('0.05');
    expect(decimalOf(-250, 2)).toBe('-2.50');
    expect(decimalOf(1_000, 0)).toBe('1000');
    expect(csvValue({ unit: 'order_bps' }, 15_000, null)).toBe('1.50');
    expect(csvValue({ unit: 'order_bps' }, 3_333, null)).toBe('0.33');
    expect(csvValue({ unit: 'minor' }, 1_050, 'JPY')).toBe('1050');
    expect(csvValue({ unit: 'minor' }, 1_050, 'KWD')).toBe('1.050');
    expect(csvValue({ unit: 'count' }, 7, null)).toBe('7');
    const dto = ExploreDto.parse({
      asOf: NOW,
      measure: 'attributed_revenue',
      dimension: 'source',
      model: 'linear',
      granularity: 'day',
      range: '30d',
      from: '2027-04-11',
      to: '2027-05-10',
      timeZone: 'UTC',
      eventId: null,
      unit: 'minor',
      rows: [
        { key: '=HYPERLINK("x")', label: '=HYPERLINK("x")', currency: 'USD', value: 3334 },
        { key: 'newsletter', label: 'newsletter', currency: 'USD', value: 3333 },
      ],
      totals: [{ currency: 'USD', value: 6667 }],
      truncated: false,
    });
    const csv = exploreCsv(
      dto,
      { dimension: 'Source', currency: 'Currency', value: 'Attributed revenue' },
      (r) => r.label ?? 'None',
      'Total',
    );
    expect(EXPLORE_CSV_COLUMNS).toEqual(['dimension', 'currency', 'value']);
    expect(csv.split('\r\n')).toEqual([
      '﻿Source,Currency,Attributed revenue',
      `"'=HYPERLINK(""x"")",USD,33.34`,
      'newsletter,USD,33.33',
      'Total,USD,66.67',
      '',
    ]);
  });
});

describe('organizer alert rules (pure)', () => {
  const rows = [
    { day: '2027-05-09', metric: 'orders', currency: '', value: 4 },
    { day: '2027-05-09', metric: 'tickets', currency: '', value: 10 },
    { day: '2027-05-09', metric: 'refunded_tickets', currency: '', value: 3 },
    { day: '2027-05-09', metric: 'gross', currency: 'USD', value: 5_000 },
    { day: '2027-05-09', metric: 'gross', currency: 'EUR', value: 9_000 },
    { day: '2027-05-09', metric: 'refunds', currency: 'USD', value: 1_200 },
  ] as const;
  it('measures counts and one currency of money', () => {
    expect(measureValue(rows, 'registrations', '')).toBe(4);
    expect(measureValue(rows, 'tickets', '')).toBe(7);
    expect(measureValue(rows, 'refunded_tickets', '')).toBe(3);
    expect(measureValue(rows, 'gross', 'USD')).toBe(5_000);
    expect(measureValue(rows, 'net', 'USD')).toBe(3_800);
    expect(measureValue(rows, 'refunds', 'EUR')).toBe(0);
    expect(measureValue(rows, 'gross', '')).toBe(0);
  });
  it('threshold and change conditions (integer maths, never a change from zero)', () => {
    const spec = (condition: 'above' | 'below' | 'rise' | 'drop', threshold: number) => ({
      measure: 'registrations' as const,
      condition,
      threshold,
      currency: '',
    });
    expect(ruleFires(spec('above', 10), 10, 0)).toBe(true);
    expect(ruleFires(spec('above', 10), 9, 0)).toBe(false);
    expect(ruleFires(spec('below', 10), 9, 0)).toBe(true);
    expect(ruleFires(spec('below', 10), 10, 0)).toBe(false);
    expect(ruleFires(spec('rise', 50), 15, 10)).toBe(true);
    expect(ruleFires(spec('rise', 50), 14, 10)).toBe(false);
    expect(ruleFires(spec('drop', 25), 75, 100)).toBe(true);
    expect(ruleFires(spec('drop', 25), 76, 100)).toBe(false);
    expect(ruleFires(spec('rise', 1), 5, 0)).toBe(false);
    expect(ruleFires(spec('drop', 1), 0, 0)).toBe(false);
    expect(changePct(15, 10)).toBe(50);
    expect(changePct(5, 0)).toBeNull();
    expect(changePct(7, 10)).toBe(-30);
  });
});

describe('report periods (org calendar days)', () => {
  it('periods, keys and due times', () => {
    expect(periodContaining('daily', '2026-10-02')).toEqual({ key: 'D2026-10-02', from: '2026-10-02', to: '2026-10-02' });
    expect(periodContaining('weekly', '2026-10-02')).toEqual({ key: 'W2026-09-28', from: '2026-09-28', to: '2026-10-04' });
    expect(periodContaining('monthly', '2026-02-15')).toEqual({ key: 'M2026-02', from: '2026-02-01', to: '2026-02-28' });
    expect(periodContaining('monthly', '2028-02-15').to).toBe('2028-02-29');
    expect(periodContaining('monthly', '2026-12-31')).toEqual({ key: 'M2026-12', from: '2026-12-01', to: '2026-12-31' });
    for (const p of [
      periodContaining('daily', '2026-03-29'),
      periodContaining('weekly', '2026-03-29'),
      periodContaining('monthly', '2026-03-29'),
    ])
      expect(periodOfKey(p.key)).toEqual(p);
    expect(periodOfKey('W2026-09-29')).toBeNull(); // not a Monday
    expect(periodOfKey('X2026')).toBeNull();
    expect(periodDueAt(periodContaining('daily', '2026-10-02'), 'America/New_York', 8).toISOString()).toBe(
      '2026-10-03T12:00:00.000Z',
    );
  });

  it('due periods: only complete, after the send hour, after the schedule started, at most three', () => {
    const created = new Date('2026-09-01T00:00:00Z');
    const tz = 'America/New_York';
    // 07:59 New York on Oct 3: yesterday's report is not due yet; the three before are (catch-up).
    expect(duePeriods('daily', 8, tz, new Date('2026-10-03T11:59:00Z'), created).map((p) => p.key)).toEqual([
      'D2026-09-29',
      'D2026-09-30',
      'D2026-10-01',
    ]);
    expect(
      duePeriods('daily', 8, tz, new Date('2026-10-03T12:00:00Z'), created, 1).map((p) => p.key),
    ).toEqual(['D2026-10-02']);
    // A schedule made today sends nothing that was due before it existed.
    expect(duePeriods('daily', 8, tz, new Date('2026-10-03T12:30:00Z'), new Date('2026-10-03T12:10:00Z'))).toEqual(
      [],
    );
    expect(duePeriods('weekly', 8, tz, new Date('2026-10-05T12:00:00Z'), created).map((p) => p.key)).toEqual([
      'W2026-09-14',
      'W2026-09-21',
      'W2026-09-28',
    ]);
    expect(duePeriods('monthly', 0, tz, new Date('2026-10-01T04:00:00Z'), created).map((p) => p.key)).toEqual([
      'M2026-08',
      'M2026-09',
    ]);
    expect(
      nextSendAt({ frequency: 'weekly', sendHour: 8, activeSince: created }, tz, new Date('2026-10-03T12:00:00Z')).toISOString(),
    ).toBe('2026-10-05T12:00:00.000Z');
    expect(
      nextSendAt({ frequency: 'daily', sendHour: 8, activeSince: created }, tz, new Date('2026-10-03T11:00:00Z')).toISOString(),
    ).toBe('2026-10-03T12:00:00.000Z');
  });

  /** Simulate a worker ticking every few minutes: which period keys get sent, how often. */
  function simulate(
    frequency: 'daily' | 'weekly' | 'monthly',
    sendHour: number,
    tz: string,
    fromIso: string,
    toIso: string,
    stepMin: number,
  ) {
    const sent = new Map<string, number>();
    const created = new Date(fromIso);
    for (let t = created.getTime(); t <= Date.parse(toIso); t += stepMin * 60_000) {
      for (const p of duePeriods(frequency, sendHour, tz, new Date(t), created)) {
        if (sent.has(p.key)) continue; // the run table: a sent period is never sent again
        sent.set(p.key, t);
      }
    }
    return sent;
  }

  it.each([
    ['Europe/Berlin', 2, '2026-03-26T00:00:00Z', '2026-04-02T00:00:00Z'],
    ['Europe/Berlin', 2, '2026-10-22T00:00:00Z', '2026-10-29T00:00:00Z'],
    ['America/New_York', 2, '2026-03-05T00:00:00Z', '2026-03-12T00:00:00Z'],
    ['America/New_York', 1, '2026-10-29T00:00:00Z', '2026-11-05T00:00:00Z'],
    ['Australia/Lord_Howe', 2, '2026-04-01T00:00:00Z', '2026-04-08T00:00:00Z'],
  ])('daily in %s at %i:00 across a DST change: every day once, none skipped', { timeout: 60_000 }, (tz, hour, from, to) => {
    const sent = simulate('daily', hour, tz, from, to, 7);
    const keys = [...sent.keys()];
    expect(new Set(keys).size).toBe(keys.length);
    // Consecutive days, no gap.
    for (let i = 1; i < keys.length; i++) {
      const prev = keys[i - 1]?.slice(1) as string;
      const next = new Date(Date.parse(`${prev}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      expect(keys[i]).toBe(`D${next}`);
    }
    expect(keys.length).toBeGreaterThanOrEqual(6);
    // Each one went out at the send hour in local time (or right after a gap that swallowed it).
    for (const [key, at] of sent) {
      const local = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(
        new Date(at),
      );
      expect(Number(local) - hour, key).toBeGreaterThanOrEqual(0);
      expect(Number(local) - hour, key).toBeLessThanOrEqual(1);
    }
  });

  it('weekly and monthly across DST changes: once per period', () => {
    const weeks = simulate('weekly', 2, 'Europe/Berlin', '2026-03-01T00:00:00Z', '2026-04-30T00:00:00Z', 37);
    expect([...weeks.keys()]).toEqual(['W2026-02-23', 'W2026-03-02', 'W2026-03-09', 'W2026-03-16', 'W2026-03-23', 'W2026-03-30', 'W2026-04-06', 'W2026-04-13', 'W2026-04-20']);
    const months = simulate('monthly', 0, 'America/New_York', '2026-02-15T00:00:00Z', '2026-12-02T00:00:00Z', 241);
    expect([...months.keys()]).toEqual(['M2026-02', 'M2026-03', 'M2026-04', 'M2026-05', 'M2026-06', 'M2026-07', 'M2026-08', 'M2026-09', 'M2026-10', 'M2026-11']);
  }, 60_000);
});

describe('report PDF', () => {
  const g = {
    scheduleName: 'Weekly <sales>',
    orgName: 'Lakeside & Co',
    timeZone: 'America/New_York',
    frequency: 'weekly' as const,
    period: periodContaining('weekly', '2026-09-30'),
    daily: [],
    totals: {
      registrations: 1234,
      ticketsIssued: 10,
      tickets: 9,
      compTickets: 1,
      refundedTickets: 1,
      checkins: 5,
      noShows: 2,
    },
    series: [],
    top: [{ name: 'Jazz <Night>', registrations: 3, tickets: 4, checkins: 1 }],
    revenue: {
      currencies: ['USD'],
      totals: [{ currency: 'USD', grossMinor: 123_456, refundsMinor: 1_000, netMinor: 122_456 }],
      series: [],
    },
  };
  it('labels exist in every locale with the same keys', () => {
    const keys = Object.keys(REPORT_LABELS.en).sort();
    for (const l of REPORT_LOCALES) expect(Object.keys(REPORT_LABELS[l]).sort()).toEqual(keys);
    expect(reportLocale('pt-BR')).toBe('pt');
    expect(reportLocale('zh-TW')).toBe('zh-TW');
    expect(reportLocale('zh-Hant')).toBe('zh-TW');
    expect(reportLocale('xx')).toBe('en');
    expect(reportLocale(null)).toBe('en');
  });
  it('escapes, formats in the locale, revenue only for finance, RTL for Arabic', () => {
    const fin = reportHtml(g, 'en', true, NOW);
    expect(fin).toContain('Weekly &lt;sales&gt;');
    expect(fin).toContain('Jazz &lt;Night&gt;');
    expect(fin).toContain('Lakeside &amp; Co');
    expect(fin).toContain('1,234');
    expect(fin).toContain('$1,234.56');
    expect(fin).toContain('Revenue');
    const counts = reportHtml(g, 'en', false, NOW);
    expect(counts).not.toContain('$1,234.56');
    expect(counts).not.toContain('Revenue');
    const ar = reportHtml(g, 'ar', true, NOW);
    expect(ar).toContain('dir="rtl"');
    expect(ar).toContain('lang="ar"');
    expect(reportHtml(g, 'de', false, NOW)).toContain('1.234');
    expect(periodLabel(periodContaining('monthly', '2026-09-10'), 'monthly', 'en')).toBe('September 2026');
    expect(periodLabel(periodContaining('daily', '2026-09-10'), 'daily', 'en')).toBe('Sep 10, 2026');
    expect(periodLabel(periodContaining('weekly', '2026-09-10'), 'weekly', 'en')).toMatch(/Sep 7.+13, 2026/);
  });
});
