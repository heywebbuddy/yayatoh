import type { TenantTx } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { describe, expect, it } from 'vitest';
import {
  bucketOf,
  bucketsBetween,
  buildCounts,
  buildRevenue,
  configuredWarehouseName,
  dayIn,
  diffDaily,
  type EventSnapshot,
  fakeTinybird,
  foldDaily,
  hashSnapshot,
  OrgDashboardDto,
  OrgRevenueDto,
  resolveRange,
  signPipeToken,
  TINYBIRD_DATASOURCES,
  TINYBIRD_PIPES,
  TinybirdError,
  tinybirdWarehouse,
  topEventCounts,
  topEventRevenue,
  WAREHOUSE_EVENT_SCHEMAS,
  WAREHOUSE_EVENTS,
  warehouseFromEnv,
} from '../src/index.ts';

const ORG_A = '01900000-0000-7000-8000-00000000000a';
const ORG_B = '01900000-0000-7000-8000-00000000000b';
const EV_A = '01900000-0000-7000-8000-0000000000a1';
const EV_A2 = '01900000-0000-7000-8000-0000000000a2';
const EV_B = '01900000-0000-7000-8000-0000000000b1';
const NOW = new Date('2027-05-10T12:00:00Z');
const noTx = {} as TenantTx;
const scopeOf = (orgId: string) => ({ ctx: createCtx({ orgId, now: NOW }), tx: noTx });

describe('calendar buckets (org time zone days)', () => {
  it('maps a day to itself, its ISO week Monday or the first of its month', () => {
    expect(bucketOf('2027-05-12', 'day')).toBe('2027-05-12');
    expect(bucketOf('2027-05-12', 'week')).toBe('2027-05-10'); // Wednesday → Monday
    expect(bucketOf('2027-05-16', 'week')).toBe('2027-05-10'); // Sunday → the Monday before
    expect(bucketOf('2027-05-17', 'week')).toBe('2027-05-17');
    expect(bucketOf('2027-01-01', 'week')).toBe('2026-12-28'); // across a year
    expect(bucketOf('2027-05-31', 'month')).toBe('2027-05-01');
  });

  it('lists every bucket of a range, months across a year end', () => {
    expect(bucketsBetween('2027-05-30', '2027-06-02', 'day')).toEqual([
      '2027-05-30',
      '2027-05-31',
      '2027-06-01',
      '2027-06-02',
    ]);
    expect(bucketsBetween('2027-05-12', '2027-05-25', 'week')).toEqual([
      '2027-05-10',
      '2027-05-17',
      '2027-05-24',
    ]);
    expect(bucketsBetween('2026-11-15', '2027-02-01', 'month')).toEqual([
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
    ]);
  });

  it('reads calendar days in a time zone, not UTC', () => {
    const late = new Date('2027-03-01T04:30:00Z');
    expect(dayIn(late, 'UTC')).toBe('2027-03-01');
    expect(dayIn(late, 'America/Chicago')).toBe('2027-02-28');
    expect(dayIn(late, 'Asia/Kolkata')).toBe('2027-03-01');
  });

  it('defaults to the last 30 days up to today in the org time zone and validates ranges', () => {
    const now = new Date('2027-03-01T03:00:00Z'); // still Feb 28 in Chicago
    expect(resolveRange({ granularity: 'day' }, 'America/Chicago', now)).toEqual({
      from: '2027-01-30',
      to: '2027-02-28',
    });
    expect(resolveRange({ granularity: 'day', from: '2027-01-01' }, 'UTC', now)).toEqual({
      from: '2027-01-01',
      to: '2027-01-30',
    });
    expect(() =>
      resolveRange({ granularity: 'day', from: '2027-02-02', to: '2027-02-01' }, 'UTC', now),
    ).toThrow(/ends before/);
    expect(() =>
      resolveRange({ granularity: 'month', from: '2024-01-01', to: '2026-01-02' }, 'UTC', now),
    ).toThrow(/two years/);
    expect(resolveRange({ granularity: 'month', from: '2024-01-01', to: '2025-12-31' }, 'UTC', now).to).toBe(
      '2025-12-31',
    );
  });
});

