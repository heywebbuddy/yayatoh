import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { programSchema, tracks } from './schema.ts';

/**
 * M5.3b call for papers. One call per event (open/closed, optional deadline, blind review); the
 * public form takes a proposal (fixed fields + the event's `cfp` questions in the forms engine)
 * with co-speakers; reviewers are portal accounts (event role `cfp_reviewer`, P5-7) who see only
 * the submissions assigned to them; one review (score 1–5 and a comment) per assignment. Accepting
 * creates (or reuses, by email) the speakers and exactly one draft session (`session_id`, unique).
 * Each table points at `events.events` with a composite (org_id, event_id) key, hand-written in
 * the migration.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

export const CFP_STATUSES = ['draft', 'open', 'closed'] as const;
export type CfpStatus = (typeof CFP_STATUSES)[number];
export const SUBMISSION_STATUSES = ['submitted', 'accepted', 'rejected'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const cfpCalls = tenantTable(
  programSchema,
  'cfp_calls',
  {
    eventId: uuid('event_id').notNull(),
    status: text('status').notNull().default('draft'),
    /** Shown above the public form (plain text, paragraphs). */
    intro: text('intro').notNull().default(''),
    /** No proposals after this instant (null: until the organizer closes the call). */
    closesAt: ts('closes_at'),
    /** Reviewers never see who submitted (names, emails, bios, co-speakers, custom answers). */
    blind: boolean('blind').notNull().default(false),
    /** Session lengths a proposal may ask for, in minutes. */
    durations: integer('durations').array().notNull().default(sql`'{30,45}'::integer[]`),
    maxCoSpeakers: integer('max_co_speakers').notNull().default(3),
  },
  (t) => [
    uniqueIndex('cfp_calls_org_event_key').on(t.orgId, t.eventId),
    check('cfp_calls_status_check', inList('status', CFP_STATUSES)),
    check('cfp_calls_intro_length_check', sql`char_length(intro) <= 4000`),
    check(
      'cfp_calls_durations_check',
      sql`cardinality(durations) between 1 and 8 and 5 <= all(durations) and 480 >= all(durations)`,
    ),
    check('cfp_calls_max_co_speakers_check', sql`max_co_speakers between 0 and 5`),
  ],
);

