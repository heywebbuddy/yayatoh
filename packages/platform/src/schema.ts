import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const platform = pgSchema('platform');

/**
 * Transactional outbox (ADR 0008). Rows are written inside the command transaction.
 * The single-leader relay stamps `log_seq` (gap-free, global) and enqueues subscribers.
 */
export const domainEvents = tenantTable(
  platform,
  'domain_events',
  {
    type: text('type').notNull(),
    version: integer('version').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    actor: text('actor').notNull(),
    requestId: text('request_id').notNull(),
    logSeq: bigint('log_seq', { mode: 'number' }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /**
     * Backfilled history (the legacy migration, T9): relayed and logged like any event, but
     * subscribers skip it unless they opt in (`acceptsReplayed`), so no email or journey fires.
     */
    replayed: boolean('replayed').notNull().default(false),
  },
  (t) => [
    uniqueIndex('domain_events_log_seq_key').on(t.logSeq),
    index('domain_events_org_id_log_seq_idx').on(t.orgId, t.logSeq),
    index('domain_events_unpublished_idx').on(t.orgId, t.id).where(sql`published_at is null`),
  ],
);

/**
 * Monthly metric history per org (roadmap §5.1 `metric_timeseries`), keyed by the reports metric
 * registry (`sales.gross`, `orders.sold`, `tickets.sold`, `checkins.tickets`, …). Money metrics
 * carry their currency; counts use `currency = ''`. M2.2c backfills the legacy years
 * (`source = 'legacy'`) so year-over-year comparisons have history; the live projector (M3.1)
 * writes `source = 'live'`.
 */
export const metricTimeseries = tenantTable(
  platform,
  'metric_timeseries',
  {
    metric: text('metric').notNull(),
    bucket: date('bucket', { mode: 'string' }).notNull(),
    currency: text('currency').notNull().default(''),
    value: bigint('value', { mode: 'number' }).notNull(),
    source: text('source').notNull(),
  },
  (t) => [
    uniqueIndex('metric_timeseries_org_metric_bucket_key').on(
      t.orgId,
      t.metric,
      t.bucket,
      t.currency,
      t.source,
    ),
    check('metric_timeseries_source_check', sql`source in ('legacy', 'live')`),
    check('metric_timeseries_bucket_check', sql`extract(day from bucket) = 1`),
    check('metric_timeseries_currency_check', sql`currency = '' or currency ~ '^[A-Z]{3}$'`),
  ],
);

/** Consumer idempotency: a subscriber records each event it has handled, once. */
export const processedEvents = tenantTable(
  platform,
  'processed_events',
  {
    consumer: text('consumer').notNull(),
    eventId: uuid('event_id').notNull(),
  },
  (t) => [uniqueIndex('processed_events_org_consumer_event_key').on(t.orgId, t.consumer, t.eventId)],
);

/**
 * Append-only audit log (app_user may only INSERT and SELECT; see migration). Each org's entries
 * form a hash chain (M1.14b): a BEFORE INSERT trigger (`platform.audit_chain`) numbers them
 * (`seq`, gap-free per org, under a per-org advisory lock) and sets
 * `hash = sha256(prev_hash, org, seq, actor, action, target, data, request, created_at)`.
 * The defaults below are placeholders the trigger always overwrites.
 */
export const auditEvents = tenantTable(
  platform,
  'audit_events',
  {
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    data: jsonb('data').notNull().default({}),
    requestId: text('request_id').notNull(),
    seq: bigint('seq', { mode: 'number' }).notNull().default(0),
    prevHash: text('prev_hash').notNull().default(''),
    hash: text('hash').notNull().default(''),
  },
  (t) => [
    index('audit_events_org_id_created_at_idx').on(t.orgId, t.createdAt),
    uniqueIndex('audit_events_org_seq_key').on(t.orgId, t.seq),
    index('audit_events_org_actor_seq_idx').on(t.orgId, t.actor, t.seq),
    index('audit_events_org_action_seq_idx').on(t.orgId, t.action, t.seq),
  ],
);

export const idempotencyKeys = tenantTable(
  platform,
  'idempotency_keys',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    response: jsonb('response').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '24 hours'`),
  },
  (t) => [
    uniqueIndex('idempotency_keys_org_scope_key_key').on(t.orgId, t.scope, t.key),
    check('idempotency_keys_key_length', sql`length(${t.key}) between 1 and 255`),
  ],
);

const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Fixed-window request counters for abuse limits (roadmap §6.1 rate-limit table), e.g. the
 * seat finder's per device + event budget. One row per bucket per window; old windows are
 * pruned as new ones are counted. Upstash token buckets may replace this for hot paths later.
 */
export const rateLimits = tenantTable(
  platform,
  'rate_limits',
  {
    bucket: text('bucket').notNull(),
    windowStart: tsz('window_start').notNull(),
    hits: integer('hits').notNull().default(0),
  },
  (t) => [
    uniqueIndex('rate_limits_org_bucket_window_key').on(t.orgId, t.bucket, t.windowStart),
    index('rate_limits_org_window_idx').on(t.orgId, t.windowStart),
    check('rate_limits_bucket_length', sql`length(${t.bucket}) between 1 and 200`),
  ],
);

export const BULK_STATUSES = ['queued', 'running', 'done', 'failed', 'undoing', 'undone'] as const;
export type BulkStatus = (typeof BULK_STATUSES)[number];

/**
 * A bulk action over a snapshot of item ids (roadmap M1.8: ids or filter, progress, partial
 * failures, undo window). The selection is resolved once, at request time; runners then work
 * through `item_ids` in chunks, each chunk in its own tenant transaction.
 */
export const bulkOperations = tenantTable(
  platform,
  'bulk_operations',
  {
    action: text('action').notNull(),
    eventId: uuid('event_id'),
    status: text('status').notNull().default('queued'),
    params: jsonb('params').notNull().default({}),
    itemIds: uuid('item_ids').array().notNull(),
    total: integer('total').notNull(),
    processed: integer('processed').notNull().default(0),
    succeeded: integer('succeeded').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    undone: integer('undone').notNull().default(0),
    requestedBy: uuid('requested_by'),
    fileId: uuid('file_id'),
    undoUntil: tsz('undo_until'),
    finishedAt: tsz('finished_at'),
    lastError: text('last_error'),
  },
  (t) => [
    index('bulk_operations_org_created_idx').on(t.orgId, t.createdAt),
    index('bulk_operations_active_idx')
      .on(t.orgId, t.id)
      .where(sql`status in ('queued', 'running', 'undoing')`),
    check(
      'bulk_operations_status_check',
      sql`status in ('queued', 'running', 'done', 'failed', 'undoing', 'undone')`,
    ),
    check('bulk_operations_counts_check', sql`processed <= total and succeeded + failed <= processed`),
  ],
);

/** Per-item outcomes worth keeping: failures (with a code) and what undo needs to restore. */
export const bulkOperationItems = tenantTable(
  platform,
  'bulk_operation_items',
  {
    operationId: uuid('operation_id').notNull(),
    itemId: uuid('item_id').notNull(),
    ok: boolean('ok').notNull(),
    errorCode: text('error_code'),
    undo: jsonb('undo'),
    undoneAt: tsz('undone_at'),
  },
  (t) => [
    uniqueIndex('bulk_operation_items_org_op_item_key').on(t.orgId, t.operationId, t.itemId),
    foreignKey({
      name: 'bulk_operation_items_operation_fk',
      columns: [t.orgId, t.operationId],
      foreignColumns: [bulkOperations.orgId, bulkOperations.id],
    }).onDelete('cascade'),
  ],
);

/**
 * Generated files (exports) kept in Postgres until object storage exists (R2, owner account).
 * Content is appended in parts as a job progresses; downloads concatenate them in order.
 */
export const files = tenantTable(
  platform,
  'files',
  {
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    bytes: integer('bytes').notNull().default(0),
    complete: boolean('complete').notNull().default(false),
    expiresAt: tsz('expires_at').notNull(),
  },
  (t) => [index('files_org_expires_idx').on(t.orgId, t.expiresAt)],
);

export const fileParts = tenantTable(
  platform,
  'file_parts',
  {
    fileId: uuid('file_id').notNull(),
    seq: integer('seq').notNull(),
    data: text('data').notNull(),
  },
  (t) => [
    uniqueIndex('file_parts_org_file_seq_key').on(t.orgId, t.fileId, t.seq),
    foreignKey({
      name: 'file_parts_file_fk',
      columns: [t.orgId, t.fileId],
      foreignColumns: [files.orgId, files.id],
    }).onDelete('cascade'),
  ],
);

/**
 * Invite-only signup (M1.3): a code lets someone create an organization. Only the SHA-256 of the
 * code is stored. app_user has no privileges on this table: codes are checked and claimed
 * through SECURITY DEFINER functions, and created by platform staff (platform_reader).
 */
export const signupCodes = platform.table(
  'signup_codes',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    codeHash: text('code_hash').notNull(),
    maxUses: integer('max_uses').notNull(),
    uses: integer('uses').notNull().default(0),
    expiresAt: tsz('expires_at').notNull(),
    revokedAt: tsz('revoked_at'),
    /** Who revoked it (staff actor), M1.3f. */
    revokedBy: text('revoked_by'),
    note: text('note').notNull().default(''),
    createdBy: text('created_by').notNull(),
    createdAt: tsz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('signup_codes_code_hash_key').on(t.codeHash),
    check('signup_codes_uses_check', sql`uses >= 0 and uses <= max_uses and max_uses between 1 and 1000`),
  ],
);

export const STAFF_ROLES = ['admin', 'support', 'finance'] as const;

/**
 * Platform staff (roadmap D10: an owner-approved list only). Global: staff act across tenants in
 * apps/admin. app_user has no privileges; platform_reader reads it, and staff are added or
 * revoked only through a SECURITY DEFINER function run by the worker CLI.
 */
export const platformStaff = platform.table(
  'staff',
  {
    userId: uuid('user_id').primaryKey(),
    role: text('role').notNull(),
    addedBy: text('added_by').notNull(),
    createdAt: tsz('created_at').notNull().defaultNow(),
    revokedAt: tsz('revoked_at'),
  },
  () => [check('staff_role_check', sql.raw(`role in (${STAFF_ROLES.map((r) => `'${r}'`).join(', ')})`))],
);

/**
 * Every platform_reader use (apps/admin and the worker): who, why, when. Append-only through a
 * SECURITY DEFINER function; nobody can update or delete rows.
 */
export const accessLog = platform.table(
  'access_log',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    actor: text('actor').notNull(),
    reason: text('reason').notNull(),
    at: tsz('at').notNull().defaultNow(),
  },
  (t) => [index('access_log_at_idx').on(t.at)],
);

/**
 * App-version telemetry for /v1 (roadmap M1.15): request counts per day × route × client × app
 * version. No tenant, user or IP is recorded. app_user has no privileges: requests increment it
 * through the SECURITY DEFINER `platform.record_api_usage`, and staff read it (platform_reader).
 */
export const apiUsage = platform.table(
  'api_usage',
  {
    day: date('day', { mode: 'string' }).notNull(),
    route: text('route').notNull(),
    method: text('method').notNull(),
    client: text('client').notNull(),
    appVersion: text('app_version').notNull(),
    count: bigint('count', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'api_usage_pkey', columns: [t.day, t.route, t.method, t.client, t.appVersion] }),
    check(
      'api_usage_lengths',
      sql`length(route) <= 200 and length(client) <= 40 and length(app_version) <= 40`,
    ),
  ],
);

/**
 * Rate-limit windows (M1.14a; `rate_limit_windows`, not the per-org fixed windows of
 * `rate_limits` above, which the seat finder uses): one sliding-window counter per key (policy + device, IP or hashed
 * identity; never raw PII). Global and UNLOGGED (losing counters on a crash is harmless). No
 * app_user privileges: every hit goes through the SECURITY DEFINER `platform.rate_limit_hit`.
 * Replaced by Upstash Redis once the owner's account exists.
 */
export const rateLimitWindows = platform.table(
  'rate_limit_windows',
  {
    key: text('key').primaryKey(),
    windowMs: integer('window_ms').notNull(),
    windowStart: bigint('window_start', { mode: 'number' }).notNull(),
    prev: integer('prev').notNull().default(0),
    curr: integer('curr').notNull().default(0),
    expiresAt: tsz('expires_at').notNull(),
  },
  (t) => [index('rate_limit_windows_expires_idx').on(t.expiresAt)],
);

/**
 * Platform-wide erased-address suppression (M1.14e). When a person is erased (an org-side
 * erasure or an account deletion), the SHA-256 of their normalized email is kept here so the
 * address isn't mailed again or re-added to a marketing list by any org: never the address
 * itself. Global (DNS and inboxes are global); no app_user privileges: written and read only
 * through SECURITY DEFINER functions (`platform.erased_address_*`), read by platform_reader.
 * `account_lifted_at`: the person signed up again, so account mail reaches them; org marketing
 * still needs a consent given after `created_at`.
 */
export const erasedAddresses = platform.table(
  'erased_addresses',
  {
    addressHash: text('address_hash').primaryKey(),
    reason: text('reason').notNull().default('erased'),
    createdAt: tsz('created_at').notNull().defaultNow(),
    accountLiftedAt: tsz('account_lifted_at'),
  },
  () => [
    check('erased_addresses_hash_check', sql`address_hash ~ '^[0-9a-f]{64}$'`),
    check('erased_addresses_reason_check', sql`reason in ('erased')`),
  ],
);

/** Platform switches staff flip from the console (M3.11a). Only these keys exist. */
export const PLATFORM_FLAGS = ['open_signup'] as const;
export type PlatformFlag = (typeof PLATFORM_FLAGS)[number];

/**
 * Platform switches (M3.11a): `open_signup` lets anyone create an organizer account and org
 * (default off until the owner launches, D28). Global; no app_user privileges: the app reads a
 * switch through the SECURITY DEFINER `platform.flag_enabled`, and staff change it only through
 * `platform.set_flag` (platform_reader), which also writes `flag_changes`.
 */
export const platformFlags = platform.table(
  'flags',
  {
    key: text('key').primaryKey(),
    enabled: boolean('enabled').notNull().default(false),
    updatedBy: text('updated_by').notNull(),
    updatedAt: tsz('updated_at').notNull().defaultNow(),
  },
  () => [check('flags_key_check', sql.raw(`key in (${PLATFORM_FLAGS.map((k) => `'${k}'`).join(', ')})`))],
);

/** Every change of a platform switch: who, when, why (append-only; staff console history). */
export const platformFlagChanges = platform.table(
  'flag_changes',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    key: text('key').notNull(),
    enabled: boolean('enabled').notNull(),
    changedBy: text('changed_by').notNull(),
    reason: text('reason').notNull(),
    at: tsz('at').notNull().defaultNow(),
  },
  (t) => [
    index('flag_changes_key_at_idx').on(t.key, t.at),
    check('flag_changes_reason_length', sql`length(reason) between 3 and 500`),
  ],
);
