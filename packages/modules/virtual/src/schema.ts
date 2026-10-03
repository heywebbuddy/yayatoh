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
 * M6.9a: virtual and hybrid delivery. Owns Postgres schema `virtual`. Composite FKs to
 * `events.events`, `ticketing.ticket_types`, `ticketing.tickets` and `program.sessions` (lower
 * tiers) are hand-written in the migration (cascade on delete). Stream keys are never stored.
 */
export const virtualSchema = pgSchema('virtual');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** A ticket type's access mode when the organizer chose one (else the event's default applies). */
export const ticketAccess = tenantTable(
  virtualSchema,
  'ticket_access',
  {
    eventId: uuid('event_id').notNull(),
    ticketTypeId: uuid('ticket_type_id').notNull(),
    access: text('access').notNull(),
  },
  (t) => [
    uniqueIndex('ticket_access_org_ticket_type_key').on(t.orgId, t.ticketTypeId),
    index('ticket_access_org_event_idx').on(t.orgId, t.eventId),
    check('ticket_access_access_check', sql`access in ('in_person', 'virtual', 'both')`),
  ],
);

/**
 * One live stream per program session: the provider's stream id and signed-only playback id. The
 * organizer can switch a stream off (no new tokens, no more heartbeats counted).
 */
export const streams = tenantTable(
  virtualSchema,
  'streams',
  {
    eventId: uuid('event_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    provider: text('provider').notNull(),
    providerStreamId: text('provider_stream_id').notNull(),
    playbackId: text('playback_id').notNull(),
    ingestUrl: text('ingest_url').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** M6.10a RTMP overflow: the provider's backup ingest for this stream (same key). */
    backupIngestUrl: text('backup_ingest_url'),
    /** M6.10a: which ingest the organizer's encoder should push to now. */
    activeIngest: text('active_ingest').notNull().default('primary'),
  },
  (t) => [
    uniqueIndex('streams_org_session_key').on(t.orgId, t.sessionId),
    uniqueIndex('streams_org_playback_key').on(t.orgId, t.playbackId),
    index('streams_org_event_idx').on(t.orgId, t.eventId),
    check('streams_provider_check', sql`provider in ('fake', 'mux', 'fake_cloudflare', 'cloudflare')`),
    check('streams_provider_stream_id_check', sql`provider_stream_id ~ '^[A-Za-z0-9_-]{4,100}$'`),
    check('streams_playback_id_check', sql`playback_id ~ '^[A-Za-z0-9_]{8,64}$'`),
    check('streams_ingest_url_check', sql`ingest_url ~ '^rtmps?://' and char_length(ingest_url) <= 300`),
    check(
      'streams_backup_ingest_url_check',
      sql`backup_ingest_url is null or (backup_ingest_url ~ '^rtmps?://' and char_length(backup_ingest_url) <= 300)`,
    ),
    check(
      'streams_active_ingest_check',
      sql`active_ingest = 'primary' or (active_ingest = 'backup' and backup_ingest_url is not null)`,
    ),
  ],
);

/**
 * A viewing: one playback token issued to one ticket for one session. Heartbeats name it through
 * the token; `beat_seq` is the last sequence accepted (a heartbeat must go above it to count).
 */
export const views = tenantTable(
  virtualSchema,
  'views',
  {
    eventId: uuid('event_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    streamId: uuid('stream_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    expiresAt: ts('expires_at').notNull(),
    beatSeq: integer('beat_seq').notNull().default(0),
    lastBeatAt: ts('last_beat_at'),
  },
  (t) => [
    index('views_org_ticket_session_idx').on(t.orgId, t.ticketId, t.sessionId),
    index('views_org_session_idx').on(t.orgId, t.sessionId),
    foreignKey({
      name: 'views_stream_fk',
      columns: [t.orgId, t.streamId],
      foreignColumns: [streams.orgId, streams.id],
    }).onDelete('cascade'),
    check('views_beat_seq_check', sql`beat_seq between 0 and 1000000`),
  ],
);

/**
 * Watch time: one row per ticket per session per minute watched (the server's minute). The
 * unique key is what makes a minute count once, however many heartbeats, tabs or replays arrive.
 * These rows are also the streaming meter (viewer-minutes, D24).
 */
export const watchMinutes = tenantTable(
  virtualSchema,
  'watch_minutes',
  {
    eventId: uuid('event_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    viewId: uuid('view_id').notNull(),
    minute: ts('minute').notNull(),
    /**
     * M6.10a: the provider that served the minute (the meter is priced per provider, D24). Null on
     * minutes counted before M6.10a.
     */
    provider: text('provider'),
  },
  (t) => [
    uniqueIndex('watch_minutes_org_session_ticket_minute_key').on(t.orgId, t.sessionId, t.ticketId, t.minute),
    index('watch_minutes_org_event_session_idx').on(t.orgId, t.eventId, t.sessionId),
    index('watch_minutes_org_minute_idx').on(t.orgId, t.minute),
    foreignKey({
      name: 'watch_minutes_view_fk',
      columns: [t.orgId, t.viewId],
      foreignColumns: [views.orgId, views.id],
    }).onDelete('cascade'),
    check('watch_minutes_minute_check', sql`date_trunc('minute', minute) = minute`),
    check(
      'watch_minutes_provider_check',
      sql`provider is null or provider in ('fake', 'mux', 'fake_cloudflare', 'cloudflare')`,
    ),
  ],
);

/* ---------------------------------------------------------------- M6.9b: Zoom webinars ---- */

/**
 * M6.9b: a program session delivered as a Zoom webinar (the organizer links the webinar's id).
 * One webinar per session and per org. The Zoom connection itself (OAuth through the
 * `IntegrationAuth` port) lives in `integrations`; its Zoom connector reads and writes these
 * tables through this module's exports.
 */
export const zoomWebinars = tenantTable(
  virtualSchema,
  'zoom_webinars',
  {
    eventId: uuid('event_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    webinarId: text('webinar_id').notNull(),
    /**
     * M6.10a: `created` when Yayatoh created the webinar through the org's Zoom connection,
     * `linked` when the organizer typed its id. Join/leave webhooks find the org by a created
     * webinar first (anyone can type an id; only the creating account got it from Zoom).
     */
    origin: text('origin').notNull().default('linked'),
  },
  (t) => [
    uniqueIndex('zoom_webinars_org_session_key').on(t.orgId, t.sessionId),
    uniqueIndex('zoom_webinars_org_webinar_key').on(t.orgId, t.webinarId),
    index('zoom_webinars_org_event_idx').on(t.orgId, t.eventId),
    check('zoom_webinars_webinar_id_check', sql`webinar_id ~ '^[0-9]{9,12}$'`),
    check('zoom_webinars_origin_check', sql`origin in ('linked', 'created')`),
  ],
);

/**
 * A ticket holder to register for a session's webinar (the Zoom connector pushes each row once:
 * the integrations record link and an Idempotency-Key per row and content). One row per session
 * and ticket; `updated_at` moves when the row must be sent again (a new webinar id).
 */
export const zoomRegistrants = tenantTable(
  virtualSchema,
  'zoom_registrants',
  {
    eventId: uuid('event_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    webinarLinkId: uuid('webinar_link_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    email: text('email').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
  },
  (t) => [
    uniqueIndex('zoom_registrants_org_session_ticket_key').on(t.orgId, t.sessionId, t.ticketId),
    index('zoom_registrants_org_updated_idx').on(t.orgId, t.updatedAt, t.id),
    index('zoom_registrants_org_webinar_email_idx').on(t.orgId, t.webinarLinkId, t.email),
    index('zoom_registrants_org_ticket_idx').on(t.orgId, t.ticketId),
    foreignKey({
      name: 'zoom_registrants_webinar_fk',
      columns: [t.orgId, t.webinarLinkId],
      foreignColumns: [zoomWebinars.orgId, zoomWebinars.id],
    }).onDelete('cascade'),
    check('zoom_registrants_email_check', sql`char_length(email) between 3 and 320 and email = lower(email)`),
    check(
      'zoom_registrants_names_check',
      sql`char_length(first_name) between 1 and 64 and char_length(last_name) <= 64`,
    ),
  ],
);

/**
 * Zoom attendance: one join → leave segment from a webinar's participant report (pulled after the
 * session). Matched to a ticket by the registrant's email; a participant we did not register
 * keeps `ticket_id` null and earns nothing.
 */
export const zoomAttendance = tenantTable(
  virtualSchema,
  'zoom_attendance',
  {
    eventId: uuid('event_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    webinarLinkId: uuid('webinar_link_id').notNull(),
    ticketId: uuid('ticket_id'),
    email: text('email'),
    joinedAt: ts('joined_at').notNull(),
    leftAt: ts('left_at').notNull(),
    /**
     * M6.10a: the segment's identity (sha256 of the participant's address and join second), the
     * same from a join/leave webhook and from the report pulled later, so one stay counts once.
     */
    segmentKey: text('segment_key'),
  },
  (t) => [
    index('zoom_attendance_org_event_idx').on(t.orgId, t.eventId),
    uniqueIndex('zoom_attendance_org_webinar_segment_key').on(t.orgId, t.webinarLinkId, t.segmentKey),
    index('zoom_attendance_org_ticket_idx').on(t.orgId, t.ticketId),
    foreignKey({
      name: 'zoom_attendance_webinar_fk',
      columns: [t.orgId, t.webinarLinkId],
      foreignColumns: [zoomWebinars.orgId, zoomWebinars.id],
    }).onDelete('cascade'),
    check('zoom_attendance_times_check', sql`left_at >= joined_at`),
    check('zoom_attendance_email_check', sql`email is null or char_length(email) <= 320`),
    check('zoom_attendance_segment_key_check', sql`segment_key is null or segment_key ~ '^[0-9a-f]{64}$'`),
  ],
);

/* ------------------------------------------------------ M6.10a: Zoom join/leave webhooks ---- */

/**
 * One verified Zoom `webinar.participant_joined` / `webinar.participant_left` webhook. The unique
 * provider event id is the deduplication: a replayed webhook inserts nothing and counts nothing.
 * `participant_key` (sha256 of the participant's Zoom id, else their address) pairs a join with its
 * leave into a `zoom_attendance` segment. Matched to a ticket by the registrant's address.
 */
export const zoomParticipantEvents = tenantTable(
  virtualSchema,
  'zoom_participant_events',
  {
    eventId: uuid('event_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    webinarLinkId: uuid('webinar_link_id').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    kind: text('kind').notNull(),
    participantKey: text('participant_key').notNull(),
    ticketId: uuid('ticket_id'),
    email: text('email'),
    at: ts('at').notNull(),
  },
  (t) => [
    uniqueIndex('zoom_participant_events_org_provider_event_key').on(t.orgId, t.providerEventId),
    index('zoom_participant_events_org_webinar_participant_idx').on(
      t.orgId,
      t.webinarLinkId,
      t.participantKey,
      t.at,
    ),
    index('zoom_participant_events_org_event_idx').on(t.orgId, t.eventId),
    index('zoom_participant_events_org_ticket_idx').on(t.orgId, t.ticketId),
    foreignKey({
      name: 'zoom_participant_events_webinar_fk',
      columns: [t.orgId, t.webinarLinkId],
      foreignColumns: [zoomWebinars.orgId, zoomWebinars.id],
    }).onDelete('cascade'),
    check('zoom_participant_events_kind_check', sql`kind in ('joined', 'left')`),
    check('zoom_participant_events_provider_event_id_check', sql`provider_event_id ~ '^[0-9a-f]{64}$'`),
    check('zoom_participant_events_participant_key_check', sql`participant_key ~ '^[0-9a-f]{64}$'`),
    check('zoom_participant_events_email_check', sql`email is null or char_length(email) <= 320`),
  ],
);
