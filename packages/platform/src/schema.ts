import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
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
