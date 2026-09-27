import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
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

export const attendeesSchema = pgSchema('attendees');

export const ATTENDEE_SOURCES = ['ticket', 'registration', 'guest', 'import', 'comp'] as const;
export const ATTENDEE_STATUSES = ['active', 'cancelled'] as const;

/**
 * The per-event participant record (roadmap §4.4). `(org_id, contact_id)` references
 * `crm.contacts` (a lower tier) through a hand-written migration, so this module never imports
 * crm's schema. `ticket_id` has no foreign key: ticketing is a higher tier.
 */
export const attendees = tenantTable(
  attendeesSchema,
  'attendees',
  {
    eventId: uuid('event_id').notNull(),
    contactId: uuid('contact_id').notNull(),
    source: text('source').notNull(),
    ticketId: uuid('ticket_id'),
    name: text('name').notNull(),
    email: text('email').notNull(),
    status: text('status').notNull().default('active'),
    labels: text('labels').array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [
    index('attendees_org_event_idx').on(t.orgId, t.eventId, t.createdAt),
    index('attendees_org_contact_idx').on(t.orgId, t.contactId),
    uniqueIndex('attendees_org_ticket_key').on(t.orgId, t.ticketId).where(sql`ticket_id is not null`),
    check('attendees_source_check', sql`source in ('ticket', 'registration', 'guest', 'import', 'comp')`),
    check('attendees_status_check', sql`status in ('active', 'cancelled')`),
    check('attendees_labels_check', sql`cardinality(labels) <= 20`),
  ],
);

export const IMPORT_FIELDS = ['name', 'email', 'labels'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/**
 * A guest-list import: the uploaded CSV staged row by row, a column mapping, then an import job
 * (the platform bulk framework) that turns valid rows into attendees. Kept for the failure
 * report and undo.
 */
export const importBatches = tenantTable(
  attendeesSchema,
  'import_batches',
  {
    eventId: uuid('event_id').notNull(),
    fileName: text('file_name').notNull(),
    headers: text('headers').array().notNull(),
    /** field → column index. */
    mapping: jsonb('mapping').$type<Partial<Record<ImportField, number>>>().notNull().default({}),
    /** Labels added to every imported guest. */
    extraLabels: text('extra_labels').array().notNull().default(sql`'{}'::text[]`),
    rowCount: integer('row_count').notNull(),
    validatedAt: timestamp('validated_at', { withTimezone: true, mode: 'date' }),
    uploadedBy: uuid('uploaded_by'),
  },
  (t) => [index('import_batches_org_event_idx').on(t.orgId, t.eventId, t.createdAt)],
);

export const importRows = tenantTable(
  attendeesSchema,
  'import_rows',
  {
    batchId: uuid('batch_id').notNull(),
    /** 1-based data row number (the header is row 0), as the organizer sees it in their sheet. */
    rowNo: integer('row_no').notNull(),
    cells: text('cells').array().notNull(),
    /** Why the row can't be imported, set at validation (null = importable). */
    errorCode: text('error_code'),
    attendeeId: uuid('attendee_id'),
  },
  (t) => [
    uniqueIndex('import_rows_org_batch_row_key').on(t.orgId, t.batchId, t.rowNo),
    foreignKey({
      name: 'import_rows_batch_fk',
      columns: [t.orgId, t.batchId],
      foreignColumns: [importBatches.orgId, importBatches.id],
    }).onDelete('cascade'),
  ],
);