export const cfpSubmissions = tenantTable(
  programSchema,
  'cfp_submissions',
  {
    eventId: uuid('event_id').notNull(),
    callId: uuid('call_id').notNull(),
    status: text('status').notNull().default('submitted'),
    title: text('title').notNull(),
    abstract: text('abstract').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    trackId: uuid('track_id'),
    speakerName: text('speaker_name').notNull(),
    speakerEmail: text('speaker_email').notNull(),
    speakerTitle: text('speaker_title'),
    speakerCompany: text('speaker_company'),
    speakerBio: text('speaker_bio').notNull().default(''),
    /** The submitter's language: the decision email is written in it. */
    locale: text('locale').notNull(),
    decidedAt: ts('decided_at'),
    decidedBy: text('decided_by'),
    /** Sent to the speaker with the decision. */
    decisionNote: text('decision_note'),
    /** Set on acceptance: the lead speaker and the one draft session it created (null once deleted). */
    speakerId: uuid('speaker_id'),
    sessionId: uuid('session_id'),
  },
  (t) => [
    index('cfp_submissions_org_event_status_idx').on(t.orgId, t.eventId, t.status, t.createdAt),
    uniqueIndex('cfp_submissions_org_call_email_title_key').on(
      t.orgId,
      t.callId,
      t.speakerEmail,
      sql`lower(title)`,
    ),
    uniqueIndex('cfp_submissions_org_session_key').on(t.orgId, t.sessionId),
    foreignKey({
      name: 'cfp_submissions_call_fk',
      columns: [t.orgId, t.callId],
      foreignColumns: [cfpCalls.orgId, cfpCalls.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'cfp_submissions_track_fk',
      columns: [t.orgId, t.trackId],
      foreignColumns: [tracks.orgId, tracks.id],
    }),
    check('cfp_submissions_status_check', inList('status', SUBMISSION_STATUSES)),
    check('cfp_submissions_title_length_check', sql`char_length(title) between 1 and 160`),
    check('cfp_submissions_abstract_length_check', sql`char_length(abstract) between 1 and 5000`),
    check('cfp_submissions_duration_check', sql`duration_minutes between 5 and 480`),
    check(
      'cfp_submissions_email_check',
      sql`speaker_email = lower(speaker_email) and char_length(speaker_email) between 3 and 254`,
    ),
    check('cfp_submissions_name_length_check', sql`char_length(speaker_name) between 1 and 120`),
    check('cfp_submissions_bio_length_check', sql`char_length(speaker_bio) <= 4000`),
    check(
      'cfp_submissions_note_length_check',
      sql`decision_note is null or char_length(decision_note) <= 1000`,
    ),
    // Deleting the speaker or the session later keeps the decision (the keys to `speakers` and
    // `sessions` are hand-written `on delete set null (column)` in the migration).
    check('cfp_submissions_decided_check', sql`(status = 'submitted') = (decided_at is null)`),
  ],
);

export const cfpCoSpeakers = tenantTable(
  programSchema,
  'cfp_co_speakers',
  {
    submissionId: uuid('submission_id').notNull(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    uniqueIndex('cfp_co_speakers_org_submission_email_key').on(t.orgId, t.submissionId, t.email),
    foreignKey({
      name: 'cfp_co_speakers_submission_fk',
      columns: [t.orgId, t.submissionId],
      foreignColumns: [cfpSubmissions.orgId, cfpSubmissions.id],
    }).onDelete('cascade'),
    check('cfp_co_speakers_name_length_check', sql`char_length(name) between 1 and 120`),
    check('cfp_co_speakers_email_check', sql`email = lower(email) and char_length(email) between 3 and 254`),
  ],
);

/** A reviewer of one event's call: the subject of their portal account (`cfp_reviewer`). */
export const cfpReviewers = tenantTable(
  programSchema,
  'cfp_reviewers',
  {
    eventId: uuid('event_id').notNull(),
    name: text('name').notNull(),
    email: text('email').notNull(),
  },
  (t) => [
    uniqueIndex('cfp_reviewers_org_event_email_key').on(t.orgId, t.eventId, t.email),
    check('cfp_reviewers_name_length_check', sql`char_length(name) between 1 and 120`),
    check('cfp_reviewers_email_check', sql`email = lower(email) and char_length(email) between 3 and 254`),
  ],
);

export const cfpAssignments = tenantTable(
  programSchema,
  'cfp_assignments',
  {
    eventId: uuid('event_id').notNull(),
    submissionId: uuid('submission_id').notNull(),
    reviewerId: uuid('reviewer_id').notNull(),
  },
  (t) => [
    uniqueIndex('cfp_assignments_org_submission_reviewer_key').on(t.orgId, t.submissionId, t.reviewerId),
    index('cfp_assignments_org_reviewer_idx').on(t.orgId, t.reviewerId),
    foreignKey({
      name: 'cfp_assignments_submission_fk',
      columns: [t.orgId, t.submissionId],
      foreignColumns: [cfpSubmissions.orgId, cfpSubmissions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'cfp_assignments_reviewer_fk',
      columns: [t.orgId, t.reviewerId],
      foreignColumns: [cfpReviewers.orgId, cfpReviewers.id],
    }).onDelete('cascade'),
  ],
);

/** One review per assignment; the reviewer may change it until the submission is decided. */
export const cfpReviews = tenantTable(
  programSchema,
  'cfp_reviews',
  {
    assignmentId: uuid('assignment_id').notNull(),
    submissionId: uuid('submission_id').notNull(),
    score: integer('score').notNull(),
    comment: text('comment').notNull().default(''),
  },
  (t) => [
    uniqueIndex('cfp_reviews_org_assignment_key').on(t.orgId, t.assignmentId),
    index('cfp_reviews_org_submission_idx').on(t.orgId, t.submissionId),
    foreignKey({
      name: 'cfp_reviews_assignment_fk',
      columns: [t.orgId, t.assignmentId],
      foreignColumns: [cfpAssignments.orgId, cfpAssignments.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'cfp_reviews_submission_fk',
      columns: [t.orgId, t.submissionId],
      foreignColumns: [cfpSubmissions.orgId, cfpSubmissions.id],
    }).onDelete('cascade'),
    check('cfp_reviews_score_check', sql`score between 1 and 5`),
    check('cfp_reviews_comment_length_check', sql`char_length(comment) <= 2000`),
  ],
);
