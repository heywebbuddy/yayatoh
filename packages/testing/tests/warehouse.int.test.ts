import {
  type AnalyticsWarehouse,
  applyUnpublishedWarehouseEvents,
  backfillOrgNow,
  backfillStatusQuery,
  catchUpWarehouse,
  computeEventSnapshotTx,
  dashboardQueries,
  dayIn,
  type FakeTinybird,
  fakeTinybird,
  ingestEventTx,
  type OrgDashboardDto,
  type OrgRevenueDto,
  postgresWarehouse,
  runBackfill,
  runBackfillPage,
  startBackfillCommand,
  TINYBIRD_DATASOURCES,
  tinybirdWarehouse,
  WAREHOUSE_CONSUMER,
  WAREHOUSE_EVENTS,
  warehouseIngestor,
} from '@yayatoh/analytics';
import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { scanTicketCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { type Ctx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { consumeEvent, type PublishedEvent } from '@yayatoh/platform';
import { type MetricValue, orgReportQuery } from '@yayatoh/reports';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';
import { buy, newEvent, publish, refund, ticketsOf, typeOf } from './metrics-helpers.ts';

/**
 * M6.2a analytics warehouse: the org dashboards read the warehouse port; the Postgres rollups
 * and the Tinybird adapter (against its fake) give the same answers, and both match the source
 * tables to the cent (the M1.12 org report); two orgs never mix on either adapter; ingest is
 * idempotent by event id; a backfill after live ingest changes nothing; backfills are paged,
 * resumable and rate limited; money needs `finance:read`.
 */

let a: OrgFixture;
let b: OrgFixture;
let admin: AdminSql;
let usd: string;
let eur: string;
let financeId: string;
let scannerId: string;
/** After the events below end: their no-shows count. */
const AFTER = new Date('2028-06-03T12:00:00Z');
const pg = dashboardQueries(postgresWarehouse);

const counts = (f: OrgFixture, input: Record<string, unknown>, ctx: Ctx = f.ctx({ now: AFTER }), q = pg) =>
  executeQuery(q.orgDashboardQuery, input, ctx, ports);
const revenue = (f: OrgFixture, input: Record<string, unknown>, ctx: Ctx = f.ctx({ now: AFTER }), q = pg) =>
  executeQuery(q.orgRevenueQuery, input, ctx, ports);

/** Every day with data in the org's rollups (min/max), so a dashboard range covers it all. */
async function dataRange(f: OrgFixture) {
  const [r] = await admin<{ min: string; max: string }[]>`
    select min(day)::text as min, max(day)::text as max from (
      select day from analytics.daily_rollups where org_id = ${f.org.id}
      union all select end_day from analytics.event_rollups where org_id = ${f.org.id}) d`;
  return { from: r?.min as string, to: r?.max as string };
}

const metric = (ms: readonly MetricValue[], key: string, currency: string | null = null) =>
  ms.find((m) => m.key === key && m.currency === currency)?.value ?? 0;

/** The rollup rows as stored, with their row versions (a write changes xmin). */
async function storedRows(orgId: string) {
  return admin<{ id: string; xmin: string; value: string }[]>`
    select id, xmin::text, value::text from analytics.daily_rollups where org_id = ${orgId}
    union all
    select id, xmin::text, valid_tickets::text from analytics.event_rollups where org_id = ${orgId}
    union all
    select id, xmin::text, hash from analytics.event_sync where org_id = ${orgId}
    order by 1`;
}

async function orgEventIds(orgId: string) {
  const rows = await admin<
    { id: string }[]
  >`select id from events.events where org_id = ${orgId} order by id`;
  return rows.map((r) => r.id);
}

async function forgetTinybirdSync() {
  await admin`delete from analytics.event_sync where adapter = 'tinybird' and org_id in (${a.org.id}, ${b.org.id})`;
}

const tinybird = (fake: FakeTinybird): AnalyticsWarehouse =>
  tinybirdWarehouse({ ...fake.config, fetch: fake.fetch });
const withoutAdapter = <T extends { warehouse: string }>(d: T) => ({ ...d, warehouse: 'x' });

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  admin = adminClient();
  // Org A: a USD event and a EUR event (sales, a comp, refunds, a check-in), both ended by AFTER.
  usd = await newEvent(a, 'Warehouse night');
  const ga = await typeOf(a, usd, 'General', 5000);
  const free = await typeOf(a, usd, 'Guest pass', 0, 10);
  await publish(a, usd);
  const p1 = await buy(a, usd, [{ ticketTypeId: ga, quantity: 3 }], 'Wanda', { pay: 'succeed' });
  const p2 = await buy(a, usd, [{ ticketTypeId: ga, quantity: 2 }], 'Walt', { pay: 'succeed' });
  await buy(a, usd, [{ ticketTypeId: free, quantity: 2 }], 'Comp');
  await buy(a, usd, [{ ticketTypeId: ga, quantity: 1 }], 'Declined', { pay: 'fail' });
  const [t0, t1] = await ticketsOf(a, p1.id);
  await refund(a, p1.id, { reason: 'requested_by_customer', ticketIds: [t0?.id] });
  await refund(a, p2.id, { reason: 'goodwill', amountMinor: 1234 });
  await executeCommand(
    scanTicketCommand,
    { eventId: usd, code: t1?.short_code ?? '' },
    a.ctx({ now: new Date('2028-06-01T23:30:00Z') }),
    ports,
  );
  eur = await newEvent(a, 'Soirée entrepôt', 'EUR', 'Europe/Paris');
  const entree = await typeOf(a, eur, 'Entrée', 4000);
  await publish(a, eur);
  const e1 = await buy(a, eur, [{ ticketTypeId: entree, quantity: 2 }], 'Elodie', {
    pay: 'succeed',
    currency: 'EUR',
  });
  await refund(a, e1.id, { reason: 'goodwill', amountMinor: 999 });
  // Org B: one sale of its own.
  const bEvent = await newEvent(b, 'Bravo warehouse');
  const bt = await typeOf(b, bEvent, 'Seat', 7000);
  await publish(b, bEvent);
  await buy(b, bEvent, [{ ticketTypeId: bt, quantity: 4 }], 'Bianca', { pay: 'succeed' });
  // Live ingest, as the worker would.
  await catchUpWarehouse(a.org.id);
  await catchUpWarehouse(b.org.id);
  financeId = uuidv7();
  scannerId = uuidv7();
  await executeCommand(addMemberCommand, { userId: financeId, role: 'finance' }, a.ctx(), ports);
  await executeCommand(addMemberCommand, { userId: scannerId, role: 'scanner' }, a.ctx(), ports);
});

