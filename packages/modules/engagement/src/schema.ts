import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
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

/**
 * M5.7a: live polls and moderated Q&A per program session. Owns Postgres schema `engagement`.
 * Composite FKs to `events.events` and `program.sessions` (lower tiers) are hand-written in the
 * migration. Participants are never stored by identity: a `participant_key` is an HMAC of their
 * account or device, scoped to the session (one vote per person per poll, one upvote per question).
 */
export const engagementSchema = pgSchema('engagement');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const POLL_KINDS = ['single', 'multi', 'rating', 'word_cloud'] as const;
export type PollKind = (typeof POLL_KINDS)[number];
export const POLL_STATES = ['draft', 'open', 'closed'] as const;
export type PollState = (typeof POLL_STATES)[number];
export const QUESTION_STATES = ['pending', 'approved', 'dismissed'] as const;
export type QuestionState = (typeof QUESTION_STATES)[number];
/** Who may see the name behind an anonymous question: nobody (not stored), or moderators. */
export const ANONYMOUS_IDENTITY = ['hidden', 'moderators'] as const;
export type AnonymousIdentity = (typeof ANONYMOUS_IDENTITY)[number];

/**
 * One row per session that has live engagement: Q&A switches, the anonymous-identity policy, the
 * display-link version (rotating it revokes every big-screen link) and what is on stage (the
 * presented poll and the pinned question; plain ids, cleared by the commands).
 */
