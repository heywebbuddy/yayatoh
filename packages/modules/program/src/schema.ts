import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
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
 * M1.4f: the lightweight event program — tracks, rooms, sessions, speakers, exhibitors and
 * sponsors. Every table points at `events.events` with a composite (org_id, event_id) foreign
 * key; those cross-module keys are hand-written in the migration (events is a lower tier).
 */
export const programSchema = pgSchema('program');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const orgFk = (
  name: string,
  cols: [AnyPgColumn, AnyPgColumn],
  target: { orgId: AnyPgColumn; id: AnyPgColumn },
) => foreignKey({ name, columns: cols, foreignColumns: [target.orgId, target.id] });

export const tracks = tenantTable(
  programSchema,
  'tracks',
  {
    eventId: uuid('event_id').notNull(),
    name: text('name').notNull(),
  },
  (t) => [
    uniqueIndex('tracks_org_event_name_key').on(t.orgId, t.eventId, sql`lower(name)`),
    check('tracks_name_length_check', sql`char_length(name) between 1 and 80`),
  ],
);

export const rooms = tenantTable(
  programSchema,
  'rooms',
  {
    eventId: uuid('event_id').notNull(),
    name: text('name').notNull(),
    capacity: integer('capacity'),
  },
  (t) => [
    uniqueIndex('rooms_org_event_name_key').on(t.orgId, t.eventId, sql`lower(name)`),
    check('rooms_name_length_check', sql`char_length(name) between 1 and 80`),
    check('rooms_capacity_check', sql`capacity is null or capacity >= 1`),
  ],
);

/**
 * A session: wall-clock times entered in the event's timezone, stored as instants. A multi-date
 * event's session may belong to one date (`occurrence_id`, M1.4b). Rooms and tracks are
 * optional; a room or track in use can't be deleted until its sessions move (restrict).
 */
export const sessions = tenantTable(
  programSchema,
  'sessions',
  {
    eventId: uuid('event_id').notNull(),
    occurrenceId: uuid('occurrence_id'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    roomId: uuid('room_id'),
    trackId: uuid('track_id'),
    capacity: integer('capacity'),
  },
  (t) => [
    index('sessions_org_event_starts_idx').on(t.orgId, t.eventId, t.startsAt),
    index('sessions_org_room_idx').on(t.orgId, t.roomId),
    index('sessions_org_track_idx').on(t.orgId, t.trackId),
    orgFk('sessions_room_fk', [t.orgId, t.roomId], rooms),
    orgFk('sessions_track_fk', [t.orgId, t.trackId], tracks),
    check('sessions_time_order_check', sql`ends_at > starts_at`),
    check('sessions_title_length_check', sql`char_length(title) between 1 and 160`),
    check('sessions_capacity_check', sql`capacity is null or capacity >= 1`),
  ],
);

export const speakers = tenantTable(
  programSchema,
  'speakers',
  {
    eventId: uuid('event_id').notNull(),
    name: text('name').notNull(),
    /** Job title, e.g. "Head of Research". */
    title: text('title'),
    company: text('company'),
    /** Sanitized Markdown (the M1.4d subset). */
    bio: text('bio').notNull().default(''),
    /** `[{ label, url }]`, http(s) only (validated by the command). */
    links: jsonb('links').notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [
    index('speakers_org_event_name_idx').on(t.orgId, t.eventId, t.name),
    check('speakers_name_length_check', sql`char_length(name) between 1 and 120`),
  ],
);

export const sessionSpeakers = tenantTable(
  programSchema,
  'session_speakers',
  {
    sessionId: uuid('session_id').notNull(),
    speakerId: uuid('speaker_id').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    uniqueIndex('session_speakers_org_session_speaker_key').on(t.orgId, t.sessionId, t.speakerId),
    index('session_speakers_org_speaker_idx').on(t.orgId, t.speakerId),
    orgFk('session_speakers_session_fk', [t.orgId, t.sessionId], sessions).onDelete('cascade'),
    orgFk('session_speakers_speaker_fk', [t.orgId, t.speakerId], speakers).onDelete('cascade'),
  ],
);

export const exhibitors = tenantTable(
  programSchema,
  'exhibitors',
  {
    eventId: uuid('event_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** Free text for now ("B12", "Hall 2 · 214"); floor-plan booths arrive with M5.4. */
    boothLabel: text('booth_label'),
    websiteUrl: text('website_url'),
  },
  (t) => [
    index('exhibitors_org_event_name_idx').on(t.orgId, t.eventId, t.name),
    check('exhibitors_name_length_check', sql`char_length(name) between 1 and 120`),
    check('exhibitors_website_check', sql`website_url is null or website_url ~ '^https?://'`),
  ],
);

/** A sponsor package ("Gold", "Silver"): a name and the order it shows in (1 first). */
export const sponsorTiers = tenantTable(
  programSchema,
  'sponsor_tiers',
  {
    eventId: uuid('event_id').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [
    uniqueIndex('sponsor_tiers_org_event_name_key').on(t.orgId, t.eventId, sql`lower(name)`),
    index('sponsor_tiers_org_event_position_idx').on(t.orgId, t.eventId, t.position),
    check('sponsor_tiers_name_length_check', sql`char_length(name) between 1 and 60`),
    check('sponsor_tiers_position_check', sql`position between 1 and 99`),
  ],
);

export const sponsors = tenantTable(
  programSchema,
  'sponsors',
  {
    eventId: uuid('event_id').notNull(),
    tierId: uuid('tier_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    websiteUrl: text('website_url'),
  },
  (t) => [
    index('sponsors_org_event_tier_idx').on(t.orgId, t.eventId, t.tierId),
    orgFk('sponsors_tier_fk', [t.orgId, t.tierId], sponsorTiers),
    check('sponsors_name_length_check', sql`char_length(name) between 1 and 120`),
    check('sponsors_website_check', sql`website_url is null or website_url ~ '^https?://'`),
  ],
);
