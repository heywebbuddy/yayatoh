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
  },
  (t) => [
    uniqueIndex('streams_org_session_key').on(t.orgId, t.sessionId),
    uniqueIndex('streams_org_playback_key').on(t.orgId, t.playbackId),
    index('streams_org_event_idx').on(t.orgId, t.eventId),
    check('streams_provider_check', sql`provider in ('fake', 'mux')`),
    check('streams_provider_stream_id_check', sql`provider_stream_id ~ '^[A-Za-z0-9_-]{4,100}$'`),
    check('streams_playback_id_check', sql`playback_id ~ '^[A-Za-z0-9_]{8,64}$'`),
    check('streams_ingest_url_check', sql`ingest_url ~ '^rtmps?://' and char_length(ingest_url) <= 300`),
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
  ],
);