export const sessionSettings = tenantTable(
  engagementSchema,
  'session_settings',
  {
    eventId: uuid('event_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    qaOpen: boolean('qa_open').notNull().default(true),
    allowAnonymous: boolean('allow_anonymous').notNull().default(true),
    anonymousIdentity: text('anonymous_identity').notNull().default('hidden'),
    displayVersion: integer('display_version').notNull().default(1),
    livePollId: uuid('live_poll_id'),
    pinnedQuestionId: uuid('pinned_question_id'),
  },
  (t) => [
    uniqueIndex('session_settings_org_session_key').on(t.orgId, t.sessionId),
    index('session_settings_org_event_idx').on(t.orgId, t.eventId),
    check('session_settings_identity_check', sql`anonymous_identity in ('hidden', 'moderators')`),
    check('session_settings_display_version_check', sql`display_version >= 1`),
  ],
);

/**
 * A poll of one session. Choice polls carry their options (`[{ id, label }]`); rating polls a
 * scale; word clouds neither. Results are counts only (`poll_tallies`); ballots never record the
 * choice. States move forward only: draft → open → closed.
 */
export const polls = tenantTable(
  engagementSchema,
  'polls',
  {
    eventId: uuid('event_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    kind: text('kind').notNull(),
    question: text('question').notNull(),
    options: jsonb('options').notNull().default(sql`'[]'::jsonb`),
    maxChoices: integer('max_choices').notNull().default(1),
    ratingScale: integer('rating_scale'),
    state: text('state').notNull().default('draft'),
    showResults: boolean('show_results').notNull().default(false),
    ballots: integer('ballots').notNull().default(0),
    openedAt: ts('opened_at'),
    closedAt: ts('closed_at'),
  },
  (t) => [
    index('polls_org_session_idx').on(t.orgId, t.sessionId, t.createdAt),
    index('polls_org_event_idx').on(t.orgId, t.eventId),
    check('polls_kind_check', sql`kind in ('single', 'multi', 'rating', 'word_cloud')`),
    check('polls_state_check', sql`state in ('draft', 'open', 'closed')`),
    check('polls_question_check', sql`char_length(question) between 1 and 200`),
    check('polls_max_choices_check', sql`max_choices between 1 and 10`),
    check(
      'polls_rating_scale_check',
      sql`(kind = 'rating') = (rating_scale is not null) and (rating_scale is null or rating_scale between 3 and 10)`,
    ),
    check('polls_ballots_check', sql`ballots >= 0`),
    check('polls_options_check', sql`jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 10`),
  ],
);

/** One per participant per poll (the unique key decides under concurrency). No choice is kept. */
export const pollBallots = tenantTable(
  engagementSchema,
  'poll_ballots',
  {
    pollId: uuid('poll_id').notNull(),
    participantKey: text('participant_key').notNull(),
  },
  (t) => [
    uniqueIndex('poll_ballots_org_poll_participant_key').on(t.orgId, t.pollId, t.participantKey),
    foreignKey({
      name: 'poll_ballots_poll_fk',
      columns: [t.orgId, t.pollId],
      foreignColumns: [polls.orgId, polls.id],
    }).onDelete('cascade'),
    check('poll_ballots_participant_key_check', sql`char_length(participant_key) between 20 and 64`),
  ],
);

/**
 * Result counts: per option id (choice polls), per rating value, or per normalized word (word
 * clouds, at most `MAX_WORDS` distinct words a poll).
 */
export const pollTallies = tenantTable(
  engagementSchema,
  'poll_tallies',
  {
    pollId: uuid('poll_id').notNull(),
    key: text('key').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [
    uniqueIndex('poll_tallies_org_poll_key_key').on(t.orgId, t.pollId, t.key),
    foreignKey({
      name: 'poll_tallies_poll_fk',
      columns: [t.orgId, t.pollId],
      foreignColumns: [polls.orgId, polls.id],
    }).onDelete('cascade'),
    check('poll_tallies_key_check', sql`char_length(key) between 1 and 40`),
    check('poll_tallies_count_check', sql`count >= 0`),
  ],
);

/**
 * A question asked in a session's Q&A. Pending until a moderator approves it; only approved
 * questions are ever public. `author_name` is null for an anonymous question unless the session's
 * policy lets moderators see it (then it is never public either).
 */
export const questions = tenantTable(
  engagementSchema,
  'questions',
  {
    eventId: uuid('event_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    body: text('body').notNull(),
    authorName: text('author_name'),
    anonymous: boolean('anonymous').notNull().default(false),
    participantKey: text('participant_key').notNull(),
    state: text('state').notNull().default('pending'),
    upvotes: integer('upvotes').notNull().default(0),
    moderatedAt: ts('moderated_at'),
    moderatedBy: uuid('moderated_by'),
    answeredAt: ts('answered_at'),
  },
  (t) => [
    index('questions_org_session_state_idx').on(t.orgId, t.sessionId, t.state, t.createdAt),
    index('questions_org_session_participant_idx').on(t.orgId, t.sessionId, t.participantKey, t.createdAt),
    index('questions_org_event_idx').on(t.orgId, t.eventId),
    check('questions_state_check', sql`state in ('pending', 'approved', 'dismissed')`),
    check('questions_body_check', sql`char_length(body) between 1 and 300`),
    check(
      'questions_author_name_check',
      sql`author_name is null or char_length(author_name) between 1 and 60`,
    ),
    check('questions_upvotes_check', sql`upvotes >= 0`),
    check('questions_answered_check', sql`answered_at is null or state = 'approved'`),
    check('questions_participant_key_check', sql`char_length(participant_key) between 20 and 64`),
  ],
);

/** One upvote per participant per question. */
export const questionUpvotes = tenantTable(
  engagementSchema,
  'question_upvotes',
  {
    questionId: uuid('question_id').notNull(),
    participantKey: text('participant_key').notNull(),
  },
  (t) => [
    uniqueIndex('question_upvotes_org_question_participant_key').on(t.orgId, t.questionId, t.participantKey),
    foreignKey({
      name: 'question_upvotes_question_fk',
      columns: [t.orgId, t.questionId],
      foreignColumns: [questions.orgId, questions.id],
    }).onDelete('cascade'),
    check('question_upvotes_participant_key_check', sql`char_length(participant_key) between 20 and 64`),
  ],
);

export { ENGAGEMENT_KINDS, type EngagementKind } from './domain/kinds.ts';

/**
 * M5.7b: one thing an attendee (a crm contact on the event's list) did. `source_ref` names what it
 * was about (a ticket, poll, question, survey or session id) so the same thing never counts twice
 * (unique per contact, kind and source). Anonymous questions are never logged, and nothing here
 * holds a person's answers or choices.
 * Composite FKs to `events.events`, `program.sessions` and `crm.contacts` are hand-written in the
 * migration.
 */
export const engagementEvents = tenantTable(
  engagementSchema,
  'engagement_events',
  {
    eventId: uuid('event_id').notNull(),
    contactId: uuid('contact_id').notNull(),
    sessionId: uuid('session_id'),
    kind: text('kind').notNull(),
    sourceRef: text('source_ref').notNull(),
    occurredAt: ts('occurred_at').notNull(),
  },
  (t) => [
    uniqueIndex('engagement_events_org_contact_kind_source_key').on(
      t.orgId,
      t.contactId,
      t.kind,
      t.sourceRef,
    ),
    index('engagement_events_org_event_contact_idx').on(t.orgId, t.eventId, t.contactId),
    index('engagement_events_org_session_idx').on(t.orgId, t.sessionId).where(sql`session_id is not null`),
    check(
      'engagement_events_kind_check',
      sql`kind in ('check_in', 'poll_vote', 'question', 'feedback', 'enrollment')`,
    ),
    check('engagement_events_source_ref_check', sql`char_length(source_ref) between 1 and 80`),
  ],
);

/** M5.7b: the org's engagement weights (points per kind, 0–100). No row: the defaults. */
export const scoreWeights = tenantTable(
  engagementSchema,
  'score_weights',
  {
    checkIn: integer('check_in').notNull(),
    pollVote: integer('poll_vote').notNull(),
    question: integer('question').notNull(),
    feedback: integer('feedback').notNull(),
    enrollment: integer('enrollment').notNull(),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('score_weights_org_key').on(t.orgId),
    check(
      'score_weights_range_check',
      sql`check_in between 0 and 100 and poll_vote between 0 and 100 and question between 0 and 100 and feedback between 0 and 100 and enrollment between 0 and 100`,
    ),
  ],
);

/* ------------------------------------------------------------------- networking (M5.8a) ---- */

export const LOCATION_KINDS = ['booth', 'meeting_point'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];
export const CONNECTION_STATES = ['pending', 'accepted', 'declined', 'withdrawn'] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];
export const MEETING_STATES = ['pending', 'accepted', 'declined', 'cancelled'] as const;
export type MeetingState = (typeof MEETING_STATES)[number];
export const REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'fake', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_STATES = ['open', 'hidden', 'dismissed'] as const;
export type ReportState = (typeof REPORT_STATES)[number];

/**
 * Networking per event (M5.8a): off until an organizer turns it on. Meetings can be switched off
 * on their own (the directory and connections stay).
 */
export const networkSettings = tenantTable(
  engagementSchema,
  'network_settings',
  {
    eventId: uuid('event_id').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    meetingsEnabled: boolean('meetings_enabled').notNull().default(true),
  },
  (t) => [uniqueIndex('network_settings_org_event_key').on(t.orgId, t.eventId)],
);

/**
 * A person's networking profile at one event, keyed by their org contact (the person, not one
 * ticket). Opt-in only: the row exists once they first opt in, and `opted_in` false (they opted
 * out) or `hidden_at` set (an organizer hid them after a report) keeps them out of every list.
 */
export const networkProfiles = tenantTable(
  engagementSchema,
  'network_profiles',
  {
    eventId: uuid('event_id').notNull(),
    contactId: uuid('contact_id').notNull(),
    optedIn: boolean('opted_in').notNull().default(false),
    optedInAt: ts('opted_in_at'),
    displayName: text('display_name').notNull(),
    headline: text('headline'),
    company: text('company'),
    bio: text('bio'),
    interests: text('interests').array().notNull().default(sql`'{}'::text[]`),
    hiddenAt: ts('hidden_at'),
    hiddenBy: uuid('hidden_by'),
  },
  (t) => [
    uniqueIndex('network_profiles_org_event_contact_key').on(t.orgId, t.eventId, t.contactId),
    index('network_profiles_org_event_listed_idx')
      .on(t.orgId, t.eventId, t.displayName)
      .where(sql`opted_in and hidden_at is null`),
    check('network_profiles_display_name_check', sql`char_length(display_name) between 1 and 80`),
    check('network_profiles_headline_check', sql`headline is null or char_length(headline) between 1 and 80`),
    check('network_profiles_company_check', sql`company is null or char_length(company) between 1 and 80`),
    check('network_profiles_bio_check', sql`bio is null or char_length(bio) between 1 and 500`),
    check('network_profiles_interests_check', sql`cardinality(interests) <= 10`),
    check('network_profiles_opted_in_at_check', sql`not opted_in or opted_in_at is not null`),
  ],
);

/**
 * A connection request between two profiles of one event; one row per pair (either direction).
 * After a decline the same person may not ask again; after a withdrawal either may.
 */
export const networkConnections = tenantTable(
  engagementSchema,
  'network_connections',
  {
    eventId: uuid('event_id').notNull(),
    requesterId: uuid('requester_id').notNull(),
    addresseeId: uuid('addressee_id').notNull(),
    status: text('status').notNull().default('pending'),
    message: text('message'),
    respondedAt: ts('responded_at'),
  },
  (t) => [
    uniqueIndex('network_connections_org_pair_key').on(
      t.orgId,
      sql`least(requester_id, addressee_id)`,
      sql`greatest(requester_id, addressee_id)`,
    ),
    index('network_connections_org_requester_idx').on(t.orgId, t.requesterId, t.status),
    index('network_connections_org_addressee_idx').on(t.orgId, t.addresseeId, t.status),
    index('network_connections_org_event_idx').on(t.orgId, t.eventId),
    foreignKey({
      name: 'network_connections_requester_fk',
      columns: [t.orgId, t.requesterId],
      foreignColumns: [networkProfiles.orgId, networkProfiles.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'network_connections_addressee_fk',
      columns: [t.orgId, t.addresseeId],
      foreignColumns: [networkProfiles.orgId, networkProfiles.id],
    }).onDelete('cascade'),
    check(
      'network_connections_status_check',
      sql`status in ('pending', 'accepted', 'declined', 'withdrawn')`,
    ),
    check('network_connections_self_check', sql`requester_id <> addressee_id`),
    check(
      'network_connections_message_check',
      sql`message is null or char_length(message) between 1 and 300`,
    ),
  ],
);

/** One person blocking another at an event: neither sees the other or can ask anything again. */
export const networkBlocks = tenantTable(
  engagementSchema,
  'network_blocks',
  {
    eventId: uuid('event_id').notNull(),
    blockerId: uuid('blocker_id').notNull(),
    blockedId: uuid('blocked_id').notNull(),
  },
  (t) => [
    uniqueIndex('network_blocks_org_pair_key').on(t.orgId, t.blockerId, t.blockedId),
    index('network_blocks_org_blocked_idx').on(t.orgId, t.blockedId),
    index('network_blocks_org_event_idx').on(t.orgId, t.eventId),
    foreignKey({
      name: 'network_blocks_blocker_fk',
      columns: [t.orgId, t.blockerId],
      foreignColumns: [networkProfiles.orgId, networkProfiles.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'network_blocks_blocked_fk',
      columns: [t.orgId, t.blockedId],
      foreignColumns: [networkProfiles.orgId, networkProfiles.id],
    }).onDelete('cascade'),
    check('network_blocks_self_check', sql`blocker_id <> blocked_id`),
  ],
);

/**
 * A report about a profile, for the organizer's review queue (reporting also blocks). Actions:
 * hide the profile from networking, or dismiss.
 */
export const networkReports = tenantTable(
  engagementSchema,
  'network_reports',
  {
    eventId: uuid('event_id').notNull(),
    reporterId: uuid('reporter_id').notNull(),
    reportedId: uuid('reported_id').notNull(),
    reason: text('reason').notNull(),
    details: text('details'),
    status: text('status').notNull().default('open'),
    resolvedAt: ts('resolved_at'),
    resolvedBy: uuid('resolved_by'),
  },
  (t) => [
    uniqueIndex('network_reports_org_open_pair_key')
      .on(t.orgId, t.reporterId, t.reportedId)
      .where(sql`status = 'open'`),
    index('network_reports_org_event_status_idx').on(t.orgId, t.eventId, t.status, t.createdAt),
    index('network_reports_org_reported_idx').on(t.orgId, t.reportedId),
    foreignKey({
      name: 'network_reports_reporter_fk',
      columns: [t.orgId, t.reporterId],
      foreignColumns: [networkProfiles.orgId, networkProfiles.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'network_reports_reported_fk',
      columns: [t.orgId, t.reportedId],
      foreignColumns: [networkProfiles.orgId, networkProfiles.id],
    }).onDelete('cascade'),
    check(
      'network_reports_reason_check',
      sql`reason in ('spam', 'harassment', 'inappropriate', 'fake', 'other')`,
    ),
    check('network_reports_status_check', sql`status in ('open', 'hidden', 'dismissed')`),
    check('network_reports_details_check', sql`details is null or char_length(details) between 1 and 500`),
    check('network_reports_self_check', sql`reporter_id <> reported_id`),
    check('network_reports_resolved_check', sql`(status = 'open') = (resolved_at is null)`),
  ],
);

/** Where meetings happen: a booth or a meeting point, with how many meetings fit at once. */
export const meetingLocations = tenantTable(
  engagementSchema,
  'meeting_locations',
  {
    eventId: uuid('event_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    capacity: integer('capacity').notNull(),
  },
  (t) => [
    uniqueIndex('meeting_locations_org_event_name_key').on(t.orgId, t.eventId, sql`lower(name)`),
    check('meeting_locations_kind_check', sql`kind in ('booth', 'meeting_point')`),
    check('meeting_locations_name_check', sql`char_length(name) between 1 and 80`),
    check('meeting_locations_capacity_check', sql`capacity between 1 and 50`),
  ],
);

/** When meetings happen: the organizer's time slots (never overlapping within an event). */
export const meetingSlots = tenantTable(
  engagementSchema,
  'meeting_slots',
  {
    eventId: uuid('event_id').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
  },
  (t) => [
    uniqueIndex('meeting_slots_org_event_start_key').on(t.orgId, t.eventId, t.startsAt),
    check('meeting_slots_order_check', sql`ends_at > starts_at`),
    check('meeting_slots_length_check', sql`ends_at - starts_at <= interval '4 hours'`),
  ],
);

/**
 * A meeting request between two profiles for one slot at one location. Accepting takes a table
 * (1…capacity) at the location for that slot: the partial unique key means a table is never
 * held twice, so a location never double-books.
 */
export const meetings = tenantTable(
  engagementSchema,
  'meetings',
  {
    eventId: uuid('event_id').notNull(),
    slotId: uuid('slot_id').notNull(),
    locationId: uuid('location_id').notNull(),
    requesterId: uuid('requester_id').notNull(),
    inviteeId: uuid('invitee_id').notNull(),
    status: text('status').notNull().default('pending'),
    tableNo: integer('table_no'),
    message: text('message'),
    respondedAt: ts('responded_at'),
  },
  (t) => [
    uniqueIndex('meetings_org_location_slot_table_key')
      .on(t.orgId, t.locationId, t.slotId, t.tableNo)
      .where(sql`status = 'accepted'`),
    index('meetings_org_requester_idx').on(t.orgId, t.requesterId, t.status),
    index('meetings_org_invitee_idx').on(t.orgId, t.inviteeId, t.status),
    index('meetings_org_slot_idx').on(t.orgId, t.slotId, t.status),
    index('meetings_org_event_idx').on(t.orgId, t.eventId),
    foreignKey({
      name: 'meetings_slot_fk',
      columns: [t.orgId, t.slotId],
      foreignColumns: [meetingSlots.orgId, meetingSlots.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'meetings_location_fk',
      columns: [t.orgId, t.locationId],
      foreignColumns: [meetingLocations.orgId, meetingLocations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'meetings_requester_fk',
      columns: [t.orgId, t.requesterId],
      foreignColumns: [networkProfiles.orgId, networkProfiles.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'meetings_invitee_fk',
      columns: [t.orgId, t.inviteeId],
      foreignColumns: [networkProfiles.orgId, networkProfiles.id],
    }).onDelete('cascade'),
    check('meetings_status_check', sql`status in ('pending', 'accepted', 'declined', 'cancelled')`),
    check('meetings_self_check', sql`requester_id <> invitee_id`),
    check(
      'meetings_table_check',
      sql`(status = 'accepted') = (table_no is not null) and (table_no is null or table_no between 1 and 50)`,
    ),
    check('meetings_message_check', sql`message is null or char_length(message) between 1 and 300`),
  ],
);
