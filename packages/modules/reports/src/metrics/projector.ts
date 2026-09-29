import { checkinFactsTx, checkinSeriesTx, devicesOnlineTx } from '@yayatoh/checkin';
import { type TenantTx, withTenant } from '@yayatoh/db';
import { type EventDto, eventIdsTx, findEventTx } from '@yayatoh/events';
import { createCtx } from '@yayatoh/kernel';
import { orderMetricRefTx, refundMetricRefTx, refundSeriesTx, salesSeriesTx } from '@yayatoh/orders';
import {
  catchUpSubscriber,
  consumeEvent,
  defineSubscriber,
  eventKey,
  type PublishedEvent,
  type Subscriber,
  unpublishedPendingTx,
} from '@yayatoh/platform';
import { seatsOccupiedTx } from '@yayatoh/seating';
import { ticketsDistributedTx } from '@yayatoh/ticketing';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { metricSnapshots, metricTimeseries } from '../schema.ts';
import {
  BUCKETS,
  type Bucket,
  bucketEnd,
  bucketStart,
  COUNTER_SHARDS,
  checkinSeriesPoints,
  metricShardOf,
  REFRESH_REGISTRY_KEYS,
  SALES_SERIES_KEYS,
  SERIES_SHARDS,
  type SeriesPoint,
  salesSeriesPoints,
} from './catalog.ts';
import { gatherFactsTx } from './facts.ts';
import { deriveMetrics } from './registry.ts';

/** The consumer name (processed_events, pg-boss queue, lag samples). */
export const METRICS_CONSUMER = 'reports.metrics';

/** Domain events that change an event's current totals (the `refresh` class). */
export const REFRESH_EVENTS = [
  'order.paid@1',
  'order.refunded@1',
  'order.expired@1',
  'order.payment_failed@1',
  'order.payment_started@1',
  'order.disputed@1',
  'order.dispute_closed@1',
  'attendee.cancelled@1',
  'ticket_type.created@1',
  'ticket_type.updated@1',
  'ticket_type.archived@1',
  'ticket.claimed@1',
  'seating.assignments_changed@1',
] as const;
/** Check-ins at the door: the hot, sharded counter and its time series. */
export const CHECKIN_EVENTS = [
  'ticket.admitted@1',
  'ticket.admission_undone@1',
  'ticket.admission_moved@1',
] as const;
export const DEVICE_EVENTS = ['device.enrolled@1', 'device.state_changed@1', 'device.heartbeat@1'] as const;
export const METRIC_EVENTS = [...REFRESH_EVENTS, ...CHECKIN_EVENTS, ...DEVICE_EVENTS] as const;

const REFRESH_KEYS: string[] = [...REFRESH_REGISTRY_KEYS, 'tickets.distributed', 'seats.occupied'];
const COUNTER_KEY = 'checkins.tickets';

/**
 * Serialization (all transaction-scoped advisory locks, always taken in this order so two
 * projections never deadlock): event snapshot → counter shards ascending → the event's series
 * (shared by projections, exclusive for a rebuild) → series buckets sorted by key. Every value
 * is computed *after* its lock is held, from sources the statement sees committed, so the last
 * writer always writes the newest value: projections converge under concurrency and replay.
 */
const lockKey = {
  snapshot: (org: string, event: string) => `m:s:${org}:${event}`,
  counter: (org: string, event: string, shard: number) => `m:c:${org}:${event}:${shard}`,
  series: (org: string, event: string) => `m:t:${org}:${event}`,
  bucket: (org: string, event: string, group: string, b: Bucket, start: Date, shard: number) =>
    `m:t:${org}:${event}:${group}:${b}:${start.toISOString()}:${shard}`,
  devices: (org: string) => `m:d:${org}`,
};
async function lock(tx: TenantTx, key: string, mode: 'exclusive' | 'shared' = 'exclusive') {
  await (mode === 'shared'
    ? tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`)
    : tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`));
}

export interface SnapshotRow {
  readonly key: string;
  readonly currency: string;
  readonly shard: number;
  readonly value: number;
}

