import { addGuestCommand } from '@yayatoh/attendees';
import {
  deviceContext,
  enrollDeviceCommand,
  heartbeatCommand,
  scanTicketCommand,
  syncScansCommand,
  undoAdmissionCommand,
} from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { buildRow } from '@yayatoh/floorplan';
import { type Ctx, createCtx, DomainError, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { recordBoxOfficeSaleCommand } from '@yayatoh/orders';
import {
  catchUpSubscriber,
  consumeEvent,
  defineSubscriber,
  emitEvents,
  type PublishedEvent,
} from '@yayatoh/platform';
import {
  analyticsForwarder,
  applyUnpublishedMetricEvents,
  catchUpMetrics,
  eventFinanceKpisQuery,
  eventFinanceMetricsQuery,
  eventFinanceQuery,
  eventKpisQuery,
  eventMetricsQuery,
  eventReportQuery,
  eventTimeseriesQuery,
  fakeAnalyticsSink,
  METRIC_EVENTS,
  METRICS_CONSUMER,
  metricShardOf,
  metricsPipelineQuery,
  metricsProjector,
  postgresAnalyticsSink,
  rebuildEventMetricsCommand,
  toAnalyticsEventTx,
} from '@yayatoh/reports';
import {
  assignSeatCategoryCommand,
  assignSeatsCommand,
  publishEventLayoutCommand,
  setEventLayoutCommand,
  unassignSeatsCommand,
} from '@yayatoh/seating';
import { claimContext, claimTicketCommand, createClaimLinksCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';
import {
  buy,
  computedState,
  metricValue,
  newEvent,
  pay,
  projectedState,
  publish,
  refund,
  ticketsOf,
  typeOf,
} from './metrics-helpers.ts';

/**
 * M3.1a metrics pipeline: every source event updates the projections exactly once; replays and
 * duplicates converge; the projection equals both the live report (the M1.12 golden queries'
 * subject) and a rebuild from the sources; backfilled events never trigger side effects; the
 * hot counter is sharded; nothing crosses orgs; the analytics sink carries no personal data.
 */

let a: OrgFixture;
let b: OrgFixture;
let admin: AdminSql;
let usd: string;
let eur: string;
let ga: string;
let bEvent: string;
const DURING = new Date('2028-06-01T23:30:00Z');
const paid: { id: string; totalMinor: number }[] = [];

const metricsOf = (f: OrgFixture, eventId: string, keys: string[], ctx: Ctx = f.ctx()) =>
  executeQuery(eventMetricsQuery, { eventId, keys }, ctx, ports);
const scan = (f: OrgFixture, eventId: string, code: string, now = DURING) =>
  executeCommand(scanTicketCommand, { eventId, code }, f.ctx({ now }), ports);
const project = (f: OrgFixture) => catchUpMetrics(f.org.id);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  admin = adminClient();
  usd = await newEvent(a, 'Metrics night');
  ga = await typeOf(a, usd, 'General', 5000);
  const free = await typeOf(a, usd, 'Guest pass', 0, 10);
  await publish(a, usd);
  paid.push(await buy(a, usd, [{ ticketTypeId: ga, quantity: 3 }], 'Paula', { pay: 'succeed' }));
  paid.push(await buy(a, usd, [{ ticketTypeId: ga, quantity: 2 }], 'Pedro', { pay: 'succeed' }));
  await buy(a, usd, [{ ticketTypeId: free, quantity: 2 }], 'Comfy');
  await buy(a, usd, [{ ticketTypeId: ga, quantity: 1 }], 'Fay', { pay: 'fail' });
  await buy(a, usd, [{ ticketTypeId: ga, quantity: 1 }], 'Penny', { pay: 'none' });
  await executeCommand(
    recordBoxOfficeSaleCommand,
    {
      eventId: usd,
      items: [{ ticketTypeId: ga, quantity: 2 }],
      buyer: { email: 'door@example.test', name: 'Doreen Door' },
      method: 'cash',
    },
    a.ctx(),
    ports,
  );
  const [t0, t1] = await ticketsOf(a, (paid[0] as { id: string }).id);
  await refund(a, (paid[0] as { id: string }).id, { reason: 'requested_by_customer', ticketIds: [t0?.id] });
  await refund(a, (paid[1] as { id: string }).id, { reason: 'goodwill', amountMinor: 1000 });
  await scan(a, usd, t1?.short_code ?? '');

  eur = await newEvent(a, 'Soirée', 'EUR', 'Europe/Paris');
  const entree = await typeOf(a, eur, 'Entrée', 4000);
  await publish(a, eur);
  await buy(a, eur, [{ ticketTypeId: entree, quantity: 2 }], 'Eloise', { pay: 'succeed', currency: 'EUR' });

  bEvent = await newEvent(b, 'Bravo gala');
  const bType = await typeOf(b, bEvent, 'General', 7000);
  await publish(b, bEvent);
  await buy(b, bEvent, [{ ticketTypeId: bType, quantity: 4 }], 'Bruno', { pay: 'succeed' });
  await project(a);
  await project(b);
});
afterAll(async () => {
  await admin?.end();
  await closePools();
});