afterAll(async () => {
  await admin?.end();
  await closePools();
});

describe('dashboards match the source tables to the cent', () => {
  it('equal the M1.12 org report over all of each fixture org’s data (both currencies)', async () => {
    for (const f of [a, b]) {
      const range = await dataRange(f);
      const all = await executeQuery(orgReportQuery, {}, f.ctx(), ports);
      const period = await executeQuery(orgReportQuery, range, f.ctx(), ports);
      // The range covers everything (period = all time for sales, refunds and check-ins).
      for (const k of ['orders.sold', 'tickets.sold', 'tickets.refunded', 'checkins.tickets'])
        expect(metric(period.metrics, k)).toBe(metric(all.metrics, k));
      const d = await counts(f, { ...range, granularity: 'month' });
      expect(d.totals).toMatchObject({
        registrations: metric(all.metrics, 'orders.sold'),
        tickets: metric(all.metrics, 'tickets.sold'),
        compTickets: metric(all.metrics, 'tickets.comp'),
        refundedTickets: metric(all.metrics, 'tickets.refunded'),
        checkins: metric(all.metrics, 'checkins.tickets'),
      });
      // The series adds up to the totals.
      for (const k of ['registrations', 'tickets', 'checkins', 'noShows'] as const)
        expect(d.series.reduce((x, s) => x + s[k], 0)).toBe(d.totals[k]);
      const r = await revenue(f, { ...range, granularity: 'week' });
      for (const c of all.currencies) {
        const t = r.totals.find((x) => x.currency === c);
        const gross = metric(all.metrics, 'sales.gross', c);
        const refunds = metric(all.metrics, 'sales.refunds', c);
        if (gross === 0 && refunds === 0) continue;
        expect(t).toEqual({
          currency: c,
          grossMinor: gross,
          refundsMinor: refunds,
          netMinor: gross - refunds,
        });
      }
      expect(r.currencies.length).toBeGreaterThan(0);
    }
  });

  it('keeps USD and EUR apart and nets refunds per currency (hand-computed)', async () => {
    const range = await dataRange(a);
    const usdOnly = await revenue(a, { ...range, eventId: usd });
    expect(usdOnly.currencies).toEqual(['USD']);
    // Fees passed on are inside the order totals, so the expected figures come from the orders.
    const [orders] = await admin<{ gross: string }[]>`
      select sum(total_minor)::text as gross from orders.orders
      where event_id = ${usd} and status in ('paid', 'partially_refunded', 'refunded')`;
    const [refunds] = await admin<{ amount: string }[]>`
      select sum(r.amount_minor)::text as amount from orders.refunds r join orders.orders o on o.id = r.order_id
      where o.event_id = ${usd} and r.status = 'succeeded'`;
    expect(usdOnly.totals[0]).toEqual({
      currency: 'USD',
      grossMinor: Number(orders?.gross),
      refundsMinor: Number(refunds?.amount),
      netMinor: Number(orders?.gross) - Number(refunds?.amount),
    });
    const eurOnly = await revenue(a, { ...range, eventId: eur });
    expect(eurOnly.currencies).toEqual(['EUR']);
    expect(eurOnly.totals[0]?.refundsMinor).toBe(999);
    const both = await revenue(a, range);
    expect(both.currencies).toEqual(expect.arrayContaining(['EUR', 'USD']));
    expect(new Set(both.series.map((s) => s.currency)).size).toBe(both.currencies.length);
  });

  it('counts registrations, net tickets, comps, check-ins and no-shows of an ended event', async () => {
    const range = await dataRange(a);
    const d = await counts(a, { ...range, eventId: usd });
    // Paid: 3 + 2 tickets, one refunded; a comp order of 2; one check-in; the declined order is not sold.
    expect(d.totals).toEqual({
      registrations: 3,
      ticketsIssued: 5,
      tickets: 4,
      compTickets: 2,
      refundedTickets: 1,
      checkins: 1,
      // Valid: 4 paid + 2 comp = 6, one checked in.
      noShows: 5,
    });
    // Before the event ended there are no no-shows yet.
    const before = await counts(
      a,
      { ...range, eventId: usd },
      a.ctx({ now: new Date('2028-06-01T12:00:00Z') }),
    );
    expect(before.totals.noShows).toBe(0);
    expect(d.topEvents[0]).toMatchObject({
      eventId: usd,
      name: 'Warehouse night',
      tickets: 4,
      registrations: 3,
    });
  });

  it('puts days in the org time zone (America/Chicago), weeks on Mondays and months on the 1st', async () => {
    const [order] = await admin<{ paid_at: Date }[]>`
      select paid_at from orders.orders where event_id = ${usd} and status = 'paid' order by paid_at limit 1`;
    const day = dayIn(order?.paid_at as Date, 'America/Chicago');
    const [row] = await admin<{ n: number }[]>`
      select count(*)::int as n from analytics.daily_rollups
      where org_id = ${a.org.id} and event_id = ${usd} and metric = 'orders' and day = ${day}::date`;
    expect(row?.n).toBe(1);
    const byDay = await counts(a, { from: day, to: day, eventId: usd });
    expect(byDay.timeZone).toBe('America/Chicago');
    expect(byDay.series).toHaveLength(1);
    expect(byDay.series[0]?.registrations).toBeGreaterThan(0);
    const byWeek = await counts(a, { from: day, to: day, granularity: 'week', eventId: usd });
    expect(new Date(`${byWeek.series[0]?.bucket}T00:00:00Z`).getUTCDay()).toBe(1);
    const byMonth = await counts(a, { from: day, to: day, granularity: 'month', eventId: usd });
    expect(byMonth.series[0]?.bucket).toBe(`${day.slice(0, 7)}-01`);
  });

  it('refuses a period that ends before it starts or spans more than two years', async () => {
    await expect(counts(a, { from: '2027-02-02', to: '2027-02-01' })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'from_after_to' },
    });
    await expect(counts(a, { from: '2024-01-01', to: '2026-01-02' })).rejects.toMatchObject({
      details: { reason: 'range_too_long' },
    });
    await expect(counts(a, { granularity: 'year' })).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('permissions and entitlement', () => {
  it('gives the viewer counts but no money; finance gets revenue; a scanner gets neither', async () => {
    const viewer = userCtx(a.viewerId, a.org.id, { now: AFTER });
    const d = await counts(a, {}, viewer);
    expect(JSON.stringify(d)).not.toMatch(/Minor|USD|EUR|gross/);
    await expect(revenue(a, {}, viewer)).rejects.toMatchObject({ code: 'forbidden' });
    const fin = userCtx(financeId, a.org.id, { now: AFTER });
    expect((await revenue(a, await dataRange(a), fin)).totals.length).toBeGreaterThan(0);
    const scanner = userCtx(scannerId, a.org.id, { now: AFTER });
    await expect(counts(a, {}, scanner)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(revenue(a, {}, scanner)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses dashboards and backfills when the analytics_pro module is revoked', async () => {
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'analytics_pro', effect: 'revoke', reason: 'test' },
      systemCtx(a.org.id),
      ports,
    );
    try {
      await expect(counts(a, {})).rejects.toMatchObject({ code: 'module_not_enabled' });
      await expect(revenue(a, {})).rejects.toMatchObject({ code: 'module_not_enabled' });
      await expect(executeCommand(startBackfillCommand, {}, a.ctx(), ports)).rejects.toMatchObject({
        code: 'module_not_enabled',
      });
    } finally {
      await executeCommand(
        setEntitlementOverrideCommand,
        { moduleKey: 'analytics_pro', effect: 'grant', reason: 'test' },
        systemCtx(a.org.id),
        ports,
      );
    }
  });
});

describe('isolation through the warehouse (Postgres)', () => {
  it("never mixes two orgs' rows: totals, top events, the event filter and RLS", async () => {
    const aEvents = new Set(await orgEventIds(a.org.id));
    const bEvents = await orgEventIds(b.org.id);
    const da = await counts(a, await dataRange(a));
    const db = await counts(b, await dataRange(b));
    for (const e of da.topEvents) expect(aEvents.has(e.eventId)).toBe(true);
    for (const e of db.topEvents) expect(aEvents.has(e.eventId)).toBe(false);
    await expect(counts(a, { eventId: bEvents[0] })).rejects.toMatchObject({ code: 'not_found' });
    // Under org A's tenant, org B's warehouse rows do not exist; the adapter finds nothing for B's events.
    const seen = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(sql`
        select (select count(*) from analytics.daily_rollups where org_id = ${b.org.id})
          + (select count(*) from analytics.event_rollups where org_id = ${b.org.id})
          + (select count(*) from analytics.event_sync where org_id = ${b.org.id})
          + (select count(*) from analytics.ingest_log where org_id = ${b.org.id})
          + (select count(*) from analytics.backfill_runs where org_id = ${b.org.id}) as n`),
    );
    expect(Number(seen[0]?.n)).toBe(0);
    const viaPort = await withTenant(systemCtx(a.org.id), (tx) =>
      postgresWarehouse.dailyTotals(
        { ctx: systemCtx(a.org.id), tx },
        { from: '2000-01-01', to: '2100-01-01', eventId: bEvents[0] },
      ),
    );
    expect(viaPort).toEqual([]);
    // A new sale in B leaves A's dashboard as it was.
    const before = await counts(a, await dataRange(a));
    const bEvent = await newEvent(b, 'Bravo encore');
    const bt = await typeOf(b, bEvent, 'Seat', 1500);
    await publish(b, bEvent);
    await buy(b, bEvent, [{ ticketTypeId: bt, quantity: 1 }], 'Bert', { pay: 'succeed' });
    await applyUnpublishedWarehouseEvents(b.org.id);
    expect(await counts(a, await dataRange(a))).toEqual(before);
  });

  it('cannot write a row into another org (RLS WITH CHECK)', async () => {
    await expect(
      withTenant(systemCtx(a.org.id), (tx) =>
        tx.execute(sql`insert into analytics.daily_rollups (org_id, event_id, day, metric, currency, value)
          values (${b.org.id}, ${usd}, '2027-01-01', 'orders', '', 1)`),
      ),
    ).rejects.toThrow();
  });
});

describe('idempotent ingest and backfill', () => {
  it('ingests each source event once: a second delivery and a full outbox replay write nothing', async () => {
    const before = await storedRows(a.org.id);
    const [{ n: logged } = { n: 0 }] = await admin<{ n: number }[]>`
      select count(*)::int as n from analytics.ingest_log where org_id = ${a.org.id}`;
    const events = await admin<PublishedEvent[]>`
      select id, org_id as "orgId", type, version, aggregate_type as "aggregateType",
        aggregate_id as "aggregateId", payload, 0 as "logSeq", replayed
      from platform.domain_events
      where org_id = ${a.org.id} and (type || '@' || version) in ${admin(WAREHOUSE_EVENTS)}`;
    expect(events.length).toBeGreaterThan(5);
    const sub = warehouseIngestor(postgresWarehouse);
    for (const e of events) expect(await consumeEvent(sub, e)).toBe(false);
    // Replay the whole outbox again (the processed marks forgotten): the ingest log refuses it.
    await admin`delete from platform.processed_events where org_id = ${a.org.id} and consumer = ${WAREHOUSE_CONSUMER}`;
    expect(await catchUpWarehouse(a.org.id)).toBe(events.length);
    const outcomes = await withTenant(systemCtx(a.org.id), async (tx) => {
      const out = [];
      for (const e of events) out.push(await ingestEventTx(tx, postgresWarehouse, e));
      return out;
    });
    expect(new Set(outcomes)).toEqual(new Set(['duplicate']));
    expect(await storedRows(a.org.id)).toEqual(before);
    const [{ n: after } = { n: 0 }] = await admin<{ n: number }[]>`
      select count(*)::int as n from analytics.ingest_log where org_id = ${a.org.id}`;
    expect(after).toBe(logged);
  });

  it('writes a new event once, then nothing on replays', async () => {
    const ev = await newEvent(a, 'Once only');
    const tt = await typeOf(a, ev, 'Door', 2500);
    await publish(a, ev);
    await buy(a, ev, [{ ticketTypeId: tt, quantity: 1 }], 'Olive', { pay: 'succeed' });
    expect(await applyUnpublishedWarehouseEvents(a.org.id)).toBeGreaterThan(0);
    // Each source event recomputes the event from the sources, so the first one already wrote
    // everything (the sale was committed before the ingest ran) and the rest found nothing new.
    const log = await admin<{ outcome: string; n: number }[]>`
      select outcome, count(*)::int as n from analytics.ingest_log
      where org_id = ${a.org.id} and event_id = ${ev} group by 1 order by 1`;
    expect(log[0]).toEqual({ outcome: 'unchanged', n: expect.any(Number) });
    expect(log[1]).toEqual({ outcome: 'written', n: 1 });
    const rows = await storedRows(a.org.id);
    expect(await applyUnpublishedWarehouseEvents(a.org.id)).toBe(0);
    await admin`delete from platform.processed_events where org_id = ${a.org.id} and consumer = ${WAREHOUSE_CONSUMER}`;
    await catchUpWarehouse(a.org.id);
    expect(await storedRows(a.org.id)).toEqual(rows);
  });

  it('a backfill after live ingest changes nothing', async () => {
    for (const f of [a, b]) {
      const before = await storedRows(f.org.id);
      const r = await backfillOrgNow(f.org.id, postgresWarehouse);
      expect(r.state).toBe('done');
      expect(r.events).toBe((await orgEventIds(f.org.id)).length);
      expect(r.written).toBe(0);
      expect(await storedRows(f.org.id)).toEqual(before);
    }
  });

  it('a backfill repairs what the rollups lack and equals a recomputation from the sources', async () => {
    await admin`delete from analytics.daily_rollups where org_id = ${a.org.id} and event_id = ${usd}`;
    await admin`delete from analytics.event_sync where org_id = ${a.org.id} and event_id = ${usd}`;
    const r = await backfillOrgNow(a.org.id, postgresWarehouse);
    expect(r.written).toBe(1);
    const computed = await withTenant(systemCtx(a.org.id), (tx) =>
      computeEventSnapshotTx(tx, usd, 'America/Chicago'),
    );
    const stored = await admin<{ day: string; metric: string; currency: string; value: string }[]>`
      select day::text, metric, currency, value::text from analytics.daily_rollups
      where org_id = ${a.org.id} and event_id = ${usd} order by day, metric, currency`;
    expect(stored.map((s) => ({ ...s, value: Number(s.value) }))).toEqual(computed.daily);
  });
});

describe('backfill runs', () => {
  it('only owners and admins start one, one at a time', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    await expect(executeCommand(startBackfillCommand, {}, viewer, ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const fin = userCtx(financeId, a.org.id);
    await expect(executeCommand(startBackfillCommand, {}, fin, ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const run = await executeCommand(startBackfillCommand, {}, a.ctx(), ports);
    expect(run).toMatchObject({ status: 'running', adapter: 'postgres', pagesDone: 0 });
    await expect(executeCommand(startBackfillCommand, {}, a.ctx(), ports)).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(await executeQuery(backfillStatusQuery, {}, viewer, ports)).toMatchObject({ id: run.id });
    await runBackfill(a.org.id, run.id, postgresWarehouse, { ignoreRateLimit: true });
    expect(await executeQuery(backfillStatusQuery, {}, viewer, ports)).toMatchObject({
      id: run.id,
      status: 'done',
      eventsWritten: 0,
    });
    const [audit] = await admin<{ n: number }[]>`
      select count(*)::int as n from platform.audit_events
      where org_id = ${a.org.id} and action = 'analytics.backfill_started' and target_id = ${run.id}`;
    expect(audit?.n).toBe(1);
  });

  it('works in pages: rate limited, resumable after a restart, each event once', async () => {
    await forgetTinybirdSync();
    const fake = fakeTinybird();
    const wh = tinybird(fake);
    const t0 = new Date(Date.now() + 1_000);
    const run = await executeCommand(
      startBackfillCommand,
      { pageSize: 1, pagesPerMinute: 2 },
      b.ctx({ now: t0 }),
      ports,
    );
    const ids = await orgEventIds(b.org.id);
    expect(ids.length).toBeGreaterThan(2);
    expect(await runBackfillPage(b.org.id, run.id, wh, { now: t0 })).toMatchObject({
      state: 'page',
      events: 1,
    });
    // The next page is due 30 s later (2 pages a minute).
    expect(
      await runBackfillPage(b.org.id, run.id, wh, { now: new Date(t0.getTime() + 1_000) }),
    ).toMatchObject({
      state: 'waiting',
    });
    expect(
      await runBackfillPage(b.org.id, run.id, wh, { now: new Date(t0.getTime() + 30_000) }),
    ).toMatchObject({
      state: 'page',
    });
    // A new worker picks the run up where it stopped.
    const rest = await runBackfill(b.org.id, run.id, wh, { ignoreRateLimit: true });
    expect(rest.state).toBe('done');
    const [row] = await admin<
      { status: string; pages_done: number; events_done: number; events_written: number }[]
    >`
      select status, pages_done, events_done, events_written from analytics.backfill_runs where id = ${run.id}`;
    expect(row).toEqual({
      status: 'done',
      pages_done: ids.length + 1,
      events_done: ids.length,
      events_written: ids.length,
    });
    const appended = (fake.datasources[TINYBIRD_DATASOURCES.states] ?? [])
      .map((r) => String(r.event_id))
      .sort();
    expect(appended).toEqual(ids);
    for (const r of Object.values(fake.datasources).flat()) expect(r.org_id).toBe(b.org.id);
  });

  it('a failed page stops the run; a new run skips what is already in the warehouse', async () => {
    await forgetTinybirdSync();
    const fake = fakeTinybird();
    const real = tinybird(fake);
    let writes = 0;
    const flaky: AnalyticsWarehouse = {
      ...real,
      name: 'tinybird',
      writeEvent: async (scope, snap, version) => {
        writes += 1;
        if (writes === 2) throw new Error('Tinybird is unavailable');
        return real.writeEvent(scope, snap, version);
      },
    };
    const run = await executeCommand(startBackfillCommand, { pageSize: 1 }, b.ctx(), ports);
    const r = await runBackfill(b.org.id, run.id, flaky, { ignoreRateLimit: true });
    expect(r.state).toBe('failed');
    const [row] = await admin<{ status: string; error: string; events_done: number }[]>`
      select status, error, events_done from analytics.backfill_runs where id = ${run.id}`;
    expect(row).toEqual({ status: 'failed', error: 'Tinybird is unavailable', events_done: 1 });
    const again = await executeCommand(startBackfillCommand, { pageSize: 10 }, b.ctx(), ports);
    const done = await runBackfill(b.org.id, again.id, real, { ignoreRateLimit: true });
    expect(done.state).toBe('done');
    expect(done.written).toBe((await orgEventIds(b.org.id)).length - 1);
  });
});

describe('the Tinybird adapter (fake) answers like Postgres and keeps orgs apart', () => {
  let fake: FakeTinybird;
  let tb: ReturnType<typeof dashboardQueries>;
  beforeAll(async () => {
    await forgetTinybirdSync();
    fake = fakeTinybird();
    const wh = tinybird(fake);
    tb = dashboardQueries(wh);
    await backfillOrgNow(a.org.id, wh);
    await backfillOrgNow(b.org.id, wh);
  });

  it('gives the same dashboards as the Postgres rollups for both orgs, to the cent', async () => {
    for (const f of [a, b]) {
      const range = await dataRange(f);
      for (const granularity of ['day', 'week', 'month'] as const) {
        const input = { ...range, granularity };
        expect(withoutAdapter(await counts(f, input, undefined, tb))).toEqual(
          withoutAdapter(await counts(f, input)),
        );
        expect(withoutAdapter(await revenue(f, input, undefined, tb))).toEqual(
          withoutAdapter(await revenue(f, input)),
        );
      }
      const d: OrgDashboardDto = await counts(f, range, undefined, tb);
      const r: OrgRevenueDto = await revenue(f, range, undefined, tb);
      expect(d.warehouse).toBe('tinybird');
      expect(r.warehouse).toBe('tinybird');
    }
  });

  it('carries the org on every append and every query (the fake asserts it)', async () => {
    fake.assertEveryQueryScoped();
    const queries = fake.calls.filter((c) => c.kind === 'query');
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) expect([a.org.id, b.org.id]).toContain(q.tokenOrgId);
    for (const c of fake.calls.filter((x) => x.kind === 'append')) {
      expect(c.status).toBe(202);
      expect(c.orgIds).toHaveLength(1);
    }
    const rows = Object.values(fake.datasources).flat();
    expect(new Set(rows.map((r) => r.org_id))).toEqual(new Set([a.org.id, b.org.id]));
    const aTop = await counts(a, await dataRange(a), undefined, tb);
    const bIds = new Set(await orgEventIds(b.org.id));
    for (const e of aTop.topEvents) expect(bIds.has(e.eventId)).toBe(false);
  });

  it('ingests live events once and a backfill afterwards appends nothing', async () => {
    const wh = tinybird(fake);
    const ev = await newEvent(a, 'Tinybird live');
    const tt = await typeOf(a, ev, 'Floor', 3000);
    await publish(a, ev);
    await buy(a, ev, [{ ticketTypeId: tt, quantity: 2 }], 'Tina', { pay: 'succeed' });
    const appendsBefore = fake.calls.filter((c) => c.kind === 'append').length;
    expect(await applyUnpublishedWarehouseEvents(a.org.id, wh)).toBeGreaterThan(0);
    const appendsAfter = fake.calls.filter((c) => c.kind === 'append').length;
    expect(appendsAfter).toBeGreaterThan(appendsBefore);
    // Replay: refused by the ingest log, nothing appended.
    await admin`delete from platform.processed_events where org_id = ${a.org.id} and consumer = ${WAREHOUSE_CONSUMER}`;
    await catchUpWarehouse(a.org.id, wh);
    expect(fake.calls.filter((c) => c.kind === 'append').length).toBe(appendsAfter);
    const r = await backfillOrgNow(a.org.id, wh);
    expect(r.written).toBe(0);
    expect(fake.calls.filter((c) => c.kind === 'append').length).toBe(appendsAfter);
    const d = await counts(
      a,
      { from: dayIn(new Date(), 'America/Chicago'), to: dayIn(new Date(), 'America/Chicago'), eventId: ev },
      undefined,
      tb,
    );
    expect(d.totals.tickets).toBe(2);
  });
});
