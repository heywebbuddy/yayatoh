import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
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

/* ------------------------------------------------ M5.4a: exhibitor portal and booths ---- */

export const EXHIBITOR_MEMBER_ROLES = ['exhibitor_admin', 'exhibitor_staff'] as const;
export const EXHIBITOR_MEMBER_STATUSES = ['pending', 'active', 'revoked'] as const;
export const PROFILE_CHANGE_STATUSES = ['pending', 'approved', 'rejected'] as const;
const inValues = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

/**
 * Per-event exhibitor settings (M5.4a): the staff badge allowance each exhibitor gets unless the
 * organizer sets its own (M5.4b packages will), and whether portal profile edits wait for the
 * organizer's approval. No row = the defaults.
 */
export const exhibitorSettings = tenantTable(
  programSchema,
  'exhibitor_settings',
  {
    eventId: uuid('event_id').notNull(),
    defaultStaffAllowance: integer('default_staff_allowance').notNull().default(5),
    approvalRequired: boolean('approval_required').notNull().default(false),
  },
  (t) => [
    uniqueIndex('exhibitor_settings_org_event_key').on(t.orgId, t.eventId),
    check('exhibitor_settings_allowance_check', sql`default_staff_allowance between 0 and 500`),
  ],
);

/**
 * What M5.4a adds to an exhibitor (one row per exhibitor, made on first use): links, categories,
 * whether it is listed publicly, and its own staff allowance (null = the event's default).
 */
export const exhibitorProfiles = tenantTable(
  programSchema,
  'exhibitor_profiles',
  {
    eventId: uuid('event_id').notNull(),
    exhibitorId: uuid('exhibitor_id').notNull(),
    /** `[{ label, url }]`, http(s) only (validated by the command). */
    links: jsonb('links').notNull().default(sql`'[]'::jsonb`),
    categories: text('categories').array().notNull().default(sql`'{}'::text[]`),
    listed: boolean('listed').notNull().default(true),
    staffAllowance: integer('staff_allowance'),
  },
  (t) => [
    uniqueIndex('exhibitor_profiles_org_exhibitor_key').on(t.orgId, t.exhibitorId),
    index('exhibitor_profiles_org_event_idx').on(t.orgId, t.eventId),
    orgFk('exhibitor_profiles_exhibitor_fk', [t.orgId, t.exhibitorId], exhibitors).onDelete('cascade'),
    check('exhibitor_profiles_allowance_check', sql`staff_allowance is null or staff_allowance between 0 and 500`),
    check('exhibitor_profiles_categories_check', sql`cardinality(categories) <= 5`),
    check('exhibitor_profiles_links_check', sql`jsonb_typeof(links) = 'array'`),
  ],
);

/**
 * An exhibitor admin's proposed profile (when the event requires approval): the organizer approves
 * (applied to the exhibitor) or rejects it. At most one pending change per exhibitor.
 */
export const exhibitorProfileChanges = tenantTable(
  programSchema,
  'exhibitor_profile_changes',
  {
    eventId: uuid('event_id').notNull(),
    exhibitorId: uuid('exhibitor_id').notNull(),
    memberId: uuid('member_id'),
    proposed: jsonb('proposed').notNull(),
    status: text('status').notNull().default('pending'),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
    reason: text('reason'),
  },
  (t) => [
    uniqueIndex('exhibitor_profile_changes_org_pending_key')
      .on(t.orgId, t.exhibitorId)
      .where(sql`status = 'pending'`),
    index('exhibitor_profile_changes_org_event_idx').on(t.orgId, t.eventId, t.status),
    orgFk('exhibitor_profile_changes_exhibitor_fk', [t.orgId, t.exhibitorId], exhibitors).onDelete('cascade'),
    check('exhibitor_profile_changes_status_check', inValues('status', PROFILE_CHANGE_STATUSES)),
    check('exhibitor_profile_changes_proposed_check', sql`jsonb_typeof(proposed) = 'object'`),
    check('exhibitor_profile_changes_reason_check', sql`reason is null or char_length(reason) <= 500`),
  ],
);