describe('dashboard figures (pure)', () => {
  const daily = [
    { day: '2027-05-03', metric: 'orders', currency: '', value: 3 },
    { day: '2027-05-03', metric: 'tickets', currency: '', value: 5 },
    { day: '2027-05-03', metric: 'comp_tickets', currency: '', value: 2 },
    { day: '2027-05-03', metric: 'gross', currency: 'USD', value: 25_000 },
    { day: '2027-05-03', metric: 'gross', currency: 'EUR', value: 4_000 },
    { day: '2027-05-05', metric: 'refunded_tickets', currency: '', value: 1 },
    { day: '2027-05-05', metric: 'refunds', currency: 'USD', value: 5_000 },
    { day: '2027-05-06', metric: 'checkins', currency: '', value: 4 },
  ] as const;
  const states = [
    {
      eventId: EV_A,
      startsAt: new Date('2027-05-06T00:00:00Z'),
      endsAt: new Date('2027-05-06T04:00:00Z'),
      endDay: '2027-05-05',
      validTickets: 6,
      checkedIn: 4,
    },
    {
      eventId: EV_A2,
      startsAt: new Date('2027-06-06T00:00:00Z'),
      endsAt: new Date('2027-06-06T04:00:00Z'),
      endDay: '2027-05-09',
      validTickets: 9,
      checkedIn: 0,
    },
  ];

  it('fills empty buckets, nets refunded tickets and counts no-shows of ended events only', () => {
    const r = buildCounts(daily, states, { from: '2027-05-03', to: '2027-05-09' }, 'day', NOW);
    expect(r.series).toHaveLength(7);
    expect(r.series[1]).toMatchObject({ bucket: '2027-05-04', registrations: 0, tickets: 0 });
    expect(r.totals).toEqual({
      registrations: 3,
      ticketsIssued: 5,
      tickets: 4,
      compTickets: 2,
      refundedTickets: 1,
      checkins: 4,
      noShows: 2, // the second event has not ended by NOW
    });
    expect(r.series.find((s) => s.bucket === '2027-05-05')).toMatchObject({ noShows: 2, tickets: -1 });
    const weeks = buildCounts(daily, states, { from: '2027-05-03', to: '2027-05-09' }, 'week', NOW);
    expect(weeks.series).toEqual([{ bucket: '2027-05-03', ...r.totals }]);
  });

  it('keeps money per currency and never adds currencies together', () => {
    const r = buildRevenue(daily, { from: '2027-05-01', to: '2027-05-31' }, 'month', null);
    expect(r.currencies).toEqual(['EUR', 'USD']);
    expect(r.totals).toEqual([
      { currency: 'EUR', grossMinor: 4_000, refundsMinor: 0, netMinor: 4_000 },
      { currency: 'USD', grossMinor: 25_000, refundsMinor: 5_000, netMinor: 20_000 },
    ]);
    expect(r.series).toEqual([
      { bucket: '2027-05-01', currency: 'EUR', grossMinor: 4_000, refundsMinor: 0, netMinor: 4_000 },
      { bucket: '2027-05-01', currency: 'USD', grossMinor: 25_000, refundsMinor: 5_000, netMinor: 20_000 },
    ]);
  });

  it('ranks top events by net tickets, and by gross within each currency', () => {
    const rows = [
      { eventId: EV_A, metric: 'tickets', currency: '', value: 5 },
      { eventId: EV_A, metric: 'refunded_tickets', currency: '', value: 4 },
      { eventId: EV_A2, metric: 'tickets', currency: '', value: 3 },
      { eventId: EV_A2, metric: 'orders', currency: '', value: 2 },
      { eventId: EV_A, metric: 'gross', currency: 'USD', value: 100 },
      { eventId: EV_A2, metric: 'gross', currency: 'USD', value: 300 },
      { eventId: EV_A2, metric: 'gross', currency: 'EUR', value: 50 },
    ] as const;
    expect(topEventCounts(rows).map((r) => [r.eventId, r.tickets])).toEqual([
      [EV_A2, 3],
      [EV_A, 1],
    ]);
    expect(topEventRevenue(rows, 1).map((r) => [r.currency, r.eventId, r.grossMinor])).toEqual([
      ['EUR', EV_A2, 50],
      ['USD', EV_A2, 300],
    ]);
  });

  it('serializes counts without any money field, and revenue only through its own DTO', () => {
    const keys = JSON.stringify(Object.keys(OrgDashboardDto.shape));
    expect(keys).not.toMatch(/minor|gross|refundsMinor|currenc|revenue/i);
    const r = buildCounts(daily, [], { from: '2027-05-03', to: '2027-05-03' }, 'day', NOW);
    const parsed = OrgDashboardDto.parse({
      asOf: NOW,
      timeZone: 'UTC',
      from: '2027-05-03',
      to: '2027-05-03',
      granularity: 'day',
      eventId: null,
      warehouse: 'postgres',
      hasData: true,
      ...r,
      topEvents: [
        { eventId: EV_A, name: 'A', slug: 'a', registrations: 1, tickets: 1, checkins: 0, grossMinor: 9 },
      ],
    });
    expect(JSON.stringify(parsed)).not.toMatch(/grossMinor|USD|EUR/);
    expect(Object.keys(OrgRevenueDto.shape)).toContain('currencies');
  });
});

