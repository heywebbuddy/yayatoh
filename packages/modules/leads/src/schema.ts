import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { MAX_QUALIFIERS, NOTES_MAX, RATINGS, SHARED_FIELDS } from './domain/rules.ts';

export const leadsSchema = pgSchema('leads');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');

/**
 * One exhibitor's lead settings (M5.6b, one row made on first use): the qualifiers its people
 * tick on a lead, whether staff see the whole team's leads, and the exhibitor admin's acceptance
 * of the lead terms (P5-8 click-through; capture waits for it). FKs to `program.exhibitors` and
 * `events.events` (lower tiers) are hand-written in the migration.
 */
export const exhibitorLeadSettings = tenantTable(
  leadsSchema,
  'exhibitor_settings',
  {
    eventId: uuid('event_id').notNull(),
    exhibitorId: uuid('exhibitor_id').notNull(),
    teamVisibility: boolean('team_visibility').notNull().default(false),
    qualifiers: text('qualifiers').array().notNull().default(sql`'{}'::text[]`),
    termsVersion: integer('terms_version'),
    termsAcceptedAt: ts('terms_accepted_at'),
    /** The portal account of the admin who accepted. */
    termsAcceptedBy: uuid('terms_accepted_by'),
  },
  (t) => [
    uniqueIndex('exhibitor_settings_org_exhibitor_key').on(t.orgId, t.exhibitorId),
    index('exhibitor_settings_org_event_idx').on(t.orgId, t.eventId),
    check('exhibitor_settings_qualifiers_check', sql.raw(`cardinality(qualifiers) <= ${MAX_QUALIFIERS}`)),
    check(
      'exhibitor_settings_terms_check',
      sql`(terms_version is null) = (terms_accepted_at is null) and (terms_version is null) = (terms_accepted_by is null)`,
    ),
  ],
);

/**
 * A lead: one attendee (by ticket) as one exhibitor captured them. The person fields are the
 * P5-8 allowlist **stamped at the first scan** (`shared_fields` says which; `email` only with
 * the attendee's consent, with the consent version). The attendee can withdraw their email later:
 * `email` is cleared and `email_withdrawn_at` set, the stamp stays. Rating, qualifiers and notes
 * are the exhibitor's own. Unique per exhibitor and ticket: scanning again adds a scan.
 */
export const leads = tenantTable(
  leadsSchema,
  'leads',
  {
    eventId: uuid('event_id').notNull(),
    exhibitorId: uuid('exhibitor_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    capturedBy: uuid('captured_by').notNull(),
    capturedAt: ts('captured_at').notNull(),
    lastScannedAt: ts('last_scanned_at').notNull(),
    scans: integer('scans').notNull().default(1),
    name: text('name').notNull(),
    jobTitle: text('job_title').notNull().default(''),
    company: text('company').notNull().default(''),
    email: text('email'),
    sharedFields: text('shared_fields').array().notNull(),
    emailConsentVersion: integer('email_consent_version'),
    emailWithdrawnAt: ts('email_withdrawn_at'),
    rating: text('rating'),
    qualifiers: text('qualifiers').array().notNull().default(sql`'{}'::text[]`),
    notes: text('notes').notNull().default(''),
  },
  (t) => [
    uniqueIndex('leads_org_exhibitor_ticket_key').on(t.orgId, t.exhibitorId, t.ticketId),
    index('leads_org_exhibitor_captured_idx').on(t.orgId, t.exhibitorId, t.capturedAt),
    index('leads_org_event_ticket_idx').on(t.orgId, t.eventId, t.ticketId),
    check('leads_scans_check', sql`scans >= 1`),
    check('leads_name_check', sql`char_length(name) <= 200`),
    check('leads_person_check', sql`char_length(job_title) <= 200 and char_length(company) <= 200`),
    check('leads_rating_check', sql.raw(`rating is null or rating in (${list(RATINGS)})`)),
    check('leads_notes_check', sql.raw(`char_length(notes) <= ${NOTES_MAX}`)),
    check('leads_qualifiers_check', sql.raw(`cardinality(qualifiers) <= ${MAX_QUALIFIERS}`)),
    check('leads_shared_fields_check', sql.raw(`shared_fields <@ array[${list(SHARED_FIELDS)}]::text[]`)),
    // Email only when it was shared (with its consent version), and never after a withdrawal.
    check(
      'leads_email_check',
      sql`(email is null or ('email' = any(shared_fields) and email_consent_version is not null and email_withdrawn_at is null))`,
    ),
  ],
);

/**
 * Every scan that made or touched a lead, by the device's scan id: a queued scan synced twice
 * (a retry, two racing batches) is applied once. `captured_at` is the scan's time (the device's,
 * unless it ran ahead); `offline` says it came from the queue.
 */
export const leadScans = tenantTable(
  leadsSchema,
  'lead_scans',
  {
    eventId: uuid('event_id').notNull(),
    exhibitorId: uuid('exhibitor_id').notNull(),
    leadId: uuid('lead_id').notNull(),
    scanId: text('scan_id').notNull(),
    accountId: uuid('account_id').notNull(),
    capturedAt: ts('captured_at').notNull(),
    offline: boolean('offline').notNull().default(false),
    result: text('result').notNull(),
  },
  (t) => [
    uniqueIndex('lead_scans_org_exhibitor_scan_key').on(t.orgId, t.exhibitorId, t.scanId),
    index('lead_scans_org_lead_idx').on(t.orgId, t.leadId),
    index('lead_scans_org_account_idx').on(t.orgId, t.accountId),
    foreignKey({
      name: 'lead_scans_lead_fk',
      columns: [t.orgId, t.leadId],
      foreignColumns: [leads.orgId, leads.id],
    }).onDelete('cascade'),
    check('lead_scans_scan_id_check', sql`scan_id ~ '^[A-Za-z0-9_-]{8,80}$'`),
    check('lead_scans_result_check', sql`result in ('captured', 'rescanned')`),
  ],
);
