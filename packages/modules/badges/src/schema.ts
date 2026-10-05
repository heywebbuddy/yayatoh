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
import {
  MAX_PRINT_NOTE,
  PRINT_JOB_STATUSES,
  PRINT_KINDS,
  PRINT_REASONS,
  PRINT_SOURCES,
  PRINTER_ADAPTERS,
  PRINTER_STATUSES,
} from './domain/printing.ts';
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

/* ------------------------------------------------------------------------ M5.5b printing ---- */

/**
 * A badge printer of one event (M5.5b, P5-2): reached through the browser's print dialog
 * (AirPrint too) or PrintNode. Printers are archived, never deleted (the print log keeps them).
 * `status` moves `unknown → online` on the first heartbeat and `online → offline` once, when the
 * watchdog finds it silent for 90 s (that transition emits `badges.printer_offline@1`).
 */
export const printers = tenantTable(
  badgesSchema,
  'printers',
  {
    eventId: uuid('event_id').notNull(),
    name: text('name').notNull(),
    adapter: text('adapter').notNull(),
    /** The printer's id in the org's PrintNode account (PrintNode printers only). */
    printnodePrinterId: integer('printnode_printer_id'),
    status: text('status').notNull().default('unknown'),
    lastSeenAt: ts('last_seen_at'),
    offlineAt: ts('offline_at'),
    archivedAt: ts('archived_at'),
    createdBy: uuid('created_by'),
  },
  (t) => [
    index('printers_org_event_idx').on(t.orgId, t.eventId, t.createdAt),
    index('printers_org_status_idx').on(t.orgId, t.status, t.lastSeenAt),
    uniqueIndex('printers_org_event_name_key')
      .on(t.orgId, t.eventId, sql`lower(name)`)
      .where(sql`archived_at is null`),
    check('printers_name_length_check', sql`char_length(name) between 1 and 60`),
    check('printers_adapter_check', list('adapter', PRINTER_ADAPTERS)),
    check('printers_status_check', list('status', PRINTER_STATUSES)),
    check(
      'printers_printnode_check',
      sql`(adapter = 'printnode') = (printnode_printer_id is not null) and coalesce(printnode_printer_id, 1) > 0`,
    ),
    check('printers_offline_check', sql`(status = 'offline') = (offline_at is not null)`),
  ],
);

/**
 * The print log (M5.5b): one row per print or reprint of one badge, with its reason (a first
 * print is `first_print`; a reprint names why, and `other` needs a note). Idempotent per
 * `request_key`. A null printer is the browser's print dialog on the desk's own device.
 */
export const printJobs = tenantTable(
  badgesSchema,
  'print_jobs',
  {
    eventId: uuid('event_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    printerId: uuid('printer_id'),
    adapter: text('adapter').notNull(),
    kind: text('kind').notNull(),
    reason: text('reason').notNull(),
    note: text('note'),
    status: text('status').notNull(),
    source: text('source').notNull(),
    locale: text('locale').notNull(),
    requestKey: text('request_key').notNull(),
    /** PrintNode's print job id, once accepted. */
    providerJobId: text('provider_job_id'),
    errorCode: text('error_code'),
    requestedBy: uuid('requested_by'),
    sentAt: ts('sent_at'),
  },
  (t) => [
    index('print_jobs_org_event_idx').on(t.orgId, t.eventId, t.createdAt),
    index('print_jobs_org_ticket_idx').on(t.orgId, t.ticketId, t.createdAt),
    index('print_jobs_org_printer_idx').on(t.orgId, t.printerId, t.createdAt),
    uniqueIndex('print_jobs_org_request_key').on(t.orgId, t.requestKey),
    foreignKey({
      name: 'print_jobs_printer_fk',
      columns: [t.orgId, t.printerId],
      foreignColumns: [printers.orgId, printers.id],
    }),
    check('print_jobs_adapter_check', list('adapter', PRINTER_ADAPTERS)),
    check('print_jobs_kind_check', list('kind', PRINT_KINDS)),
    check('print_jobs_reason_check', list('reason', PRINT_REASONS)),
    check('print_jobs_kind_reason_check', sql`(kind = 'print') = (reason = 'first_print')`),
    check(
      'print_jobs_note_check',
      sql`note is null or char_length(note) between 1 and ${sql.raw(String(MAX_PRINT_NOTE))}`,
    ),
    check('print_jobs_other_note_check', sql`reason <> 'other' or note is not null`),
    check('print_jobs_status_check', list('status', PRINT_JOB_STATUSES)),
    check('print_jobs_source_check', list('source', PRINT_SOURCES)),
    check('print_jobs_request_key_check', sql`char_length(request_key) between 8 and 80`),
    check('print_jobs_printnode_check', sql`adapter = 'browser' or printer_id is not null`),
  ],
);

/**
 * Per-org print settings (M5.5b). PrintNode (Stage 2, P5-2) is switched on per org by platform
 * staff once the org's PrintNode account is open (`printnode_enabled`); one row per org.
 */
export const printSettings = tenantTable(
  badgesSchema,
  'print_settings',
  {
    printnodeEnabled: boolean('printnode_enabled').notNull().default(false),
  },
  (t) => [uniqueIndex('print_settings_org_key').on(t.orgId)],
);

/**
 * M5.5c kiosk self-print, per event: off until the organizer turns it on. A null printer is the
 * kiosk's own print dialog (the browser adapter); otherwise one of the event's printers.
 */
export const kioskSettings = tenantTable(
  badgesSchema,
  'kiosk_settings',
  {
    eventId: uuid('event_id').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    printerId: uuid('printer_id'),
    /** "No ticket with you? Use your email": an emailed one-time code identifies the attendee. */
    emailCodes: boolean('email_codes').notNull().default(true),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('kiosk_settings_org_event_key').on(t.orgId, t.eventId),
    foreignKey({
      name: 'kiosk_settings_printer_fk',
      columns: [t.orgId, t.printerId],
      foreignColumns: [printers.orgId, printers.id],
    }),
  ],
);

/** What an emailed kiosk code leads to once confirmed (decided when it is asked for). */
export const KIOSK_CHALLENGE_OUTCOMES = ['ticket', 'desk', 'none'] as const;

/**
 * M5.5c: one emailed kiosk code. Neither the address nor the code is kept: only the code's HMAC,
 * the device that asked, and what the code leads to (one ticket, the desk, or nothing: an address
 * with no registration gets no email, but the kiosk answers the same). Five wrong tries lock it.
 */
export const kioskChallenges = tenantTable(
  badgesSchema,
  'kiosk_challenges',
  {
    eventId: uuid('event_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    outcome: text('outcome').notNull(),
    ticketId: uuid('ticket_id'),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
  },
  (t) => [
    index('kiosk_challenges_org_device_idx').on(t.orgId, t.deviceId, t.createdAt),
    index('kiosk_challenges_org_expires_idx').on(t.orgId, t.expiresAt),
    check('kiosk_challenges_outcome_check', list('outcome', KIOSK_CHALLENGE_OUTCOMES)),
    check('kiosk_challenges_ticket_check', sql`(outcome = 'ticket') = (ticket_id is not null)`),
    check('kiosk_challenges_attempts_check', sql`attempts between 0 and 5`),
    check('kiosk_challenges_code_hash_check', sql`code_hash ~ '^[A-Za-z0-9_-]{43}$'`),
  ],
);
