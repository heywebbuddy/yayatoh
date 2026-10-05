import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ATTRIBUTION_MODELS } from './attribution/models.ts';
import { DIMENSIONS as EXPLORER_DIMENSIONS, MEASURES, RANGE_PRESETS } from './explorer/catalog.ts';
import { MAX_RECIPIENTS, REPORT_FREQUENCIES, REPORT_RUN_STATUSES } from './reports/catalog.ts';
import { RULE_CONDITIONS, RULE_MEASURES, RULE_SEVERITIES, RULE_WINDOWS } from './rules/catalog.ts';

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
    uniqueIndex('backfill_runs_org_running_key').on(t.orgId).where(sql`status = 'running'`),
    index('backfill_runs_org_created_idx').on(t.orgId, t.createdAt),
    check('backfill_runs_status_check', sql`status in ('running', 'done', 'failed', 'cancelled')`),
    check('backfill_runs_adapter_check', sql`adapter in ('postgres', 'tinybird')`),
    check(
      'backfill_runs_page_check',
      sql`page_size between 1 and 500 and pages_per_minute between 1 and 600`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------------
// M6.2b: attribution rollups, explorer views, organizer alert rules, scheduled reports.

const listOf = (values: readonly (string | number)[]) =>
  values.map((v) => (typeof v === 'number' ? String(v) : `'${v}'`)).join(', ');
const inList = (col: string, values: readonly (string | number)[]) =>
  sql.raw(`${col} in (${listOf(values)})`);

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (v) => Buffer.from(v),
  fromDriver: (v) => new Uint8Array(v),
});

/**
 * The Postgres warehouse's attribution rollups (M6.2b): attributed orders (in basis points of an
 * order) and revenue (minor units, per currency) per org, event, payment day (org time zone),
 * model and touch (source, medium, campaign key, link). Part of an event's snapshot: replaced
 * with it as one unit, rebuilt by the backfill.
 */
