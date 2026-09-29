import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const reportsSchema = pgSchema('reports');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const METRIC_BUCKETS = ['minute', 'hour'] as const;
export type MetricBucket = (typeof METRIC_BUCKETS)[number];

/**
 * Current metric values (M3.1): one row per org, event (null = org grain), metric key, currency
 * ('' for counts) and shard. Most metrics use shard 0 only and are recomputed from their sources
 * whenever a domain event touches them; hot counters (check-ins at the door) spread over N shards,
 * each recomputed alone, and a read sums the shards. A projection: rebuilt from the sources at
 * any time (`rebuildEventMetrics`), never the system of record.
 */
export const metricSnapshots = tenantTable(
  reportsSchema,
  'metric_snapshots',
  {
    eventId: uuid('event_id'),
    key: text('key').notNull(),
    currency: text('currency').notNull().default(''),
    shard: smallint('shard').notNull().default(0),
    value: bigint('value', { mode: 'number' }).notNull(),
    /** When the domain event that last changed this row was written (source time). */
    sourceAt: ts('source_at'),
    projectedAt: ts('projected_at').notNull(),
  },
  (t) => [
    unique('metric_snapshots_org_event_key_currency_shard_key')
      .on(t.orgId, t.eventId, t.key, t.currency, t.shard)
      .nullsNotDistinct(),
    check('metric_snapshots_shard_check', sql`shard between 0 and 63`),
  ],
);

/**
 * Metric time series (M3.1): per-minute and per-hour UTC buckets for one event, sharded like the
 * snapshots (a bucket's value is the sum of its shards). Each (bucket, shard) is recomputed from
 * the sources in that window, so replays and duplicates converge.
 */
export const metricTimeseries = tenantTable(
  reportsSchema,
  'metric_timeseries',
  {
    eventId: uuid('event_id').notNull(),
    key: text('key').notNull(),
    currency: text('currency').notNull().default(''),
    bucket: text('bucket').notNull(),
    bucketStart: ts('bucket_start').notNull(),
    shard: smallint('shard').notNull().default(0),
    value: bigint('value', { mode: 'number' }).notNull(),
    projectedAt: ts('projected_at').notNull(),
  },
  (t) => [
    uniqueIndex('metric_timeseries_point_key').on(
      t.orgId,
      t.eventId,
      t.key,
      t.bucket,
      t.bucketStart,
      t.currency,
      t.shard,
    ),
    check('metric_timeseries_bucket_check', sql`bucket in ('minute', 'hour')`),
    check('metric_timeseries_shard_check', sql`shard between 0 and 63`),
  ],
);

/**
 * Projector lag samples (M3.1): how long after a domain event was written its projection
 * committed. Append-only; kept 7 days (retention job). No payload, only the event type.
 */
export const projectorLag = tenantTable(
  reportsSchema,
  'projector_lag',
  {
    consumer: text('consumer').notNull(),
    eventType: text('event_type').notNull(),
    occurredAt: ts('occurred_at').notNull(),
    projectedAt: ts('projected_at').notNull(),
    lagMs: integer('lag_ms').notNull(),
  },
  (t) => [
    index('projector_lag_org_consumer_projected_idx').on(t.orgId, t.consumer, t.projectedAt),
    check('projector_lag_lag_check', sql`lag_ms >= 0`),
  ],
);

/**
 * The Postgres analytics sink (M3.1, decision P3-4): allowlisted product events, append-only
 * (the runtime role may only insert and read). Partition-ready: the UUIDv7 id is time-ordered,
 * so the table can become RANGE partitions on `id` (monthly) without changing a key. Retention:
 * 13 months, then dropped by partition (M6.2 chooses the warehouse; see the M3.1 spec).
 */
export const analyticsEvents = tenantTable(
  reportsSchema,
  'analytics_events',
  {
    name: text('name').notNull(),
    eventId: uuid('event_id'),
    occurredAt: ts('occurred_at').notNull(),
    /** The domain event this came from (deduplication). */
    sourceEventId: uuid('source_event_id').notNull(),
    replayed: boolean('replayed').notNull().default(false),
    props: jsonb('props').notNull().default({}),
  },
  (t) => [
    uniqueIndex('analytics_events_org_source_name_key').on(t.orgId, t.sourceEventId, t.name),
    index('analytics_events_org_name_occurred_idx').on(t.orgId, t.name, t.occurredAt),
  ],
);
