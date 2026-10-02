import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const analyticsSchema = pgSchema('analytics');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Metrics kept per org, event, day and currency (money) in the warehouse (M6.2a). */
export const DAILY_METRICS = [
  'orders',
  'tickets',
  'comp_tickets',
  'refunded_tickets',
  'checkins',
  'gross',
  'refunds',
] as const;
export type DailyMetric = (typeof DAILY_METRICS)[number];
export const WAREHOUSE_ADAPTERS = ['postgres', 'tinybird'] as const;
export type WarehouseAdapterName = (typeof WAREHOUSE_ADAPTERS)[number];
export const BACKFILL_STATUSES = ['running', 'done', 'failed', 'cancelled'] as const;
export type BackfillStatus = (typeof BACKFILL_STATUSES)[number];
export const INGEST_OUTCOMES = ['written', 'unchanged', 'skipped'] as const;

/**
 * The Postgres warehouse's daily rollups (M6.2a, decision P6-2): one row per org, event, calendar
 * day in the org's time zone, metric and currency ('' for counts). Partitioned logically by org
 * and day: every index leads with `org_id` and then `day`, and an event's rows are replaced as one
 * unit. A projection of the orders and check-in tables, rebuilt by the backfill at any time.
 */
export const dailyRollups = tenantTable(
  analyticsSchema,
  'daily_rollups',
  {
    eventId: uuid('event_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    metric: text('metric').notNull(),
    currency: text('currency').notNull().default(''),
    value: bigint('value', { mode: 'number' }).notNull(),
  },
  (t) => [
    uniqueIndex('daily_rollups_org_event_day_metric_currency_key').on(
      t.orgId,
      t.eventId,
      t.day,
      t.metric,
      t.currency,
    ),
    index('daily_rollups_org_day_idx').on(t.orgId, t.day, t.metric),
    check(
      'daily_rollups_metric_check',
      sql`metric in ('orders', 'tickets', 'comp_tickets', 'refunded_tickets', 'checkins', 'gross', 'refunds')`,
    ),
    check('daily_rollups_currency_check', sql`currency = '' or currency ~ '^[A-Z]{3}$'`),
  ],
);

/**
 * The Postgres warehouse's per-event state (M6.2a): what no-shows need (valid tickets, tickets
 * checked in, when the event ends and that day in the org's time zone).
 */
export const eventRollups = tenantTable(
  analyticsSchema,
  'event_rollups',
  {
    eventId: uuid('event_id').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    endDay: date('end_day', { mode: 'string' }).notNull(),
    validTickets: integer('valid_tickets').notNull(),
    checkedIn: integer('checked_in').notNull(),
  },
  (t) => [
    uniqueIndex('event_rollups_org_event_key').on(t.orgId, t.eventId),
    index('event_rollups_org_end_day_idx').on(t.orgId, t.endDay),
    check('event_rollups_counts_check', sql`valid_tickets >= 0 and checked_in >= 0`),
  ],
);

/**
 * What each adapter last received per event (M6.2a): the snapshot's content hash, its version
 * and the time zone its days are in. An unchanged snapshot is never written again, so a replay
 * or a backfill after live ingest writes nothing, on either adapter.
 */
export const eventSync = tenantTable(
  analyticsSchema,
  'event_sync',
  {
    eventId: uuid('event_id').notNull(),
    adapter: text('adapter').notNull(),
    hash: text('hash').notNull(),
    version: bigint('version', { mode: 'number' }).notNull(),
    timeZone: text('time_zone').notNull(),
    syncedAt: ts('synced_at').notNull(),
  },
  (t) => [
    uniqueIndex('event_sync_org_adapter_event_key').on(t.orgId, t.adapter, t.eventId),
    check('event_sync_adapter_check', sql`adapter in ('postgres', 'tinybird')`),
  ],
);

/**
 * Domain events the warehouse ingested (M6.2a): one row per source event id, so a replayed or
 * redelivered event is ingested once. Append-only for the runtime role. Ids and types only.
 */
export const ingestLog = tenantTable(
  analyticsSchema,
  'ingest_log',
  {
    sourceEventId: uuid('source_event_id').notNull(),
    eventType: text('event_type').notNull(),
    eventVersion: integer('event_version').notNull(),
    /** The event the source touched (null: not an event's data). */
    eventId: uuid('event_id'),
    adapter: text('adapter').notNull(),
    outcome: text('outcome').notNull(),
  },
  (t) => [
    uniqueIndex('ingest_log_org_source_event_key').on(t.orgId, t.sourceEventId),
    index('ingest_log_org_created_idx').on(t.orgId, t.createdAt),
    check('ingest_log_outcome_check', sql`outcome in ('written', 'unchanged', 'skipped')`),
    check('ingest_log_adapter_check', sql`adapter in ('postgres', 'tinybird')`),
  ],
);

/**
 * Backfill runs (M6.2a): an org's rollups rebuilt from the source tables, a page of events at a
 * time. `cursor` is the last event id done (keyset), so a run resumes where it stopped;
 * `next_page_at` spaces the pages (rate limit). At most one running run per org.
 */
export const backfillRuns = tenantTable(
  analyticsSchema,
  'backfill_runs',
  {
    status: text('status').notNull().default('running'),
    adapter: text('adapter').notNull(),
    cursor: uuid('cursor'),
    pageSize: integer('page_size').notNull(),
    pagesPerMinute: integer('pages_per_minute').notNull(),
    pagesDone: integer('pages_done').notNull().default(0),
    eventsDone: integer('events_done').notNull().default(0),
    eventsWritten: integer('events_written').notNull().default(0),
    nextPageAt: ts('next_page_at').notNull(),
    startedBy: text('started_by').notNull(),
    finishedAt: ts('finished_at'),
    error: text('error'),
  },
  (t) => [
    uniqueIndex('backfill_runs_org_running_key')
      .on(t.orgId)
      .where(sql`status = 'running'`),
    index('backfill_runs_org_created_idx').on(t.orgId, t.createdAt),
    check('backfill_runs_status_check', sql`status in ('running', 'done', 'failed', 'cancelled')`),
    check('backfill_runs_adapter_check', sql`adapter in ('postgres', 'tinybird')`),
    check('backfill_runs_page_check', sql`page_size between 1 and 500 and pages_per_minute between 1 and 600`),
  ],
);
