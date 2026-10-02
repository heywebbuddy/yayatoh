import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
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
import { BADGE_SIZES } from './domain/sizes.ts';
import { BATCH_SORTS } from './domain/sort.ts';

/**
 * M5.5a badges: templates (with immutable versions), their assignment to ticket types, and batch
 * PDF runs. Cross-module keys to `events.events` and `ticketing.ticket_types` are hand-written in
 * the migration (lower tiers).
 */
export const badgesSchema = pgSchema('badges');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const list = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength),
  fromDriver: (v) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength),
});

/** A badge template of one event. At most one is the event's default (the fallback). */
export const templates = tenantTable(
  badgesSchema,
  'templates',
  {
    eventId: uuid('event_id').notNull(),
    name: text('name').notNull(),
    /** The current version's stock size (denormalized for lists). */
    size: text('size').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    currentVersion: integer('current_version').notNull().default(1),
  },
  (t) => [
    index('templates_org_event_idx').on(t.orgId, t.eventId, t.createdAt),
    uniqueIndex('templates_org_event_name_key').on(t.orgId, t.eventId, sql`lower(name)`),
    uniqueIndex('templates_org_event_default_key').on(t.orgId, t.eventId).where(sql`is_default`),
    check('templates_name_length_check', sql`char_length(name) between 1 and 80`),
    check('templates_size_check', list('size', BADGE_SIZES)),
    check('templates_version_check', sql`current_version >= 1`),
  ],
);

/** Immutable: every save writes a new version; a batch pins the versions it prints. */
export const templateVersions = tenantTable(
  badgesSchema,
  'template_versions',
  {
    templateId: uuid('template_id').notNull(),
    version: integer('version').notNull(),
    /** `BadgeDesign` (sizes, elements, ribbons, the answer keys allowed onto badges). */
    design: jsonb('design').notNull(),
    createdBy: uuid('created_by'),
  },
  (t) => [
    uniqueIndex('template_versions_org_template_version_key').on(t.orgId, t.templateId, t.version),
    foreignKey({
      name: 'template_versions_template_fk',
      columns: [t.orgId, t.templateId],
      foreignColumns: [templates.orgId, templates.id],
    }).onDelete('cascade'),
    check('template_versions_version_check', sql`version >= 1`),
  ],
);

/**
 * Which template a ticket type prints with (one per ticket type). One target column per kind of
 * binding: registration types (M5.1a, Wave 2) add a nullable `registration_type_id` with its own
 * foreign key and unique index, and widen `assignments_target_check` to
 * `num_nonnulls(ticket_type_id, registration_type_id) = 1` (NOT VALID, then VALIDATE): additive.
 */
export const assignments = tenantTable(
  badgesSchema,
  'assignments',
  {
    eventId: uuid('event_id').notNull(),
    templateId: uuid('template_id').notNull(),
    ticketTypeId: uuid('ticket_type_id'),
  },
  (t) => [
    index('assignments_org_event_idx').on(t.orgId, t.eventId),
    index('assignments_org_template_idx').on(t.orgId, t.templateId),
    uniqueIndex('assignments_org_ticket_type_key')
      .on(t.orgId, t.ticketTypeId)
      .where(sql`ticket_type_id is not null`),
    foreignKey({
      name: 'assignments_template_fk',
      columns: [t.orgId, t.templateId],
      foreignColumns: [templates.orgId, templates.id],
    }).onDelete('cascade'),
    check('assignments_target_check', sql`num_nonnulls(ticket_type_id) = 1`),
  ],
);

export const BATCH_STATUSES = ['queued', 'running', 'done', 'cancelled', 'failed'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/**
 * One batch PDF run: the selection (active tickets, optionally of some ticket types) snapshotted
 * and sorted at the start, the template versions pinned, then rendered in chunks by the worker's
 * `badges.batch` job. Idempotent per `request_key`.
 */
export const batches = tenantTable(
  badgesSchema,
  'batches',
  {
    eventId: uuid('event_id').notNull(),
    requestKey: text('request_key').notNull(),
    status: text('status').notNull().default('queued'),
    sort: text('sort').notNull(),
    /** Labels inside the PDF (QR accessible names) are in this locale. */
    locale: text('locale').notNull(),
    ticketTypeIds: uuid('ticket_type_ids').array().notNull().default(sql`'{}'::uuid[]`),
    /** The sorted selection. */
    ticketIds: uuid('ticket_ids').array().notNull(),
    /** Pinned versions: `{ byType: { ticketTypeId: versionId }, fallback: versionId | null }`. */
    versionMap: jsonb('version_map').notNull(),
    total: integer('total').notNull(),
    processed: integer('processed').notNull().default(0),
    /** Tickets whose type has no template and no default exists: not printed. */
    skipped: integer('skipped').notNull().default(0),
    /** The merged PDF in the media store (`{org}/{batch}/{n}-{sha}.pdf`). */
    fileKey: text('file_key'),
    bytes: integer('bytes'),
    requestedBy: uuid('requested_by'),
    errorCode: text('error_code'),
    finishedAt: ts('finished_at'),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [
    index('batches_org_event_idx').on(t.orgId, t.eventId, t.createdAt),
    index('batches_org_status_idx').on(t.orgId, t.status),
    uniqueIndex('batches_org_request_key').on(t.orgId, t.requestKey),
    check('batches_status_check', list('status', BATCH_STATUSES)),
    check('batches_sort_check', list('sort', BATCH_SORTS)),
    check('batches_request_key_check', sql`char_length(request_key) between 8 and 80`),
    check(
      'batches_counts_check',
      sql`total >= 0 and processed between 0 and total and skipped between 0 and total`,
    ),
    check('batches_done_check', sql`(status = 'done') = (file_key is not null)`),
  ],
);

/** Rendered chunks of a running batch; merged into one file at the end, then deleted. */
export const batchParts = tenantTable(
  badgesSchema,
  'batch_parts',
  {
    batchId: uuid('batch_id').notNull(),
    seq: integer('seq').notNull(),
    badges: integer('badges').notNull(),
    pdf: bytea('pdf').notNull(),
  },
  (t) => [
    uniqueIndex('batch_parts_org_batch_seq_key').on(t.orgId, t.batchId, t.seq),
    foreignKey({
      name: 'batch_parts_batch_fk',
      columns: [t.orgId, t.batchId],
      foreignColumns: [batches.orgId, batches.id],
    }).onDelete('cascade'),
    check('batch_parts_seq_check', sql`seq >= 0 and badges >= 0`),
  ],
);