describe('snapshots', () => {
  const snap = (daily: EventSnapshot['daily']): EventSnapshot => ({
    eventId: EV_A,
    timeZone: 'America/Chicago',
    daily,
    state: {
      startsAt: new Date('2027-05-06T00:00:00Z'),
      endsAt: new Date('2027-05-06T04:00:00Z'),
      endDay: '2027-05-05',
      validTickets: 3,
      checkedIn: 1,
    },
  });

  it('folds duplicates, drops zeros and hashes independently of row order', () => {
    const rows = [
      { day: '2027-05-03', metric: 'orders', currency: '', value: 1 },
      { day: '2027-05-03', metric: 'orders', currency: '', value: 2 },
      { day: '2027-05-02', metric: 'gross', currency: 'USD', value: 0 },
    ] as const;
    expect(foldDaily(rows)).toEqual([{ day: '2027-05-03', metric: 'orders', currency: '', value: 3 }]);
    const a = snap([
      { day: '2027-05-03', metric: 'orders', currency: '', value: 3 },
      { day: '2027-05-01', metric: 'gross', currency: 'USD', value: 10 },
    ]);
    const b = snap([...a.daily].reverse());
    expect(hashSnapshot(a)).toBe(hashSnapshot(b));
    expect(hashSnapshot(a)).not.toBe(hashSnapshot({ ...a, timeZone: 'UTC' }));
    expect(hashSnapshot(a)).not.toBe(hashSnapshot({ ...a, state: null }));
  });

  it('diffs stored rows: unchanged rows are not written again', () => {
    const stored = [
      { id: 'r1', day: '2027-05-03', metric: 'orders', currency: '', value: 3 },
      { id: 'r2', day: '2027-05-04', metric: 'orders', currency: '', value: 1 },
    ];
    const same = diffDaily(stored, [
      { day: '2027-05-03', metric: 'orders', currency: '', value: 3 },
      { day: '2027-05-04', metric: 'orders', currency: '', value: 1 },
    ]);
    expect(same).toEqual({ upserts: [], removed: [] });
    const changed = diffDaily(stored, [{ day: '2027-05-03', metric: 'orders', currency: '', value: 4 }]);
    expect(changed.upserts).toEqual([{ day: '2027-05-03', metric: 'orders', currency: '', value: 4 }]);
    expect(changed.removed).toEqual(['r2']);
  });
});