const stripAsOf = <T extends { asOf: Date }>(xs: readonly T[]) => xs.map(({ asOf: _a, ...rest }) => rest);

describe('metrics projection (M3.1a)', () => {
  it('applies every metric event exactly once and samples its lag', async () => {
    const [events] = await admin<{ n: number }[]>`
      select count(*)::int as n from platform.domain_events
      where org_id = ${a.org.id} and type || '@' || version = any(${[...METRIC_EVENTS]})`;
    const [handled] = await admin<{ n: number }[]>`
      select count(*)::int as n from platform.processed_events
      where org_id = ${a.org.id} and consumer = ${METRICS_CONSUMER}`;
    expect(handled?.n).toBe(events?.n);
    expect(events?.n).toBeGreaterThan(10);
    // Nothing left to do; a second delivery of any event is refused.
    expect(await project(a)).toBe(0);
    const [one] = await admin<PublishedEvent[]>`
      select id, org_id as "orgId", type, version, aggregate_type as "aggregateType",
        aggregate_id as "aggregateId", payload, 0 as "logSeq"
      from platform.domain_events where org_id = ${a.org.id} and type = 'order.paid' limit 1`;
    expect(await consumeEvent(metricsProjector(), one as PublishedEvent)).toBe(false);
    // One lag sample per live event handled.
    const [lag] = await admin<{ n: number; bad: number }[]>`
      select count(*)::int as n, count(*) filter (where lag_ms < 0 or projected_at < occurred_at)::int as bad
      from reports.projector_lag where org_id = ${a.org.id} and consumer = ${METRICS_CONSUMER}`;
    expect(lag?.n).toBe(events?.n);
    expect(lag?.bad).toBe(0);
    const stats = await executeQuery(metricsPipelineQuery, {}, a.ctx(), ports);
    expect(stats.samples).toBeGreaterThan(0);
    expect(stats.p95Ms).toBeGreaterThanOrEqual(stats.p50Ms);
  });

  it('dashboard tiles read from the projection and equal the live report (golden)', async () => {
    for (const eventId of [usd, eur]) {
      const tiles = await executeQuery(eventKpisQuery, { eventId }, a.ctx(), ports);
      const report = await executeQuery(eventReportQuery, { eventId }, a.ctx(), ports);
      expect(tiles.source).toBe('projection');
      expect(tiles.hasSales).toBe(report.hasSales);
      expect(tiles.currencies).toEqual(report.currencies);
      expect(stripAsOf(tiles.metrics)).toEqual(stripAsOf(report.metrics));
      const fin = await executeQuery(eventFinanceKpisQuery, { eventId }, a.ctx(), ports);
      const liveFin = await executeQuery(eventFinanceQuery, { eventId }, a.ctx(), ports);
      expect(fin.currencies).toEqual(liveFin.currencies);
      expect(stripAsOf(fin.metrics)).toEqual(stripAsOf(liveFin.metrics));
    }
    const usdTiles = await executeQuery(eventKpisQuery, { eventId: usd }, a.ctx(), ports);
    const v = (k: string) => usdTiles.metrics.find((m) => m.key === k)?.value;
    // 3 + 2 paid, 2 comps, 2 box office; one ticket refunded; one failed payment; one check-in.
    expect(v('orders.sold')).toBe(4);
    expect(v('orders.failed')).toBe(1);
    expect(v('tickets.sold')).toBe(6);
    expect(v('tickets.comp')).toBe(2);
    expect(v('checkins.tickets')).toBe(1);
  });

  it('an event with no projection yet is read live, with the same numbers', async () => {
    const e = await newEvent(a, 'Not projected');
    const t = await typeOf(a, e, 'General', 1000);
    await publish(a, e);
    await buy(a, e, [{ ticketTypeId: t, quantity: 1 }], 'Lena', { pay: 'succeed' });
    const tiles = await executeQuery(eventKpisQuery, { eventId: e }, a.ctx(), ports);
    const report = await executeQuery(eventReportQuery, { eventId: e }, a.ctx(), ports);
    expect(tiles.source).toBe('live');
    expect(stripAsOf(tiles.metrics)).toEqual(stripAsOf(report.metrics));
    // The dashboard applies what the relay has not published yet (no worker here) → projected.
    expect(await applyUnpublishedMetricEvents(a.org.id)).toBeGreaterThan(0);
    const after = await executeQuery(eventKpisQuery, { eventId: e }, a.ctx(), ports);
    expect(after.source).toBe('projection');
    expect(stripAsOf(after.metrics)).toEqual(stripAsOf(report.metrics));
    expect(await applyUnpublishedMetricEvents(a.org.id)).toBe(0);
  });

  it('the projection equals a rebuild from the source tables', async () => {
    for (const e of [usd, eur]) expect(await projectedState(a, e)).toEqual(await computedState(a, e));
    expect(await projectedState(b, bEvent)).toEqual(await computedState(b, bEvent));
  });

  it('a failed payment counts until the buyer retries', async () => {
    const o = await buy(a, usd, [{ ticketTypeId: ga, quantity: 1 }], 'Retry', { pay: 'fail' });
    await project(a);
    expect(metricValue(await projectedState(a, usd), 'orders.failed')).toBe(2);
    // The buyer tries again: the order leaves the failed state (order.payment_started).
    await pay(a, o.id, o.totalMinor, 'none');
    await project(a);
    const s = await projectedState(a, usd);
    expect(metricValue(s, 'orders.failed')).toBe(1);
    expect(metricValue(s, 'orders.sold')).toBe(4);
    expect(s).toEqual(await computedState(a, usd));
  });

  it('check-ins: the sharded counter and per-minute series follow scans and undo', async () => {
    const o = await buy(a, usd, [{ ticketTypeId: ga, quantity: 4 }], 'Quad', { pay: 'succeed' });
    const tickets = await ticketsOf(a, o.id);
    const before = metricValue(await projectedState(a, usd), 'checkins.tickets');
    const at = new Date('2028-06-01T23:41:30Z');
    const results = [];
    for (const t of tickets) results.push(await scan(a, usd, t.short_code, at));
    await project(a);
    let s = await projectedState(a, usd);
    expect(metricValue(s, 'checkins.tickets')).toBe(before + 4);
    expect(s.series.find(([k]) => k === 'checkins.tickets||minute|2028-06-01T23:41:00.000Z')?.[1]).toBe(4);
    expect(s.series.find(([k]) => k === 'checkins.tickets||hour|2028-06-01T23:00:00.000Z')?.[1]).toBe(
      before + 4,
    );
    await executeCommand(
      undoAdmissionCommand,
      { eventId: usd, admissionId: results[0]?.admissionId },
      a.ctx(),
      ports,
    );
    await project(a);
    s = await projectedState(a, usd);
    expect(metricValue(s, 'checkins.tickets')).toBe(before + 3);
    expect(s.series.find(([k]) => k === 'checkins.tickets||minute|2028-06-01T23:41:00.000Z')?.[1]).toBe(3);
    // Every counter shard exists and the shards add up to the total.
    const shards = await admin<{ shard: number }[]>`
      select shard from reports.metric_snapshots where event_id = ${usd} and key = 'checkins.tickets' order by shard`;
    expect(shards.map((r) => r.shard)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(s).toEqual(await computedState(a, usd));
  });

  it('offline sync: new admissions count, and an earlier offline scan moves the admission', async () => {
    const e = await newEvent(a, 'Offline doors', 'USD', 'UTC');
    const t = await typeOf(a, e, 'General', 1000);
    await publish(a, e);
    const o = await buy(a, e, [{ ticketTypeId: t, quantity: 2 }], 'Otto', { pay: 'succeed' });
    const [x, y] = await ticketsOf(a, o.id);
    const { token } = await executeCommand(enrollDeviceCommand, { label: 'North' }, a.ctx(), ports);
    const dc = await deviceContext(token);
    if (!dc) throw new Error('device did not resolve');
    const doors = new Date('2028-06-01T22:00:00Z');
    const dctx = (now: Date): Ctx => ({ ...dc.ctx, now });
    // Online admission of x at 22:30, then the device syncs an earlier offline admission (22:10).
    await scan(a, e, x?.short_code ?? '', new Date('2028-06-01T22:30:00Z'));
    const q = (code: string, min: number) => ({
      scanId: uuidv7(),
      code,
      verdict: 'admit' as const,
      deviceTs: new Date(doors.getTime() + min * 60_000).toISOString(),
      clockOffsetMs: 0,
    });
    await executeCommand(
      syncScansCommand,
      { eventId: e, scans: [q(x?.short_code ?? '', 10), q(y?.short_code ?? '', 12)] },
      dctx(new Date('2028-06-01T22:40:00Z')),
      ports,
    );
    await project(a);
    const s = await projectedState(a, e);
    expect(metricValue(s, 'checkins.tickets')).toBe(2);
    const minute = (hhmm: string) =>
      s.series.find(([k]) => k === `checkins.tickets||minute|2028-06-01T${hhmm}:00.000Z`)?.[1];
    expect(minute('22:10')).toBe(1);
    expect(minute('22:12')).toBe(1);
    expect(minute('22:30')).toBeUndefined();
    expect(s).toEqual(await computedState(a, e));
  });

  it('devices online follow enrolment and heartbeats (org grain)', async () => {
    const { token } = await executeCommand(enrollDeviceCommand, { label: 'Gate 9' }, a.ctx(), ports);
    const dc = await deviceContext(token);
    if (!dc) throw new Error('device did not resolve');
    await executeCommand(
      heartbeatCommand,
      { batteryPct: 80, queueDepth: 0, clockOffsetMs: 0 },
      dc.ctx,
      ports,
    );
    await project(a);
    const r = await metricsOf(a, usd, ['devices.online']);
    expect(r.metrics).toEqual([
      expect.objectContaining({ key: 'devices.online', unit: 'count', currency: null, value: 1 }),
    ]);
  });

  it('tickets distributed and seats occupied', async () => {
    const e = await newEvent(a, 'Seated dinner', 'USD', 'UTC');
    const t = await typeOf(a, e, 'Dinner', 3000, 20);
    const row = buildRow({ label: 'R', count: 4, x: 100, y: 100 });
    await executeCommand(
      setEventLayoutCommand,
      { eventId: e, doc: { version: 1, width: 1600, height: 1000, items: [row] } },
      a.ctx(),
      ports,
    );
    await executeCommand(
      assignSeatCategoryCommand,
      { eventId: e, itemIds: [row.id], ticketTypeId: t },
      a.ctx(),
      ports,
    );
    await executeCommand(publishEventLayoutCommand, { eventId: e }, a.ctx(), ports);
    await publish(a, e);
    const guest = await executeCommand(
      addGuestCommand,
      { eventId: e, name: 'Gwen', email: 'gwen@metrics.test' },
      a.ctx(),
      ports,
    );
    const guestId = guest.id;
    await executeCommand(
      assignSeatsCommand,
      { eventId: e, attendeeIds: [guestId], itemId: row.id },
      a.ctx(),
      ports,
    );
    await project(a);
    expect(metricValue(await projectedState(a, e), 'seats.occupied')).toBe(1);
    await executeCommand(unassignSeatsCommand, { eventId: e, attendeeIds: [guestId] }, a.ctx(), ports);
    await project(a);
    expect(metricValue(await projectedState(a, e), 'seats.occupied')).toBe(0);

    // A claim link handed on and claimed: one ticket distributed.
    const [tk] = await ticketsOf(a, (paid[1] as { id: string }).id);
    const links = await executeCommand(
      createClaimLinksCommand,
      { eventId: usd, ticketIds: [tk?.id] },
      a.ctx(),
      ports,
    );
    const token = links[0]?.token ?? '';
    const c = await claimContext(token);
    if (!c) throw new Error('claim did not resolve');
    await executeCommand(
      claimTicketCommand,
      { claimId: c.id, name: 'Kim', email: 'kim@metrics.test' },
      c.ctx,
      ports,
    );
    await project(a);
    const r = await metricsOf(a, usd, ['tickets.distributed', 'seats.occupied']);
    expect(r.metrics.map((m) => [m.key, m.value])).toEqual([
      ['tickets.distributed', 1],
      ['seats.occupied', 0],
    ]);
  });

  it('backfilled (replayed) events update metrics but never trigger side effects', async () => {
    const e = await newEvent(a, 'Migrated', 'USD', 'UTC');
    const t = await typeOf(a, e, 'General', 1000);
    await publish(a, e);
    const o = await buy(a, e, [{ ticketTypeId: t, quantity: 1 }], 'Hist', { pay: 'succeed' });
    await project(a);
    const [tk] = await ticketsOf(a, o.id);
    // A legacy check-in loaded directly, then its backfilled event (replayed = true).
    const admittedAt = new Date('2025-01-01T20:00:00Z');
    const [adm] = await admin<{ id: string }[]>`
      insert into checkin.admissions (org_id, event_id, ticket_id, day, admitted_at)
      values (${a.org.id}, ${e}, ${tk?.id ?? ''}, '2025-01-01', ${admittedAt}) returning id`;
    await withTenant(systemCtx(a.org.id), (tx) =>
      emitEvents(
        tx,
        systemCtx(a.org.id),
        [
          {
            type: 'ticket.admitted',
            version: 1,
            aggregateType: 'ticket',
            aggregateId: tk?.id ?? '',
            payload: {
              orgId: a.org.id,
              eventId: e,
              ticketId: tk?.id,
              admissionId: adm?.id,
              admittedAt: admittedAt.toISOString(),
            },
          },
        ],
        { replayed: true },
      ),
    );
    const mailed: string[] = [];
    const mailer = defineSubscriber({
      name: 'test.replay-mailer',
      events: ['ticket.admitted@1'],
      handle: async (_tx, ev) => void mailed.push(ev.id),
    });
    const [lagBefore] = await admin<{ n: number }[]>`
      select count(*)::int as n from reports.projector_lag where org_id = ${a.org.id}`;
    await project(a);
    await catchUpSubscriber(mailer, a.org.id);
    await catchUpSubscriber(analyticsForwarder(postgresAnalyticsSink), a.org.id);
    const s = await projectedState(a, e);
    expect(metricValue(s, 'checkins.tickets')).toBe(1);
    expect(s.series.find(([k]) => k === 'checkins.tickets||hour|2025-01-01T20:00:00.000Z')?.[1]).toBe(1);
    const [lagAfter] = await admin<{ n: number }[]>`
      select count(*)::int as n from reports.projector_lag where org_id = ${a.org.id}`;
    expect(lagAfter?.n).toBe(lagBefore?.n);
    // The side-effect subscriber saw only live admissions, never the backfilled one.
    const [replayedId] = await admin<{ id: string }[]>`
      select id from platform.domain_events where org_id = ${a.org.id} and replayed`;
    expect(mailed).not.toContain(replayedId?.id);
    const [processed] = await admin<{ n: number }[]>`
      select count(*)::int as n from platform.processed_events
      where consumer = 'test.replay-mailer' and event_id = ${replayedId?.id ?? ''}`;
    expect(processed?.n).toBe(1);
    // Analytics keeps history, flagged as replayed.
    const hist = await admin<{ name: string; replayed: boolean }[]>`
      select name, replayed from reports.analytics_events where source_event_id = ${replayedId?.id ?? ''}`;
    expect(hist).toEqual([{ name: 'ticket_admitted', replayed: true }]);
  });

  it('duplicate and replayed deliveries converge (the same events again under new ids)', async () => {
    const before = await projectedState(a, usd);
    const events = await admin<PublishedEvent[]>`
      select id, org_id as "orgId", type, version, aggregate_type as "aggregateType",
        aggregate_id as "aggregateId", payload, 0 as "logSeq"
      from platform.domain_events
      where org_id = ${a.org.id} and type || '@' || version = any(${[...METRIC_EVENTS]})
        and (payload->>'eventId' = ${usd} or type like 'order.%') order by id`;
    const projector = metricsProjector();
    // Delivered again, concurrently and under fresh ids (a replayed relay).
    await Promise.all(events.map((e) => consumeEvent(projector, { ...e, id: uuidv7() })));
    expect(await projectedState(a, usd)).toEqual(before);
    expect(before).toEqual(await computedState(a, usd));
  });

  it('rebuild repairs drift and equals the sources; viewers may not run it', async () => {
    await admin`update reports.metric_snapshots set value = value + 99 where event_id = ${usd}`;
    await admin`delete from reports.metric_timeseries where event_id = ${usd} and bucket = 'hour'`;
    expect(await projectedState(a, usd)).not.toEqual(await computedState(a, usd));
    const r = await executeCommand(rebuildEventMetricsCommand, { eventId: usd }, a.ctx(), ports);
    expect(r.snapshotRows).toBeGreaterThan(0);
    expect(r.seriesPoints).toBeGreaterThan(0);
    expect(await projectedState(a, usd)).toEqual(await computedState(a, usd));
    const viewer = { ...a.ctx(), actor: { type: 'user' as const, userId: a.viewerId } };
    await expect(
      executeCommand(rebuildEventMetricsCommand, { eventId: usd }, viewer, ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      executeCommand(rebuildEventMetricsCommand, { eventId: bEvent }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('metrics queries (Command Center API)', () => {
  it('getEventMetrics returns allowlisted values; finance keys need finance:read', async () => {
    const r = await metricsOf(a, usd, ['sales.gross', 'checkins.rate', 'tickets.sold', 'pipeline.lagP95Ms']);
    expect(Object.keys(r).sort()).toEqual(['eventId', 'metrics']);
    for (const m of r.metrics)
      expect(Object.keys(m).sort()).toEqual(['asOf', 'currency', 'key', 'unit', 'value']);
    expect(r.metrics.find((m) => m.key === 'sales.gross')).toMatchObject({ unit: 'money', currency: 'USD' });
    expect(r.metrics.find((m) => m.key === 'pipeline.lagP95Ms')).toMatchObject({ unit: 'duration' });
    // Finance keys are not accepted by the non-finance query.
    await expect(metricsOf(a, usd, ['finance.net'])).rejects.toMatchObject({ code: 'validation_failed' });
    const fin = await executeQuery(
      eventFinanceMetricsQuery,
      { eventId: usd, keys: ['finance.net'] },
      a.ctx(),
      ports,
    );
    const live = await executeQuery(eventFinanceQuery, { eventId: usd }, a.ctx(), ports);
    expect(fin.metrics.map((m) => [m.currency, m.value])).toEqual(
      live.metrics.filter((m) => m.key === 'finance.net').map((m) => [m.currency, m.value]),
    );
    const viewer = { ...a.ctx(), actor: { type: 'user' as const, userId: a.viewerId } };
    expect((await metricsOf(a, usd, ['tickets.sold'], viewer)).metrics).toHaveLength(1);
    await expect(
      executeQuery(eventFinanceMetricsQuery, { eventId: usd, keys: ['finance.net'] }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('getTimeseries sums shards per bucket and validates the range', async () => {
    const hour = await executeQuery(
      eventTimeseriesQuery,
      {
        eventId: usd,
        key: 'sales.gross',
        bucket: 'hour',
        from: new Date(Date.now() - 2 * 86_400_000),
        to: new Date(Date.now() + 86_400_000),
      },
      a.ctx(),
      ports,
    );
    const computed = await computedState(a, usd);
    const expected = computed.series
      .filter(([k]) => k.startsWith('sales.gross|USD|hour|'))
      .map(([k, v]) => [k.split('|')[3], v]);
    expect(hour.points.map((p) => [p.bucketStart.toISOString(), p.value])).toEqual(expected);
    expect(hour.points.every((p) => p.currency === 'USD')).toBe(true);
    const counts = await executeQuery(
      eventTimeseriesQuery,
      {
        eventId: usd,
        key: 'checkins.tickets',
        bucket: 'minute',
        from: '2028-06-01T23:00:00Z',
        to: '2028-06-02T00:00:00Z',
      },
      a.ctx(),
      ports,
    );
    expect(counts.points.every((p) => p.currency === null)).toBe(true);
    expect(counts.points.reduce((s, p) => s + p.value, 0)).toBeGreaterThan(0);
    for (const bad of [
      { from: '2028-06-02T00:00:00Z', to: '2028-06-01T00:00:00Z', bucket: 'hour' },
      { from: '2028-06-01T00:00:00Z', to: '2028-06-03T00:00:01Z', bucket: 'minute' },
    ])
      await expect(
        executeQuery(eventTimeseriesQuery, { eventId: usd, key: 'orders.sold', ...bad }, a.ctx(), ports),
      ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('nothing crosses orgs', async () => {
    await expect(executeQuery(eventKpisQuery, { eventId: usd }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(executeQuery(eventFinanceKpisQuery, { eventId: usd }, b.ctx(), ports)).rejects.toMatchObject(
      {
        code: 'not_found',
      },
    );
    await expect(metricsOf(b, usd, ['tickets.sold'])).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeQuery(
        eventTimeseriesQuery,
        {
          eventId: usd,
          key: 'orders.sold',
          bucket: 'hour',
          from: '2028-06-01T00:00:00Z',
          to: '2028-06-02T00:00:00Z',
        },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    // Under B's tenant, A's projections do not exist.
    const rows = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ n: number }>(sql`
        select (select count(*) from reports.metric_snapshots where event_id = ${usd}::uuid)
          + (select count(*) from reports.metric_timeseries where event_id = ${usd}::uuid)
          + (select count(*) from reports.analytics_events where org_id = ${a.org.id}::uuid)
          + (select count(*) from reports.projector_lag where org_id = ${a.org.id}::uuid) as n`),
    );
    expect(Number(rows[0]?.n)).toBe(0);
    // Pipeline stats count only the org's own samples.
    const [own] = await admin<{ n: number }[]>`
      select count(*)::int as n from reports.projector_lag
      where org_id = ${b.org.id} and projected_at >= now() - interval '1 day'`;
    const stats = await executeQuery(metricsPipelineQuery, { windowMinutes: 1440 }, b.ctx(), ports);
    expect(stats.samples).toBe(own?.n);
  });

  it('a scanner (no orders:read) cannot read metrics', async () => {
    const scannerId = uuidv7();
    await executeCommand(
      (await import('@yayatoh/tenancy')).addMemberCommand,
      { userId: scannerId, role: 'scanner' },
      a.ctx(),
      ports,
    );
    const ctx = createCtx({ orgId: a.org.id, actor: { type: 'user', userId: scannerId } });
    await expect(metricsOf(a, usd, ['checkins.tickets'], ctx)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeQuery(eventKpisQuery, { eventId: usd }, ctx, ports)).rejects.toBeInstanceOf(
      DomainError,
    );
  });
});

describe('sharded counter contention', () => {
  it('concurrent check-ins on many shards count exactly, and a busy shard blocks only itself', async () => {
    const e = await newEvent(a, 'Door rush', 'USD', 'UTC');
    const t = await typeOf(a, e, 'General', 1000, 400);
    await publish(a, e);
    const tickets: { id: string; short_code: string }[] = [];
    for (let i = 0; i < 4; i++) {
      const o = await buy(a, e, [{ ticketTypeId: t, quantity: 10 }], `Crowd${i}`, { pay: 'succeed' });
      tickets.push(...(await ticketsOf(a, o.id)));
    }
    await project(a);
    const at = new Date('2028-06-01T23:10:00Z');
    // Pick the blocking trio first (40 tickets over 8 shards always give a same-shard pair).
    const shardOf = (id: string) => metricShardOf(id, 8);
    const heldTicket = tickets.find((x) => tickets.some((y) => y !== x && shardOf(y.id) === shardOf(x.id)));
    if (!heldTicket) throw new Error('no same-shard pair');
    const held = shardOf(heldTicket.id);
    const same = tickets.find((x) => x !== heldTicket && shardOf(x.id) === held);
    const other = tickets.find((x) => shardOf(x.id) !== held);
    if (!same || !other) throw new Error('need tickets on two shards');
    const crowd = tickets.filter((x) => x !== heldTicket && x !== same && x !== other).slice(0, 32);
    for (const tk of crowd) await scan(a, e, tk.short_code, at);
    const pending = await admin<PublishedEvent[]>`
      select id, org_id as "orgId", type, version, aggregate_type as "aggregateType",
        aggregate_id as "aggregateId", payload, 0 as "logSeq"
      from platform.domain_events d
      where org_id = ${a.org.id} and type = 'ticket.admitted' and payload->>'eventId' = ${e}
        and not exists (select 1 from platform.processed_events p
          where p.consumer = ${METRICS_CONSUMER} and p.event_id = d.id)`;
    expect(pending).toHaveLength(32);
    const projector = metricsProjector();
    const done = await Promise.all(pending.map((ev) => consumeEvent(projector, ev)));
    expect(done.every(Boolean)).toBe(true);
    expect(metricValue(await projectedState(a, e), 'checkins.tickets')).toBe(32);

    // Hold one counter shard's lock in another transaction: a check-in on another shard still
    // projects at once, one on the held shard waits until the lock is released.
    for (const tk of [same, other]) await scan(a, e, tk.short_code, at);
    const eventFor = async (ticketId: string) =>
      (
        await admin<PublishedEvent[]>`
        select id, org_id as "orgId", type, version, aggregate_type as "aggregateType",
          aggregate_id as "aggregateId", payload, 0 as "logSeq"
        from platform.domain_events where type = 'ticket.admitted' and payload->>'ticketId' = ${ticketId}`
      )[0] as PublishedEvent;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let locked: () => void = () => {};
    const isLocked = new Promise<void>((r) => {
      locked = r;
    });
    const holder = withTenant(systemCtx(a.org.id), async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`m:c:${a.org.id}:${e}:${held}`}, 0))`,
      );
      locked();
      await gate;
    });
    await isLocked;
    let sameDone = false;
    const sameP = consumeEvent(projector, await eventFor(same.id)).then(() => {
      sameDone = true;
    });
    const t0 = Date.now();
    await consumeEvent(projector, await eventFor(other.id));
    expect(Date.now() - t0).toBeLessThan(5_000);
    await new Promise((r) => setTimeout(r, 300));
    expect(sameDone).toBe(false);
    release();
    await holder;
    await sameP;
    expect(sameDone).toBe(true);
    const s = await projectedState(a, e);
    expect(metricValue(s, 'checkins.tickets')).toBe(34);
    expect(s).toEqual(await computedState(a, e));
  });
});

describe('analytics sink (no personal data)', () => {
  it('forwards allowlisted events once; no names, emails or person ids', async () => {
    await catchUpSubscriber(analyticsForwarder(postgresAnalyticsSink), a.org.id);
    expect(await catchUpSubscriber(analyticsForwarder(postgresAnalyticsSink), a.org.id)).toBe(0);
    const rows = await admin<{ name: string; props: Record<string, unknown>; event_id: string | null }[]>`
      select name, props, event_id from reports.analytics_events where org_id = ${a.org.id}`;
    const names = new Set(rows.map((r) => r.name));
    expect(names).toEqual(
      new Set(['order_paid', 'order_refunded', 'payment_failed', 'ticket_admitted', 'event_published']),
    );
    const text = JSON.stringify(rows);
    for (const pii of ['@', 'Paula', 'Doreen', 'example.test', 'Pedro']) expect(text).not.toContain(pii);
    const allowed: Record<string, string[]> = {
      order_paid: ['channel', 'currency', 'totalMinor'],
      order_refunded: ['amountMinor', 'currency', 'fully', 'tickets'],
      payment_failed: [],
      ticket_admitted: ['offline'],
      event_published: [],
    };
    for (const r of rows) expect(Object.keys(r.props).sort()).toEqual(allowed[r.name]);
    const [dupes] = await admin<{ n: number }[]>`
      select count(*)::int as n from (select source_event_id, name from reports.analytics_events
        where org_id = ${a.org.id} group by 1, 2 having count(*) > 1) d`;
    expect(dupes?.n).toBe(0);
    // The runtime role may only append.
    await expect(
      withTenant(systemCtx(a.org.id), (tx) =>
        tx.execute(sql`update reports.analytics_events set name = 'x'`),
      ),
    ).rejects.toThrow();
  });

  it('drops any property that is not allowlisted, even if a payload carries personal data', async () => {
    const e = await withTenant(systemCtx(a.org.id), (tx) =>
      toAnalyticsEventTx(tx, {
        id: uuidv7(),
        orgId: a.org.id,
        type: 'order.paid',
        version: 1,
        aggregateType: 'order',
        aggregateId: uuidv7(),
        payload: {
          eventId: usd,
          currency: 'USD',
          totalMinor: 1200,
          via: 'fake',
          buyerEmail: 'leak@example.test',
          buyerName: 'Leaky',
        },
        logSeq: 0,
        occurredAt: new Date().toISOString(),
        replayed: false,
      }),
    );
    const sink = fakeAnalyticsSink();
    await withTenant(systemCtx(a.org.id), (tx) => sink.emit(tx, e as never));
    expect(JSON.stringify(sink.events)).not.toMatch(/leak|Leaky/);
    expect(sink.events[0]?.props).toEqual({ currency: 'USD', totalMinor: 1200, channel: 'online' });
  });
});