/** Pure-ish read: the `refresh` class values of one event, from its sources (L0 facts). */
async function refreshRowsTx(tx: TenantTx, event: EventDto, now: Date): Promise<SnapshotRow[]> {
  const { facts } = await gatherFactsTx(tx, { eventId: event.id }, event.currency);
  const rows: SnapshotRow[] = deriveMetrics(facts, REFRESH_REGISTRY_KEYS, now).map((v) => ({
    key: v.key,
    currency: v.currency ?? '',
    shard: 0,
    value: v.value,
  }));
  rows.push({
    key: 'tickets.distributed',
    currency: '',
    shard: 0,
    value: await ticketsDistributedTx(tx, event.id),
  });
  rows.push({ key: 'seats.occupied', currency: '', shard: 0, value: await seatsOccupiedTx(tx, event.id) });
  return rows;
}

/** The projection's rows computed live from the sources (an event not projected yet). */
export async function liveEventRowsTx(tx: TenantTx, event: EventDto, now: Date): Promise<SnapshotRow[]> {
  const rows = await refreshRowsTx(tx, event, now);
  const { tickets } = await checkinFactsTx(tx, { eventId: event.id });
  rows.push({ key: COUNTER_KEY, currency: '', shard: 0, value: tickets });
  return rows;
}

async function counterShardValueTx(tx: TenantTx, eventId: string, shard: number) {
  const r = await checkinFactsTx(tx, { eventId, shard: { index: shard, count: COUNTER_SHARDS } });
  return r.tickets;
}

async function insertSnapshotRows(
  tx: TenantTx,
  orgId: string,
  eventId: string | null,
  rows: readonly SnapshotRow[],
  sourceAt: Date | null,
) {
  if (rows.length === 0) return;
  await tx.insert(metricSnapshots).values(
    rows.map((r) => ({
      orgId,
      eventId,
      key: r.key,
      currency: r.currency,
      shard: r.shard,
      value: r.value,
      sourceAt,
      projectedAt: sql`clock_timestamp()` as unknown as Date,
    })),
  );
}

/** Recompute the `refresh` class of one event (under its snapshot lock) and make sure its counter exists. */
export async function refreshEventSnapshotTx(
  tx: TenantTx,
  orgId: string,
  eventId: string,
  now: Date,
  sourceAt: Date | null,
) {
  await lock(tx, lockKey.snapshot(orgId, eventId));
  const event = await findEventTx(tx, eventId);
  if (!event) {
    await tx.delete(metricSnapshots).where(eq(metricSnapshots.eventId, eventId));
    return;
  }
  const rows = await refreshRowsTx(tx, event, now);
  await tx
    .delete(metricSnapshots)
    .where(and(eq(metricSnapshots.eventId, eventId), inArray(metricSnapshots.key, REFRESH_KEYS)));
  await insertSnapshotRows(tx, orgId, eventId, rows, sourceAt);
  await ensureCounterShardsTx(tx, orgId, eventId, [], sourceAt);
}

/**
 * Recompute the given counter shards, plus any shard of the event's counter that does not exist
 * yet (a counter is always complete, so its sum is exact), in ascending shard order.
 */
async function ensureCounterShardsTx(
  tx: TenantTx,
  orgId: string,
  eventId: string,
  shards: readonly number[],
  sourceAt: Date | null,
) {
  const have = await tx
    .select({ shard: metricSnapshots.shard })
    .from(metricSnapshots)
    .where(and(eq(metricSnapshots.eventId, eventId), eq(metricSnapshots.key, COUNTER_KEY)));
  const present = new Set(have.map((r) => r.shard));
  const todo = new Set(shards);
  for (let s = 0; s < COUNTER_SHARDS; s++) if (!present.has(s)) todo.add(s);
  for (const shard of [...todo].sort((a, b) => a - b)) {
    await lock(tx, lockKey.counter(orgId, eventId, shard));
    const value = await counterShardValueTx(tx, eventId, shard);
    await tx
      .insert(metricSnapshots)
      .values({
        orgId,
        eventId,
        key: COUNTER_KEY,
        currency: '',
        shard,
        value,
        sourceAt,
        projectedAt: sql`clock_timestamp()` as unknown as Date,
      })
      .onConflictDoUpdate({
        target: [
          metricSnapshots.orgId,
          metricSnapshots.eventId,
          metricSnapshots.key,
          metricSnapshots.currency,
          metricSnapshots.shard,
        ],
        set: { value, sourceAt, projectedAt: sql`clock_timestamp()` },
      });
  }
}