/**
 * People of an exhibitor (M5.4a, decision P5-7): its admins and staff, invited by email and bound
 * to one event role at one event. `pending` until they open their invitation; pending and active
 * staff both count against the allowance, revoked ones don't. `account_id` is the portal account
 * the event-role assignment names (a portal account, never an org member). The sign-in link's
 * secret is kept only as an HMAC (`link_hash`), spent on use; `expires_at` is the event's end
 * plus 90 days.
 */
export const exhibitorMembers = tenantTable(
  programSchema,
  'exhibitor_members',
  {
    eventId: uuid('event_id').notNull(),
    exhibitorId: uuid('exhibitor_id').notNull(),
    email: text('email').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('pending'),
    accountId: uuid('account_id').notNull(),
    linkHash: text('link_hash'),
    linkExpiresAt: timestamp('link_expires_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('exhibitor_members_org_exhibitor_email_key')
      .on(t.orgId, t.exhibitorId, sql`lower(email)`)
      .where(sql`status <> 'revoked'`),
    index('exhibitor_members_org_event_idx').on(t.orgId, t.eventId, t.role),
    index('exhibitor_members_org_exhibitor_idx').on(t.orgId, t.exhibitorId, t.status),
    orgFk('exhibitor_members_exhibitor_fk', [t.orgId, t.exhibitorId], exhibitors).onDelete('cascade'),
    check('exhibitor_members_role_check', inValues('role', EXHIBITOR_MEMBER_ROLES)),
    check('exhibitor_members_status_check', inValues('status', EXHIBITOR_MEMBER_STATUSES)),
    check('exhibitor_members_email_check', sql`char_length(email) between 3 and 254 and email like '%@%'`),
    check('exhibitor_members_link_check', sql`(link_hash is null) = (link_expires_at is null)`),
  ],
);

/**
 * Exhibitor portal sessions (M5.4a's minimal stand-in for M5.3a's portal accounts): a browser
 * signed in as one member. Only the token's HMAC is stored.
 */
export const portalSessions = tenantTable(
  programSchema,
  'portal_sessions',
  {
    memberId: uuid('member_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('portal_sessions_org_token_key').on(t.orgId, t.tokenHash),
    index('portal_sessions_org_member_idx').on(t.orgId, t.memberId),
    orgFk('portal_sessions_member_fk', [t.orgId, t.memberId], exhibitorMembers).onDelete('cascade'),
  ],
);

/**
 * Booths of the exhibit hall (M5.4a): floor-plan booth objects (`@yayatoh/floorplan`) kept as
 * rows, with a number unique per event, a size (width × depth, centimetres) and a category.
 */
export const booths = tenantTable(
  programSchema,
  'booths',
  {
    eventId: uuid('event_id').notNull(),
    number: text('number').notNull(),
    category: text('category'),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
  },
  (t) => [
    uniqueIndex('booths_org_event_number_key').on(t.orgId, t.eventId, sql`lower(number)`),
    check('booths_number_check', sql`char_length(number) between 1 and 20`),
    check('booths_category_check', sql`category is null or char_length(category) between 1 and 40`),
    check('booths_position_check', sql`x between 0 and 100000 and y between 0 and 100000`),
    check('booths_size_check', sql`width between 50 and 10000 and height between 50 and 10000`),
  ],
);

/** Which exhibitors are at which booth: co-exhibitors allowed, at most one primary per booth. */
export const boothAssignments = tenantTable(
  programSchema,
  'booth_assignments',
  {
    eventId: uuid('event_id').notNull(),
    boothId: uuid('booth_id').notNull(),
    exhibitorId: uuid('exhibitor_id').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [
    uniqueIndex('booth_assignments_org_booth_exhibitor_key').on(t.orgId, t.boothId, t.exhibitorId),
    uniqueIndex('booth_assignments_org_booth_primary_key').on(t.orgId, t.boothId).where(sql`is_primary`),
    index('booth_assignments_org_exhibitor_idx').on(t.orgId, t.exhibitorId),
    index('booth_assignments_org_event_idx').on(t.orgId, t.eventId),
    orgFk('booth_assignments_booth_fk', [t.orgId, t.boothId], booths).onDelete('cascade'),
    orgFk('booth_assignments_exhibitor_fk', [t.orgId, t.exhibitorId], exhibitors).onDelete('cascade'),
  ],
);