export const attributionRollups = tenantTable(
  analyticsSchema,
  'attribution_rollups',
  {
    eventId: uuid('event_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    model: text('model').notNull(),
    source: text('source').notNull(),
    medium: text('medium').notNull().default(''),
    campaign: text('campaign').notNull().default(''),
    linkId: uuid('link_id'),
    currency: text('currency').notNull(),
    creditBps: bigint('credit_bps', { mode: 'number' }).notNull(),
    revenueMinor: bigint('revenue_minor', { mode: 'number' }).notNull(),
  },
  (t) => [
    unique('attribution_rollups_org_event_dims_key')
      .on(t.orgId, t.eventId, t.day, t.model, t.source, t.medium, t.campaign, t.linkId, t.currency)
      .nullsNotDistinct(),
    index('attribution_rollups_org_model_day_idx').on(t.orgId, t.model, t.day),
    check('attribution_rollups_model_check', inList('model', ATTRIBUTION_MODELS)),
    check('attribution_rollups_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('attribution_rollups_source_check', sql`length(source) between 1 and 255`),
    check('attribution_rollups_dims_check', sql`length(medium) <= 100 and length(campaign) <= 102`),
    check('attribution_rollups_values_check', sql`credit_bps >= 0 and revenue_minor >= 0`),
  ],
);

/**
 * A member's saved explorer views (M6.2b): a measure, a dimension and a period, private to the
 * member who saved it. Names are unique per member.
 */
export const savedViews = tenantTable(
  analyticsSchema,
  'saved_views',
  {
    userId: uuid('user_id').notNull(),
    name: text('name').notNull(),
    measure: text('measure').notNull(),
    dimension: text('dimension').notNull(),
    model: text('model'),
    granularity: text('granularity').notNull().default('day'),
    range: text('range').notNull(),
    fromDay: date('from_day', { mode: 'string' }),
    toDay: date('to_day', { mode: 'string' }),
    eventId: uuid('event_id'),
  },
  (t) => [
    uniqueIndex('saved_views_org_user_name_key').on(t.orgId, t.userId, t.name),
    index('saved_views_org_user_idx').on(t.orgId, t.userId, t.createdAt),
    check('saved_views_name_check', sql`length(name) between 1 and 80`),
    check('saved_views_measure_check', inList('measure', MEASURES)),
    check('saved_views_dimension_check', inList('dimension', EXPLORER_DIMENSIONS)),
    check('saved_views_model_check', sql.raw(`model is null or model in (${listOf(ATTRIBUTION_MODELS)})`)),
    check('saved_views_granularity_check', sql`granularity in ('day', 'week', 'month')`),
    check('saved_views_range_check', inList('range', RANGE_PRESETS)),
    check(
      'saved_views_custom_check',
      sql`(range = 'custom') = (from_day is not null and to_day is not null) and (from_day is null or from_day <= to_day)`,
    ),
  ],
);

/**
 * Organizer-authored alert rules (M6.2b) on the M3.2b engine: evaluated by the analytics worker
 * tick from the warehouse; a change of state reaches the alerts module through the outbox
 * (`analytics.alert_rule_evaluated@1`), which opens, updates or resolves the rule's alert and
 * sends it (respecting quiet hours in each recipient's time zone when `quiet_hours`).
 */
export const alertRules = tenantTable(
  analyticsSchema,
  'alert_rules',
  {
    name: text('name').notNull(),
    measure: text('measure').notNull(),
    condition: text('condition').notNull(),
    threshold: bigint('threshold', { mode: 'number' }).notNull(),
    windowDays: integer('window_days').notNull(),
    /** Money measures: the currency compared ('' for counts). */
    currency: text('currency').notNull().default(''),
    eventId: uuid('event_id'),
    severity: text('severity').notNull().default('warning'),
    quietHours: boolean('quiet_hours').notNull().default(true),
    enabled: boolean('enabled').notNull().default(true),
    createdBy: uuid('created_by').notNull(),
    lastState: text('last_state'),
    lastValue: bigint('last_value', { mode: 'number' }),
    lastEvaluatedAt: ts('last_evaluated_at'),
  },
  (t) => [
    uniqueIndex('alert_rules_org_name_key').on(t.orgId, t.name),
    index('alert_rules_org_enabled_idx').on(t.orgId, t.enabled),
    check('alert_rules_name_check', sql`length(name) between 1 and 80`),
    check('alert_rules_measure_check', inList('measure', RULE_MEASURES)),
    check('alert_rules_condition_check', inList('condition', RULE_CONDITIONS)),
    check('alert_rules_window_check', inList('window_days', RULE_WINDOWS)),
    check('alert_rules_severity_check', inList('severity', RULE_SEVERITIES)),
    check('alert_rules_state_check', sql`last_state is null or last_state in ('ok', 'firing')`),
    check(
      'alert_rules_threshold_check',
      sql`threshold between 0 and 1000000000000 and (condition in ('above', 'below') or threshold between 1 and 1000)`,
    ),
    check(
      'alert_rules_currency_check',
      sql`(measure in ('gross', 'refunds', 'net')) = (currency ~ '^[A-Z]{3}$') and (currency = '' or currency ~ '^[A-Z]{3}$')`,
    ),
  ],
);

/**
 * Scheduled PDF reports (M6.2b): the org dashboard for the last complete day, week (Monday to
 * Sunday) or month in the org's time zone, emailed to members at `send_hour` (org time) after the
 * period ends. Revenue only for recipients whose role may see finance.
 */
export const reportSchedules = tenantTable(
  analyticsSchema,
  'report_schedules',
  {
    name: text('name').notNull(),
    frequency: text('frequency').notNull(),
    sendHour: integer('send_hour').notNull().default(8),
    eventId: uuid('event_id'),
    recipients: uuid('recipients').array().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** Periods due before this are never sent (created, or switched back on). */
    activeSince: ts('active_since').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
  },
  (t) => [
    uniqueIndex('report_schedules_org_name_key').on(t.orgId, t.name),
    index('report_schedules_org_enabled_idx').on(t.orgId, t.enabled),
    check('report_schedules_name_check', sql`length(name) between 1 and 80`),
    check('report_schedules_frequency_check', inList('frequency', REPORT_FREQUENCIES)),
    check('report_schedules_hour_check', sql`send_hour between 0 and 23`),
    check(
      'report_schedules_recipients_check',
      sql.raw(`cardinality(recipients) between 1 and ${MAX_RECIPIENTS}`),
    ),
  ],
);

/**
 * One period of a schedule (M6.2b): created once per (schedule, period key) — the dedupe key —
 * so a retried job, a restarted worker or two ticks at once never send a period twice.
 */
export const reportRuns = tenantTable(
  analyticsSchema,
  'report_runs',
  {
    scheduleId: uuid('schedule_id').notNull(),
    periodKey: text('period_key').notNull(),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    recipientsSent: integer('recipients_sent').notNull().default(0),
    sentAt: ts('sent_at'),
    error: text('error'),
  },
  (t) => [
    uniqueIndex('report_runs_org_schedule_period_key').on(t.orgId, t.scheduleId, t.periodKey),
    index('report_runs_org_created_idx').on(t.orgId, t.createdAt),
    foreignKey({
      name: 'report_runs_schedule_fk',
      columns: [t.orgId, t.scheduleId],
      foreignColumns: [reportSchedules.orgId, reportSchedules.id],
    }).onDelete('cascade'),
    check('report_runs_status_check', inList('status', REPORT_RUN_STATUSES)),
    check('report_runs_period_check', sql`period_from <= period_to`),
    check(
      'report_runs_key_check',
      sql`period_key ~ '^(D[0-9]{4}-[0-9]{2}-[0-9]{2}|W[0-9]{4}-[0-9]{2}-[0-9]{2}|M[0-9]{4}-[0-9]{2})$'`,
    ),
  ],
);

/** A run's rendered PDF per recipient locale and finance visibility (M6.2b). */
export const reportFiles = tenantTable(
  analyticsSchema,
  'report_files',
  {
    runId: uuid('run_id').notNull(),
    locale: text('locale').notNull(),
    finance: boolean('finance').notNull(),
    pdf: bytea('pdf').notNull(),
    bytes: integer('bytes').notNull(),
  },
  (t) => [
    uniqueIndex('report_files_org_run_variant_key').on(t.orgId, t.runId, t.locale, t.finance),
    foreignKey({
      name: 'report_files_run_fk',
      columns: [t.orgId, t.runId],
      foreignColumns: [reportRuns.orgId, reportRuns.id],
    }).onDelete('cascade'),
    check('report_files_locale_check', sql`locale ~ '^[a-z]{2}(-[A-Z]{2})?$'`),
    check('report_files_bytes_check', sql`bytes between 1 and 20000000`),
  ],
);
