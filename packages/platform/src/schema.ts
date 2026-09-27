import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
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
  },
  (t) => [
    uniqueIndex('domain_events_log_seq_key').on(t.logSeq),
    index('domain_events_org_id_log_seq_idx').on(t.orgId, t.logSeq),
    index('domain_events_unpublished_idx').on(t.orgId, t.id).where(sql`published_at is null`),
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

/** Append-only audit log (app_user may only INSERT and SELECT; see migration). */
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
  },
  (t) => [index('audit_events_org_id_created_at_idx').on(t.orgId, t.createdAt)],
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
    note: text('note').notNull().default(''),
    createdBy: text('created_by').notNull(),
    createdAt: tsz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('signup_codes_code_hash_key').on(t.codeHash),
    check('signup_codes_uses_check', sql`uses >= 0 and uses <= max_uses and max_uses between 1 and 1000`),
  ],
);
