import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const applicationsSchema = pgSchema('applications');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Organizer applications and demo requests from the landing page (`/for-organizers`). Global:
 * an applicant has no organization yet. app_user has no privileges on any of these tables: the
 * public form writes through the SECURITY DEFINER `applications.submit`, and staff (platform_reader,
 * apps/admin) read them and change them only through the `applications.*` functions.
 */
export const applications = applicationsSchema.table(
  'applications',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('new'),
    orgName: text('org_name').notNull(),
    orgType: text('org_type').notNull(),
    country: text('country').notNull(),
    website: text('website'),
    contactName: text('contact_name').notNull(),
    contactEmail: text('contact_email').notNull(),
    contactPhone: text('contact_phone'),
    eventTypes: text('event_types').array().notNull(),
    eventsPerYear: text('events_per_year').notNull(),
    expectedTickets: text('expected_tickets').notNull(),
    planInterest: text('plan_interest').notNull(),
    whiteLabel: boolean('white_label').notNull(),
    message: text('message'),
    preferredTime: ts('preferred_time'),
    timezone: text('timezone'),
    locale: text('locale').notNull(),
    assignedTo: text('assigned_to'),
    /** The plan staff approved (may differ from the plan the applicant asked about). */
    approvedPlan: text('approved_plan'),
    signupCodeId: uuid('signup_code_id'),
    decidedBy: text('decided_by'),
    decidedAt: ts('decided_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('applications_status_created_idx').on(t.status, t.createdAt),
    index('applications_email_idx').on(t.contactEmail),
    check('applications_kind_check', sql`kind in ('apply', 'demo')`),
    check(
      'applications_status_check',
      sql`status in ('new', 'in_review', 'approved', 'rejected', 'needs_info')`,
    ),
    check('applications_demo_time_check', sql`kind <> 'demo' or preferred_time is not null`),
    check('applications_country_check', sql`country ~ '^[A-Z]{2}$'`),
    check('applications_email_check', sql`contact_email = lower(contact_email) and contact_email like '%@%'`),
    check(
      'applications_text_check',
      sql`char_length(org_name) between 2 and 160 and char_length(contact_name) between 2 and 120`,
    ),
    check('applications_message_check', sql`message is null or char_length(message) <= 2000`),
    check('applications_approved_check', sql`(status = 'approved') = (signup_code_id is not null)`),
  ],
);

/** Staff notes on an application (internal; never shown to the applicant). */
export const applicationNotes = applicationsSchema.table(
  'notes',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    author: text('author').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('application_notes_app_idx').on(t.applicationId, t.createdAt),
    check('application_notes_body_check', sql`char_length(body) between 1 and 2000`),
  ],
);

/** The audit log: every submit, status change, assignment, note and email, append-only. */
export const applicationEvents = applicationsSchema.table(
  'events',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    actor: text('actor').notNull(),
    data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [
    index('application_events_app_idx').on(t.applicationId, t.at),
    check('application_events_action_check', sql`char_length(action) between 1 and 60`),
  ],
);
