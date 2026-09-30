import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
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

export const surveysSchema = pgSchema('surveys');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const SURVEY_KINDS = ['post_event', 'session_feedback'] as const;
export type SurveyKind = (typeof SURVEY_KINDS)[number];
export const SEND_AUDIENCES = ['all', 'checked_in'] as const;
export type SendAudience = (typeof SEND_AUDIENCES)[number];
/** Where a send came from: the console, or a journey step (M3.7a). */
export const SEND_SOURCES = ['console', 'journey'] as const;

/**
 * A survey about one event (post-event) or one program session (session feedback). Its questions
 * are a form in the forms engine (kind `survey`, subject `survey` + this id), versioned there.
 * Composite FKs to `events.events` and `program.sessions` (lower tiers) are in the migration.
 */
export const surveys = tenantTable(
  surveysSchema,
  'surveys',
  {
    eventId: uuid('event_id').notNull(),
    kind: text('kind').notNull(),
    sessionId: uuid('session_id'),
    title: text('title').notNull(),
    intro: text('intro').notNull().default(''),
    closedAt: ts('closed_at'),
    createdBy: uuid('created_by'),
  },
  (t) => [
    index('surveys_org_event_idx').on(t.orgId, t.eventId, t.createdAt),
    uniqueIndex('surveys_org_event_post_event_key').on(t.orgId, t.eventId).where(sql`kind = 'post_event'`),
    uniqueIndex('surveys_org_session_key').on(t.orgId, t.sessionId).where(sql`session_id is not null`),
    check('surveys_kind_check', sql`kind in ('post_event', 'session_feedback')`),
    check('surveys_session_check', sql`(kind = 'session_feedback') = (session_id is not null)`),
    check('surveys_title_check', sql`char_length(title) between 1 and 120`),
    check('surveys_intro_check', sql`char_length(intro) <= 500`),
  ],
);

/** One send from the console (or a journey step): who it went to and its reminder. */
export const surveySends = tenantTable(
  surveysSchema,
  'sends',
  {
    surveyId: uuid('survey_id').notNull(),
    source: text('source').notNull().default('console'),
    audience: text('audience').notNull(),
    /** Days after the send to remind people who have not answered (null: no reminder). */
    reminderDays: integer('reminder_days'),
    /** Days the links stay valid. */
    linkDays: integer('link_days').notNull(),
    recipients: integer('recipients').notNull(),
    sentBy: uuid('sent_by'),
  },
  (t) => [
    index('sends_org_survey_idx').on(t.orgId, t.surveyId, t.createdAt),
    foreignKey({
      name: 'sends_survey_fk',
      columns: [t.orgId, t.surveyId],
      foreignColumns: [surveys.orgId, surveys.id],
    }).onDelete('cascade'),
    check('sends_source_check', sql`source in ('console', 'journey')`),
    check('sends_audience_check', sql`audience in ('all', 'checked_in')`),
    check('sends_reminder_days_check', sql`reminder_days is null or reminder_days between 1 and 30`),
    check('sends_link_days_check', sql`link_days between 1 and 90`),
    check('sends_recipients_check', sql`recipients >= 0`),
  ],
);

/**
 * One person's signed, single-use survey link. One per person (`contact_id`) per survey: a
 * person holding three tickets is asked once. The token is an HMAC of this id (nothing secret
 * stored). `attendee_id` references `attendees.attendees` (lower tier) in the migration.
 */
export const surveyInvitations = tenantTable(
  surveysSchema,
  'invitations',
  {
    surveyId: uuid('survey_id').notNull(),
    sendId: uuid('send_id').notNull(),
    attendeeId: uuid('attendee_id').notNull(),
    contactId: uuid('contact_id').notNull(),
    expiresAt: ts('expires_at').notNull(),
    remindAt: ts('remind_at'),
    respondedAt: ts('responded_at'),
  },
  (t) => [
    uniqueIndex('invitations_org_survey_contact_key').on(t.orgId, t.surveyId, t.contactId),
    index('invitations_org_survey_responded_idx').on(t.orgId, t.surveyId, t.respondedAt),
    index('invitations_org_send_idx').on(t.orgId, t.sendId),
    index('invitations_org_attendee_idx').on(t.orgId, t.attendeeId),
    foreignKey({
      name: 'invitations_survey_fk',
      columns: [t.orgId, t.surveyId],
      foreignColumns: [surveys.orgId, surveys.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'invitations_send_fk',
      columns: [t.orgId, t.sendId],
      foreignColumns: [surveySends.orgId, surveySends.id],
    }).onDelete('cascade'),
    check('invitations_expiry_check', sql`expires_at > created_at`),
  ],
);

/**
 * The one response per person per survey (the database decides under concurrency: unique per
 * contact and per invitation). The answers live in `forms.form_responses` (respondent
 * `survey_invitation` + the invitation id), validated against the version answered.
 */
export const surveyResponses = tenantTable(
  surveysSchema,
  'responses',
  {
    surveyId: uuid('survey_id').notNull(),
    invitationId: uuid('invitation_id').notNull(),
    contactId: uuid('contact_id').notNull(),
    formVersion: integer('form_version').notNull(),
  },
  (t) => [
    uniqueIndex('responses_org_survey_contact_key').on(t.orgId, t.surveyId, t.contactId),
    uniqueIndex('responses_org_invitation_key').on(t.orgId, t.invitationId),
    index('responses_org_survey_created_idx').on(t.orgId, t.surveyId, t.createdAt),
    foreignKey({
      name: 'responses_survey_fk',
      columns: [t.orgId, t.surveyId],
      foreignColumns: [surveys.orgId, surveys.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'responses_invitation_fk',
      columns: [t.orgId, t.invitationId],
      foreignColumns: [surveyInvitations.orgId, surveyInvitations.id],
    }).onDelete('cascade'),
    check('responses_form_version_check', sql`form_version >= 1`),
  ],
);
