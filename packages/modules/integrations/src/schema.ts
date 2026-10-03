import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { MAPPING_DIRECTIONS } from './domain/mapping.ts';
import {
  CONNECTION_STATUSES,
  ERROR_STATUSES,
  ERROR_STEPS,
  REVOKE_REASONS,
  RUN_STATUSES,
  RUN_TRIGGERS,
} from './domain/sync.ts';

export const integrationsSchema = pgSchema('integrations');

const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

/**
 * One org's connection to one connector (M6.4a). Tokens are never here: the `IntegrationAuth` port
 * (Nango) holds them; we keep the provider-side connection id and labels. One live connection
 * (pending, active or paused) per connector and org; revoked and failed rows stay as history.
 */
export const connections = tenantTable(
  integrationsSchema,
  'connections',
  {
    connector: text('connector').notNull(),
    status: text('status').notNull().default('pending'),
    /** The provider-side connection id (Nango's), set when the connect completes. */
    authConnectionId: text('auth_connection_id'),
    /** The account's name at the provider ("Ada's workspace"). */
    accountLabel: text('account_label'),
    /** sha256 of the single-use OAuth state while pending. */
    stateHash: text('state_hash'),
    stateExpiresAt: tsz('state_expires_at'),
    connectedBy: uuid('connected_by'),
    connectedAt: tsz('connected_at'),
    pausedAt: tsz('paused_at'),
    revokedAt: tsz('revoked_at'),
    revokeReason: text('revoke_reason'),
    syncIntervalMinutes: integer('sync_interval_minutes').notNull().default(60),
    /** When the scheduler syncs it next (active connections only). */
    nextSyncAt: tsz('next_sync_at'),
    lastSyncAt: tsz('last_sync_at'),
    lastSyncStatus: text('last_sync_status'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  },
  (t) => [
    uniqueIndex('connections_org_connector_live_key')
      .on(t.orgId, t.connector)
      .where(sql`status in ('pending', 'active', 'paused')`),
    index('connections_org_created_idx').on(t.orgId, t.createdAt),
    index('connections_next_sync_idx').on(t.nextSyncAt, t.orgId).where(sql`status = 'active'`),
    check('connections_connector_check', sql`connector ~ '^[a-z][a-z0-9_]{1,39}$'`),
    check('connections_status_check', inList('status', CONNECTION_STATUSES)),
    check(
      'connections_revoke_reason_check',
      sql`revoke_reason is null or ${inList('revoke_reason', REVOKE_REASONS)}`,
    ),
    check('connections_revoked_check', sql`(status = 'revoked') = (revoked_at is not null)`),
    check('connections_paused_check', sql`(status = 'paused') = (paused_at is not null)`),
    check(
      'connections_auth_check',
      sql`status in ('pending', 'failed') or (auth_connection_id is not null and connected_at is not null)`,
    ),
    check('connections_state_check', sql`state_hash is null or status = 'pending'`),
    check(
      'connections_auth_id_check',
      sql`auth_connection_id is null or length(auth_connection_id) between 1 and 255`,
    ),
    check('connections_label_check', sql`account_label is null or length(account_label) <= 120`),
    check('connections_interval_check', sql`sync_interval_minutes between 5 and 10080`),
    check('connections_failures_check', sql`consecutive_failures between 0 and 1000`),
    check(
      'connections_last_status_check',
      sql`last_sync_status is null or ${inList('last_sync_status', RUN_STATUSES)}`,
    ),
  ],
);

/**
 * Field mappings per connection, object and direction, versioned: a save adds the next version
 * and the newest one is in force (runs record which version they used).
 */
export const fieldMappings = tenantTable(
  integrationsSchema,
  'field_mappings',
  {
    connectionId: uuid('connection_id').notNull(),
    objectType: text('object_type').notNull(),
    direction: text('direction').notNull(),
    version: integer('version').notNull(),
    rules: jsonb('rules').$type<unknown[]>().notNull(),
    createdBy: uuid('created_by'),
  },
  (t) => [
    uniqueIndex('field_mappings_org_connection_object_version_key').on(
      t.orgId,
      t.connectionId,
      t.objectType,
      t.direction,
      t.version,
    ),
    foreignKey({
      name: 'field_mappings_connection_fk',
      columns: [t.orgId, t.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete('cascade'),
    check('field_mappings_object_check', sql`object_type ~ '^[a-z][a-z0-9_]{0,62}$'`),
    check('field_mappings_direction_check', inList('direction', MAPPING_DIRECTIONS)),
    check('field_mappings_version_check', sql`version between 1 and 100000`),
    check(
      'field_mappings_rules_check',
      sql`jsonb_typeof(rules) = 'array' and jsonb_array_length(rules) <= 50`,
    ),
  ],
);

/** Where each object's sync resumes, per direction (the provider's cursor or our keyset position). */
export const syncCursors = tenantTable(
  integrationsSchema,
  'sync_cursors',
  {
    connectionId: uuid('connection_id').notNull(),
    objectType: text('object_type').notNull(),
    direction: text('direction').notNull(),
    cursor: text('cursor'),
  },
  (t) => [
    uniqueIndex('sync_cursors_org_connection_object_key').on(
      t.orgId,
      t.connectionId,
      t.objectType,
      t.direction,
    ),
    foreignKey({
      name: 'sync_cursors_connection_fk',
      columns: [t.orgId, t.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete('cascade'),
    check('sync_cursors_direction_check', inList('direction', MAPPING_DIRECTIONS)),
    check('sync_cursors_cursor_check', sql`cursor is null or length(cursor) <= 1000`),
  ],
);

/**
 * Sync runs. At most one queued or running run per connection (the per-connection concurrency of
 * one, with the worker's exclusive queue); a running run holds a lease so a dead worker frees it.
 */
export const syncRuns = tenantTable(
  integrationsSchema,
  'sync_runs',
  {
    connectionId: uuid('connection_id').notNull(),
    trigger: text('trigger').notNull(),
    status: text('status').notNull().default('queued'),
    requestedBy: uuid('requested_by'),
    startedAt: tsz('started_at'),
    finishedAt: tsz('finished_at'),
    leaseUntil: tsz('lease_until'),
    pulled: integer('pulled').notNull().default(0),
    pushed: integer('pushed').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    /** Why the whole run failed (a code: `auth_revoked`, `http_503`, …). */
    errorCode: text('error_code'),
  },
  (t) => [
    uniqueIndex('sync_runs_org_connection_active_key')
      .on(t.orgId, t.connectionId)
      .where(sql`status in ('queued', 'running')`),
    index('sync_runs_org_connection_created_idx').on(t.orgId, t.connectionId, t.createdAt),
    index('sync_runs_queued_idx').on(t.createdAt, t.orgId).where(sql`status = 'queued'`),
    foreignKey({
      name: 'sync_runs_connection_fk',
      columns: [t.orgId, t.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete('cascade'),
    check('sync_runs_trigger_check', inList('trigger', RUN_TRIGGERS)),
    check('sync_runs_status_check', inList('status', RUN_STATUSES)),
    check('sync_runs_counts_check', sql`pulled >= 0 and pushed >= 0 and skipped >= 0 and failed >= 0`),
    check('sync_runs_finished_check', sql`(status in ('queued', 'running')) = (finished_at is null)`),
    check('sync_runs_error_code_check', sql`error_code is null or error_code ~ '^[a-z0-9_]{1,60}$'`),
  ],
);

/**
 * One record known on both sides: the provider's id, our id, the remote version and our hash at
 * the last crossing. Unique per (connection, object, provider id): the idempotency key of an
 * external record — a replayed page finds its link and writes nothing.
 */
export const recordLinks = tenantTable(
  integrationsSchema,
  'record_links',
  {
    connectionId: uuid('connection_id').notNull(),
    objectType: text('object_type').notNull(),
    externalId: text('external_id').notNull(),
    localId: uuid('local_id').notNull(),
    remoteVersion: text('remote_version'),
    localHash: text('local_hash'),
    lastDirection: text('last_direction').notNull(),
    lastSyncedAt: tsz('last_synced_at').notNull(),
  },
  (t) => [
    uniqueIndex('record_links_org_connection_external_key').on(
      t.orgId,
      t.connectionId,
      t.objectType,
      t.externalId,
    ),
    uniqueIndex('record_links_org_connection_local_key').on(t.orgId, t.connectionId, t.objectType, t.localId),
    foreignKey({
      name: 'record_links_connection_fk',
      columns: [t.orgId, t.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete('cascade'),
    check('record_links_direction_check', inList('last_direction', MAPPING_DIRECTIONS)),
    check('record_links_external_check', sql`length(external_id) between 1 and 255`),
    check('record_links_version_check', sql`remote_version is null or length(remote_version) <= 255`),
    check('record_links_hash_check', sql`local_hash is null or local_hash ~ '^[0-9a-f]{64}$'`),
  ],
);

/**
 * The integration errors inbox: one open row per (connection, step, record), counting repeats.
 * Codes and short sanitized messages only: never a token, never the record's values.
 */
export const syncErrors = tenantTable(
  integrationsSchema,
  'sync_errors',
  {
    connectionId: uuid('connection_id').notNull(),
    runId: uuid('run_id'),
    step: text('step').notNull(),
    objectType: text('object_type'),
    direction: text('direction'),
    externalId: text('external_id'),
    localId: uuid('local_id'),
    /** `<object>:<provider id or our id>`, or `-` for connection-level errors (the grouping key). */
    recordKey: text('record_key').notNull(),
    code: text('code').notNull(),
    /** The mapped field a mapping error is about (a field name, never its value). */
    field: text('field'),
    status: text('status').notNull().default('open'),
    attempts: integer('attempts').notNull().default(1),
    occurrences: integer('occurrences').notNull().default(1),
    nextRetryAt: tsz('next_retry_at'),
    firstSeenAt: tsz('first_seen_at').notNull(),
    lastSeenAt: tsz('last_seen_at').notNull(),
    resolvedAt: tsz('resolved_at'),
    resolvedBy: uuid('resolved_by'),
  },
  (t) => [
    uniqueIndex('sync_errors_org_open_record_key')
      .on(t.orgId, t.connectionId, t.step, t.recordKey)
      .where(sql`status = 'open'`),
    index('sync_errors_org_status_seen_idx').on(t.orgId, t.status, t.lastSeenAt),
    index('sync_errors_org_connection_status_idx').on(t.orgId, t.connectionId, t.status),
    foreignKey({
      name: 'sync_errors_connection_fk',
      columns: [t.orgId, t.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete('cascade'),
    check('sync_errors_step_check', inList('step', ERROR_STEPS)),
    check('sync_errors_status_check', inList('status', ERROR_STATUSES)),
    check(
      'sync_errors_direction_check',
      sql`direction is null or ${inList('direction', MAPPING_DIRECTIONS)}`,
    ),
    check('sync_errors_code_check', sql`code ~ '^[a-z0-9_]{1,60}$'`),
    check('sync_errors_field_check', sql`field is null or field ~ '^[a-z][a-z0-9_]{0,62}$'`),
    check('sync_errors_record_key_check', sql`length(record_key) between 1 and 320`),
    check('sync_errors_external_check', sql`external_id is null or length(external_id) between 1 and 255`),
    check('sync_errors_counts_check', sql`attempts between 0 and 1000 and occurrences between 1 and 1000000`),
    check('sync_errors_resolved_check', sql`(status = 'open') = (resolved_at is null)`),
  ],
);

/** M6.4c: what a Slack message is (the sender's dedupe scope). */
export const SLACK_MESSAGE_KINDS = ['alert', 'digest', 'test'] as const;
export const SLACK_MESSAGE_STATUSES = ['pending', 'sending', 'sent', 'failed', 'cancelled'] as const;
export const SLACK_MIN_SEVERITIES = ['info', 'warning', 'critical'] as const;

/**
 * M6.4c: one Slack connection's channel and what goes there: alerts from the M3.2b engine (at or
 * above a severity) and the daily digest at a local time in the org's time zone. Amounts appear in
 * the digest only when the connection's owner, who has finance permission, opted in
 * (`finance_opted_by`). `digest_next_at` is the next digest's instant (computed with the org's zone
 * when saved and after each digest; the date it covers is the dedupe key, so DST never sends twice).
 */
export const slackSettings = tenantTable(
  integrationsSchema,
  'slack_settings',
  {
    connectionId: uuid('connection_id').notNull(),
    channelId: text('channel_id'),
    channelName: text('channel_name'),
    alertsEnabled: boolean('alerts_enabled').notNull().default(true),
    alertMinSeverity: text('alert_min_severity').notNull().default('warning'),
    digestEnabled: boolean('digest_enabled').notNull().default(false),
    /** `HH:MM`, wall-clock time in the org's time zone. */
    digestTime: text('digest_time').notNull().default('08:00'),
    digestNextAt: tsz('digest_next_at'),
    includeFinance: boolean('include_finance').notNull().default(false),
    financeOptedBy: uuid('finance_opted_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('slack_settings_org_connection_key').on(t.orgId, t.connectionId),
    index('slack_settings_digest_due_idx').on(t.digestNextAt, t.orgId).where(sql`digest_enabled`),
    foreignKey({
      name: 'slack_settings_connection_fk',
      columns: [t.orgId, t.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete('cascade'),
    check('slack_settings_channel_check', sql`channel_id is null or channel_id ~ '^[CGD][A-Z0-9]{2,20}$'`),
    check(
      'slack_settings_channel_name_check',
      sql`channel_name is null or length(channel_name) between 1 and 80`,
    ),
    check('slack_settings_severity_check', inList('alert_min_severity', SLACK_MIN_SEVERITIES)),
    check('slack_settings_time_check', sql`digest_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check('slack_settings_finance_check', sql`not include_finance or finance_opted_by is not null`),
    check('slack_settings_digest_check', sql`not digest_enabled or channel_id is not null`),
  ],
);

/**
 * M6.4c: every Slack message, sent or to send, unique per (connection, channel, kind, dedupe key):
 * an alert's sending (`alert:<id>:<n>`), a digest's day (`digest:YYYY-MM-DD`) or a test. Claimed
 * with a lease before the call, so retries and concurrent senders post once. The payload is ids,
 * codes and counts (what to render), never personal data.
 */
export const slackMessages = tenantTable(
  integrationsSchema,
  'slack_messages',
  {
    connectionId: uuid('connection_id').notNull(),
    channelId: text('channel_id').notNull(),
    kind: text('kind').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    status: text('status').notNull().default('pending'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: tsz('next_attempt_at'),
    leaseUntil: tsz('lease_until'),
    sentAt: tsz('sent_at'),
    /** Slack's message timestamp (its id in the channel). */
    providerTs: text('provider_ts'),
    errorCode: text('error_code'),
    requestedBy: uuid('requested_by'),
  },
  (t) => [
    uniqueIndex('slack_messages_org_dedupe_key').on(
      t.orgId,
      t.connectionId,
      t.channelId,
      t.kind,
      t.dedupeKey,
    ),
    index('slack_messages_org_connection_created_idx').on(t.orgId, t.connectionId, t.createdAt),
    index('slack_messages_due_idx')
      .on(t.nextAttemptAt, t.orgId)
      .where(sql`status in ('pending', 'sending', 'failed')`),
    foreignKey({
      name: 'slack_messages_connection_fk',
      columns: [t.orgId, t.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete('cascade'),
    check('slack_messages_channel_check', sql`channel_id ~ '^[CGD][A-Z0-9]{2,20}$'`),
    check('slack_messages_kind_check', inList('kind', SLACK_MESSAGE_KINDS)),
    check('slack_messages_status_check', inList('status', SLACK_MESSAGE_STATUSES)),
    check('slack_messages_dedupe_check', sql`dedupe_key ~ '^[a-z]+:[A-Za-z0-9:_-]{1,120}$'`),
    check('slack_messages_payload_check', sql`jsonb_typeof(payload) = 'object'`),
    check('slack_messages_attempts_check', sql`attempts between 0 and 100`),
    check('slack_messages_sent_check', sql`(status = 'sent') = (sent_at is not null)`),
    check('slack_messages_ts_check', sql`provider_ts is null or length(provider_ts) <= 40`),
    check('slack_messages_error_check', sql`error_code is null or error_code ~ '^[a-z0-9_]{1,60}$'`),
  ],
);