type SeriesGroup = 'sales' | 'checkins';
interface BucketRef {
  readonly group: SeriesGroup;
  readonly bucket: Bucket;
  readonly start: Date;
  readonly shard: number;
}

/** The (bucket, shard) points around one source time, minute and hour. */
const bucketsAt = (group: SeriesGroup, at: Date, shard: number): BucketRef[] =>
  BUCKETS.map((bucket) => ({ group, bucket, start: bucketStart(at, bucket), shard }));

/** Recompute time-series points (each under its bucket lock, taken in a stable order). */
async function recomputeBucketsTx(tx: TenantTx, orgId: string, eventId: string, refs: readonly BucketRef[]) {
  if (refs.length === 0) return;
  await lock(tx, lockKey.series(orgId, eventId), 'shared');
  const keyed = refs.map((r) => ({
    ...r,
    lk: lockKey.bucket(orgId, eventId, r.group, r.bucket, r.start, r.shard),
  }));
  const unique = [...new Map(keyed.map((r) => [r.lk, r])).values()].sort((a, b) => (a.lk < b.lk ? -1 : 1));
  for (const r of unique) await lock(tx, r.lk);
  for (const r of unique) {
    const scope = {
      eventId,
      from: r.start,
      to: bucketEnd(r.start, r.bucket),
      shard: { index: r.shard, count: SERIES_SHARDS },
    };
    let points: SeriesPoint[];
    let keys: readonly string[];
    if (r.group === 'sales') {
      const sales = await salesSeriesTx(tx, scope, r.bucket, SERIES_SHARDS);
      const refunds = await refundSeriesTx(tx, scope, r.bucket, SERIES_SHARDS);
      points = salesSeriesPoints(r.bucket, sales, refunds);
      keys = SALES_SERIES_KEYS;
    } else {
      points = checkinSeriesPoints(r.bucket, await checkinSeriesTx(tx, scope, r.bucket, SERIES_SHARDS));
      keys = ['checkins.tickets'];
    }
    await tx
      .delete(metricTimeseries)
      .where(
        and(
          eq(metricTimeseries.eventId, eventId),
          eq(metricTimeseries.bucket, r.bucket),
          eq(metricTimeseries.bucketStart, r.start),
          eq(metricTimeseries.shard, r.shard),
          inArray(metricTimeseries.key, [...keys]),
        ),
      );
    await insertSeries(tx, orgId, eventId, points);
  }
}

async function insertSeries(tx: TenantTx, orgId: string, eventId: string, points: readonly SeriesPoint[]) {
  for (let i = 0; i < points.length; i += 1000) {
    const chunk = points.slice(i, i + 1000);
    await tx.insert(metricTimeseries).values(
      chunk.map((p) => ({
        orgId,
        eventId,
        key: p.key,
        currency: p.currency,
        bucket: p.bucket,
        bucketStart: p.bucketStart,
        shard: p.shard,
        value: p.value,
        projectedAt: sql`clock_timestamp()` as unknown as Date,
      })),
    );
  }
}

