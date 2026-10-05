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

/**
 * M6.9b: CE (continuing education) credits. Owns Postgres schema `ce`. Composite FKs to
 * `events.events`, `program.sessions` and `ticketing.tickets` (lower tiers) are hand-written in the
 * migration (cascade on delete).
 */
export const ceSchema = pgSchema('ce');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** An event's CE settings: the credit's name and the accrediting body (both optional). */
export const settings = tenantTable(
  ceSchema,
  'settings',
  {
    eventId: uuid('event_id').notNull(),
    /** "CPE credits", "CME hours" … (null: the certificate's own words for CE credits). */
    creditLabel: text('credit_label'),
    accreditor: text('accreditor'),
    calculatedAt: ts('calculated_at'),
  },
  (t) => [
    uniqueIndex('settings_org_event_key').on(t.orgId, t.eventId),
    check(
      'settings_credit_label_check',
      sql`credit_label is null or char_length(credit_label) between 1 and 60`,
    ),
    check('settings_accreditor_check', sql`accreditor is null or char_length(accreditor) between 1 and 120`),
  ],
);

/** A session's credit rule: credits (hundredths), minimum minutes and the attendance that counts. */
export const sessionRules = tenantTable(
  ceSchema,
  'session_rules',
  {
    eventId: uuid('event_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    credits: integer('credits').notNull(),
    minMinutes: integer('min_minutes').notNull(),
    countInPerson: boolean('count_in_person').notNull(),
    countVirtual: boolean('count_virtual').notNull(),
  },
  (t) => [
    uniqueIndex('session_rules_org_session_key').on(t.orgId, t.sessionId),
    index('session_rules_org_event_idx').on(t.orgId, t.eventId),
    check('session_rules_credits_check', sql`credits between 1 and 10000`),
    check('session_rules_min_minutes_check', sql`min_minutes between 1 and 1440`),
    check('session_rules_counts_check', sql`count_in_person or count_virtual`),
  ],
);

export const CERTIFICATE_STATUSES = ['issued', 'revoked'] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];

/**
 * One certificate per ticket (the attendee of one event), with its public verification code. A
 * recalculation with the same inputs changes nothing; different inputs make a new revision (and a
 * new email); no qualifying session left withdraws it (`revoked`, still verifiable as such).
 */
export const certificates = tenantTable(
  ceSchema,
  'certificates',
  {
    eventId: uuid('event_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    code: text('code').notNull(),
    holderName: text('holder_name').notNull(),
    holderEmail: text('holder_email').notNull(),
    locale: text('locale').notNull(),
    totalCredits: integer('total_credits').notNull(),
    revision: integer('revision').notNull().default(1),
    contentHash: text('content_hash').notNull(),
    status: text('status').notNull().default('issued'),
    issuedAt: ts('issued_at').notNull(),
    revisedAt: ts('revised_at').notNull(),
    copyVersion: text('copy_version').notNull(),
  },
  (t) => [
    uniqueIndex('certificates_org_ticket_key').on(t.orgId, t.ticketId),
    uniqueIndex('certificates_org_code_key').on(t.orgId, t.code),
    index('certificates_org_event_idx').on(t.orgId, t.eventId),
    check('certificates_code_check', sql`code ~ '^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$'`),
    check('certificates_status_check', sql`status in ('issued', 'revoked')`),
    check('certificates_total_check', sql`total_credits >= 0`),
    check('certificates_revision_check', sql`revision >= 1`),
    check('certificates_hash_check', sql`content_hash ~ '^[0-9a-f]{64}$'`),
    check('certificates_locale_check', sql`char_length(locale) between 2 and 10`),
  ],
);

/** A session a certificate counts: the minutes it was computed from and the credits awarded. */
export const awards = tenantTable(
  ceSchema,
  'awards',
  {
    eventId: uuid('event_id').notNull(),
    certificateId: uuid('certificate_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    inPersonMinutes: integer('in_person_minutes').notNull(),
    virtualMinutes: integer('virtual_minutes').notNull(),
    minutes: integer('minutes').notNull(),
    credits: integer('credits').notNull(),
  },
  (t) => [
    uniqueIndex('awards_org_session_ticket_key').on(t.orgId, t.sessionId, t.ticketId),
    index('awards_org_certificate_idx').on(t.orgId, t.certificateId),
    index('awards_org_event_idx').on(t.orgId, t.eventId),
    foreignKey({
      name: 'awards_certificate_fk',
      columns: [t.orgId, t.certificateId],
      foreignColumns: [certificates.orgId, certificates.id],
    }).onDelete('cascade'),
    check(
      'awards_minutes_check',
      sql`in_person_minutes >= 0 and virtual_minutes >= 0 and minutes > 0 and credits > 0`,
    ),
  ],
);