describe('Tinybird adapter against the fake', () => {
  const setup = () => {
    const fake = fakeTinybird({ now: () => NOW });
    const wh = tinybirdWarehouse({ ...fake.config, fetch: fake.fetch, now: () => NOW });
    return { fake, wh };
  };
  const state = {
    startsAt: new Date('2027-05-06T00:00:00Z'),
    endsAt: new Date('2027-05-06T04:00:00Z'),
    endDay: '2027-05-05',
    validTickets: 3,
    checkedIn: 1,
  };
  const range = { from: '2027-05-01', to: '2027-05-31' };

  it("keeps two orgs' rows apart: every query carries the caller's signed org", async () => {
    const { fake, wh } = setup();
    await wh.writeEvent(
      scopeOf(ORG_A),
      {
        eventId: EV_A,
        timeZone: 'UTC',
        daily: [
          { day: '2027-05-03', metric: 'orders', currency: '', value: 2 },
          { day: '2027-05-03', metric: 'gross', currency: 'USD', value: 5_000 },
        ],
        state,
      },
      1,
    );
    await wh.writeEvent(
      scopeOf(ORG_B),
      {
        eventId: EV_B,
        timeZone: 'UTC',
        daily: [{ day: '2027-05-03', metric: 'orders', currency: '', value: 7 }],
        state,
      },
      1,
    );
    expect(await wh.dailyTotals(scopeOf(ORG_A), range)).toEqual([
      { day: '2027-05-03', metric: 'orders', currency: '', value: 2 },
      { day: '2027-05-03', metric: 'gross', currency: 'USD', value: 5_000 },
    ]);
    expect(await wh.dailyTotals(scopeOf(ORG_B), range)).toEqual([
      { day: '2027-05-03', metric: 'orders', currency: '', value: 7 },
    ]);
    expect((await wh.eventTotals(scopeOf(ORG_B), range)).map((r) => r.eventId)).toEqual([EV_B]);
    expect((await wh.eventStates(scopeOf(ORG_A), range)).map((r) => r.eventId)).toEqual([EV_A]);
    // Another org's event id as a filter finds nothing: the org is pinned by the token.
    expect(await wh.dailyTotals(scopeOf(ORG_A), { ...range, eventId: EV_B })).toEqual([]);
    fake.assertEveryQueryScoped();
    const queries = fake.calls.filter((c) => c.kind === 'query');
    expect(queries).toHaveLength(5);
    for (const q of queries) expect(q.orgIds[0]).toBe(q.tokenOrgId);
    for (const c of fake.calls.filter((x) => x.kind === 'append')) expect(c.orgIds).toHaveLength(1);
    for (const r of Object.values(fake.datasources).flat()) expect([ORG_A, ORG_B]).toContain(r.org_id);
  });

  it('refuses a query whose URL names another org than its token, an unsigned and an expired token', async () => {
    const { fake } = setup();
    const url = (org: string) =>
      `${fake.config.apiUrl}/v0/pipes/${TINYBIRD_PIPES.dailyTotals}.json?org_id=${org}&from=2027-01-01&to=2027-12-31`;
    const tokenA = signPipeToken(
      fake.config,
      TINYBIRD_PIPES.dailyTotals,
      ORG_A,
      new Date(NOW.getTime() + 60_000),
    );
    const get = (u: string, token: string) =>
      fake.fetch(u, { headers: { authorization: `Bearer ${token}` } });
    expect((await get(url(ORG_B), tokenA)).status).toBe(403);
    expect((await get(url(ORG_A), tokenA)).status).toBe(200);
    expect((await get(url(ORG_A), 'not.a.jwt')).status).toBe(403);
    const forged = signPipeToken(
      { ...fake.config, signingKey: 'other' },
      TINYBIRD_PIPES.dailyTotals,
      ORG_A,
      NOW,
    );
    expect((await get(url(ORG_A), forged)).status).toBe(403);
    const expired = signPipeToken(
      fake.config,
      TINYBIRD_PIPES.dailyTotals,
      ORG_A,
      new Date(NOW.getTime() - 1),
    );
    expect((await get(url(ORG_A), expired)).status).toBe(403);
    const otherPipe = signPipeToken(
      fake.config,
      TINYBIRD_PIPES.eventTotals,
      ORG_A,
      new Date(NOW.getTime() + 60_000),
    );
    expect((await get(url(ORG_A), otherPipe)).status).toBe(403);
    const noOrg = `${fake.config.apiUrl}/v0/pipes/${TINYBIRD_PIPES.dailyTotals}.json?from=2027-01-01`;
    expect((await get(noOrg, tokenA)).status).toBe(400);
    expect(() => fake.assertEveryQueryScoped()).toThrow(/unscoped or refused/);
  });

  it('refuses appends without the append token or with a row missing its org', async () => {
    const { fake } = setup();
    const post = (token: string, body: string) =>
      fake.fetch(`${fake.config.apiUrl}/v0/events?name=${TINYBIRD_DATASOURCES.daily}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body,
      });
    expect((await post('wrong', JSON.stringify({ org_id: ORG_A }))).status).toBe(403);
    expect((await post(fake.config.appendToken, JSON.stringify({ event_id: EV_A }))).status).toBe(400);
    expect(fake.datasources[TINYBIRD_DATASOURCES.daily]).toHaveLength(0);
  });

  it('serves only the newest version of an event: removed rows and deleted events vanish', async () => {
    const { wh } = setup();
    const s = scopeOf(ORG_A);
    await wh.writeEvent(
      s,
      {
        eventId: EV_A,
        timeZone: 'UTC',
        daily: [
          { day: '2027-05-03', metric: 'orders', currency: '', value: 2 },
          { day: '2027-05-04', metric: 'orders', currency: '', value: 1 },
        ],
        state,
      },
      10,
    );
    await wh.writeEvent(
      s,
      {
        eventId: EV_A,
        timeZone: 'UTC',
        daily: [{ day: '2027-05-03', metric: 'orders', currency: '', value: 3 }],
        state,
      },
      11,
    );
    expect(await wh.dailyTotals(s, range)).toEqual([
      { day: '2027-05-03', metric: 'orders', currency: '', value: 3 },
    ]);
    await wh.writeEvent(s, { eventId: EV_A, timeZone: 'UTC', daily: [], state: null }, 12);
    expect(await wh.dailyTotals(s, range)).toEqual([]);
    expect(await wh.eventStates(s, range)).toEqual([]);
  });

  it('serves fixture rows and rejects a pipe that returns another org’s row', async () => {
    const { fake, wh } = setup();
    fake.seed(TINYBIRD_DATASOURCES.daily, [
      {
        org_id: ORG_A,
        event_id: EV_A,
        version: 1,
        day: '2027-05-02',
        metric: 'checkins',
        currency: '',
        value: 9,
      },
    ]);
    expect(await wh.dailyTotals(scopeOf(ORG_A), range)).toEqual([
      { day: '2027-05-02', metric: 'checkins', currency: '', value: 9 },
    ]);
    const leaky = tinybirdWarehouse({
      ...fake.config,
      now: () => NOW,
      fetch: (async () =>
        new Response(
          JSON.stringify({
            data: [{ org_id: ORG_B, day: '2027-05-02', metric: 'orders', currency: '', value: 1 }],
          }),
        )) as typeof fetch,
    });
    await expect(leaky.dailyTotals(scopeOf(ORG_A), range)).rejects.toBeInstanceOf(TinybirdError);
  });
});

describe('configuration and event schemas', () => {
  it('uses Postgres unless Tinybird is configured, and refuses a half configuration', () => {
    expect(warehouseFromEnv({}).name).toBe('postgres');
    expect(configuredWarehouseName({})).toBe('postgres');
    expect(warehouseFromEnv({ ANALYTICS_WAREHOUSE: 'tinybird', TINYBIRD_API_URL: 'fake' }).name).toBe(
      'tinybird',
    );
    expect(() => warehouseFromEnv({ ANALYTICS_WAREHOUSE: 'tinybird' })).toThrow(/TINYBIRD_APPEND_TOKEN/);
    expect(() => warehouseFromEnv({ ANALYTICS_WAREHOUSE: 'clickhouse' })).toThrow(/postgres or tinybird/);
    expect(() =>
      warehouseFromEnv({ ANALYTICS_WAREHOUSE: 'tinybird', TINYBIRD_API_URL: 'fake', NODE_ENV: 'production' }),
    ).toThrow(/development and CI only/);
  });

  it('subscribes to exact event versions with a payload schema each', () => {
    for (const key of WAREHOUSE_EVENTS) expect(key).toMatch(/^[a-z_]+(\.[a-z_]+)+@\d+$/);
    expect(
      WAREHOUSE_EVENT_SCHEMAS['order.paid@1'].safeParse({ orderId: EV_A, extra: 'kept out' }).success,
    ).toBe(true);
    expect(WAREHOUSE_EVENT_SCHEMAS['order.paid@1'].safeParse({ eventId: EV_A }).success).toBe(false);
    expect(WAREHOUSE_EVENT_SCHEMAS['ticket.admitted@1'].safeParse({ eventId: 'nope' }).success).toBe(false);
  });
});