/** Devices online (org grain), recomputed under the org's devices lock. */
export async function refreshDevicesTx(tx: TenantTx, orgId: string, now: Date, sourceAt: Date | null) {
  await lock(tx, lockKey.devices(orgId));
  const value = await devicesOnlineTx(tx, now);
  await tx
    .delete(metricSnapshots)
    .where(and(isNull(metricSnapshots.eventId), eq(metricSnapshots.key, 'devices.online')));
  await insertSnapshotRows(
    tx,
    orgId,
    null,
    [{ key: 'devices.online', currency: '', shard: 0, value }],
    sourceAt,
  );
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown) => {
  const s = str(v);
  return s && UUID.test(s) ? s : null;
};
const date = (v: unknown) => {
  const s = str(v);
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/** Apply one domain event to the metric projections (inside the consumer's tenant transaction). */
export async function projectMetricEventTx(tx: TenantTx, event: PublishedEvent, now = new Date()) {
  const key = eventKey(event);
  const p = (event.payload ?? {}) as Record<string, unknown>;
  const sourceAt = event.occurredAt ? new Date(event.occurredAt) : null;
  const orgId = event.orgId;
  if ((DEVICE_EVENTS as readonly string[]).includes(key)) {
    await refreshDevicesTx(tx, orgId, now, sourceAt);
    return { eventId: null };
  }
  if ((CHECKIN_EVENTS as readonly string[]).includes(key)) {
    const eventId = uuid(p.eventId);
    const ticketId = uuid(p.ticketId);
    if (!eventId || !ticketId) return { eventId: null };
    await ensureCounterShardsTx(tx, orgId, eventId, [metricShardOf(ticketId, COUNTER_SHARDS)], sourceAt);
    const shard = metricShardOf(ticketId, SERIES_SHARDS);
    const times = [date(p.admittedAt), date(p.fromAdmittedAt)].filter((d): d is Date => d !== null);
    await recomputeBucketsTx(
      tx,
      orgId,
      eventId,
      times.flatMap((at) => bucketsAt('checkins', at, shard)),
    );
    return { eventId };
  }
  // Refresh class: find the event (payloads name it, or the order does).
  let eventId = uuid(p.eventId);
  const orderId = uuid(p.orderId);
  const refs: BucketRef[] = [];
  if (key === 'order.paid@1' && orderId) {
    const ref = await orderMetricRefTx(tx, orderId);
    eventId ??= ref?.eventId ?? null;
    if (ref?.paidAt) refs.push(...bucketsAt('sales', ref.paidAt, metricShardOf(orderId, SERIES_SHARDS)));
  } else if (key === 'order.refunded@1' && uuid(p.refundId)) {
    const ref = await refundMetricRefTx(tx, uuid(p.refundId) as string);
    eventId ??= ref?.eventId ?? null;
    if (ref?.completedAt)
      refs.push(...bucketsAt('sales', ref.completedAt, metricShardOf(ref.orderId, SERIES_SHARDS)));
  } else if (!eventId && orderId) {
    eventId = (await orderMetricRefTx(tx, orderId))?.eventId ?? null;
  }
  if (!eventId) return { eventId: null };
  await refreshEventSnapshotTx(tx, orgId, eventId, now, sourceAt);
  await recomputeBucketsTx(tx, orgId, eventId, refs);
  return { eventId };
}

async function recordLagTx(tx: TenantTx, event: PublishedEvent) {
  if (!event.occurredAt) return;
  await tx.execute(sql`
    insert into reports.projector_lag (org_id, consumer, event_type, occurred_at, projected_at, lag_ms)
    values (${event.orgId}::uuid, ${METRICS_CONSUMER}, ${event.type}, ${event.occurredAt}::timestamptz,
      clock_timestamp(),
      greatest(0, round(extract(epoch from clock_timestamp() - ${event.occurredAt}::timestamptz) * 1000))::int)`);
}

/**
 * The `reports.metrics` projector (M3.1, ADR 0008): keeps `metric_snapshots` and
 * `metric_timeseries` current from order, ticketing, check-in, seating and device events.
 * Exactly once per event (processed_events), and idempotent besides: every value is recomputed
 * from its sources, so replays and duplicates change nothing. Backfilled (`replayed`) events
 * update the metrics but record no lag sample and call no `onChange` (no side effects).
 * `onChange` runs after each live event (M3.1b realtime publisher hook).
 */
export function metricsProjector(
  deps: { onChange?: (orgId: string, eventId: string | null) => Promise<void> } = {},
): Subscriber {
  return defineSubscriber({
    name: METRICS_CONSUMER,
    events: [...METRIC_EVENTS],
    acceptsReplayed: true,
    handle: async (tx, event) => {
      const { eventId } = await projectMetricEventTx(tx, event);
      if (event.replayed) return;
      await recordLagTx(tx, event);
      await deps.onChange?.(event.orgId, eventId);
    },
  });
}

/** Apply every metric event of the org the projector has not handled (seed, tests, deploy catch-up). */
export function catchUpMetrics(orgId: string) {
  return catchUpSubscriber(metricsProjector(), orgId);
}

/**
 * Read-your-writes for dashboards: apply the org's metric events the relay has not published
 * yet (in production, at most about a second of events; where no worker runs, everything new).
 * Exactly once, like the worker (the same processed_events guard).
 */
export async function applyUnpublishedMetricEvents(orgId: string, limit = 500): Promise<number> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: METRICS_CONSUMER } });
  const pending = await withTenant(ctx, (tx) =>
    unpublishedPendingTx(tx, orgId, METRICS_CONSUMER, METRIC_EVENTS, limit),
  );
  if (pending.length === 0) return 0;
  const projector = metricsProjector();
  let n = 0;
  for (const e of pending) if (await consumeEvent(projector, e)) n += 1;
  return n;
}

/** Everything the projections of one event should hold, computed from the sources (rebuild, checks). */
export async function computeEventMetricsTx(
  tx: TenantTx,
  eventId: string,
  now: Date,
): Promise<{ snapshot: SnapshotRow[]; series: SeriesPoint[] } | null> {
  const event = await findEventTx(tx, eventId);
  if (!event) return null;
  const snapshot = await refreshRowsTx(tx, event, now);
  for (let shard = 0; shard < COUNTER_SHARDS; shard++)
    snapshot.push({
      key: COUNTER_KEY,
      currency: '',
      shard,
      value: await counterShardValueTx(tx, eventId, shard),
    });
  const series: SeriesPoint[] = [];
  for (const bucket of BUCKETS) {
    const scope = { eventId };
    series.push(
      ...salesSeriesPoints(
        bucket,
        await salesSeriesTx(tx, scope, bucket, SERIES_SHARDS),
        await refundSeriesTx(tx, scope, bucket, SERIES_SHARDS),
      ),
      ...checkinSeriesPoints(bucket, await checkinSeriesTx(tx, scope, bucket, SERIES_SHARDS)),
    );
  }
  return { snapshot, series };
}

/**
 * Rebuild one event's projections from the source tables (drift repair, backfills, deploys).
 * Holds the event's snapshot, counter and series locks, so projections running at the same time
 * wait and then recompute on top: the result equals the sources.
 */
export async function rebuildEventMetricsTx(tx: TenantTx, orgId: string, eventId: string, now: Date) {
  await lock(tx, lockKey.snapshot(orgId, eventId));
  for (let s = 0; s < COUNTER_SHARDS; s++) await lock(tx, lockKey.counter(orgId, eventId, s));
  await lock(tx, lockKey.series(orgId, eventId));
  const computed = await computeEventMetricsTx(tx, eventId, now);
  await tx.delete(metricSnapshots).where(eq(metricSnapshots.eventId, eventId));
  await tx.delete(metricTimeseries).where(eq(metricTimeseries.eventId, eventId));
  if (!computed) return { snapshotRows: 0, seriesPoints: 0 };
  await insertSnapshotRows(tx, orgId, eventId, computed.snapshot, null);
  await insertSeries(tx, orgId, eventId, computed.series);
  return { snapshotRows: computed.snapshot.length, seriesPoints: computed.series.length };
}

/** Rebuild every event of the org, one transaction per event, then devices online. */
export async function rebuildOrgMetrics(orgId: string, now = new Date()) {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'reports.metrics-rebuild' } });
  const ids = await withTenant(ctx, (tx) => eventIdsTx(tx));
  let events = 0;
  for (const id of ids) {
    await withTenant(ctx, (tx) => rebuildEventMetricsTx(tx, orgId, id, now));
    events += 1;
  }
  await withTenant(ctx, (tx) => refreshDevicesTx(tx, orgId, now, null));
  return { events };
}

/** Lag samples are kept 7 days (the daily retention pass). */
export const LAG_RETENTION_MS = 7 * 24 * 3_600_000;

/** Delete this org's lag samples older than `before` (retention). */
export async function purgeProjectorLag(orgId: string, before: Date): Promise<number> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'reports.retention' } });
  return withTenant(ctx, async (tx) => {
    const rows = await tx.execute<{ id: string }>(
      sql`delete from reports.projector_lag where projected_at < ${before.toISOString()}::timestamptz returning id`,
    );
    return rows.length;
  });
}
