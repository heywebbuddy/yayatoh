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
  unique,
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
    /**
     * M5.3b: a draft (an accepted call-for-papers proposal not yet scheduled) is the organizer's
     * only: never on the public agenda, its snapshot or the /v1 agenda.
     */
    draft: boolean('draft').notNull().default(false),
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

/* ------------------------------------------------------------ M5.2a: agenda model v2 ---- */

/** Kinds of session an organizer names per event ("Keynote", "Workshop", "Break", …). */
export const sessionTypes = tenantTable(
  programSchema,
  'session_types',
  {
    eventId: uuid('event_id').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    uniqueIndex('session_types_org_event_name_key').on(t.orgId, t.eventId, sql`lower(name)`),
    index('session_types_org_event_position_idx').on(t.orgId, t.eventId, t.position),
    check('session_types_name_length_check', sql`char_length(name) between 1 and 60`),
    check('session_types_position_check', sql`position between 0 and 999`),
  ],
);

/**
 * A "pick one" group: optional sessions in overlapping slots of which a registrant may hold at
 * most one (M5.2a; enforced by M5.2b through `session_group_picks`).
 */
export const sessionGroups = tenantTable(
  programSchema,
  'session_groups',
  {
    eventId: uuid('event_id').notNull(),
    name: text('name').notNull(),
  },
  (t) => [
    uniqueIndex('session_groups_org_event_name_key').on(t.orgId, t.eventId, sql`lower(name)`),
    check('session_groups_name_length_check', sql`char_length(name) between 1 and 80`),
  ],
);

/**
 * One row per session (created by a trigger on `program.sessions`): its type, whether it is
 * included or optional (P5-9), its pick-one group, and the capacity counter. `capacity` mirrors
 * `sessions.capacity` (same trigger); `enrolled` only moves through `claimSessionPlaceTx` /
 * `releaseSessionPlaceTx`, and the CHECK makes `enrolled > capacity` impossible (like
 * ticketing's inventory CHECK).
 */
export const sessionDetails = tenantTable(
  programSchema,
  'session_details',
  {
    eventId: uuid('event_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    typeId: uuid('type_id'),
    admission: text('admission').notNull().default('included'),
    groupId: uuid('group_id'),
    capacity: integer('capacity'),
    enrolled: integer('enrolled').notNull().default(0),
    enrollmentOpen: boolean('enrollment_open').notNull().default(true),
    /** The CSV import's row key (optional `key` column): re-importing matches on it. */
    importKey: text('import_key'),
  },
  (t) => [
    uniqueIndex('session_details_org_session_key').on(t.orgId, t.sessionId),
    // The target of the pick-one guard's composite key (a constraint, created with the table).
    unique('session_details_org_session_group_key').on(t.orgId, t.sessionId, t.groupId),
    uniqueIndex('session_details_org_event_import_key')
      .on(t.orgId, t.eventId, t.importKey)
      .where(sql`import_key is not null`),
    index('session_details_org_event_idx').on(t.orgId, t.eventId),
    index('session_details_org_type_idx').on(t.orgId, t.typeId),
    index('session_details_org_group_idx').on(t.orgId, t.groupId),
    orgFk('session_details_session_fk', [t.orgId, t.sessionId], sessions).onDelete('cascade'),
    orgFk('session_details_type_fk', [t.orgId, t.typeId], sessionTypes),
    orgFk('session_details_group_fk', [t.orgId, t.groupId], sessionGroups),
    check('session_details_admission_check', sql`admission in ('included', 'optional')`),
    check(
      'session_details_enrolled_check',
      sql`enrolled >= 0 and (capacity is null or enrolled <= capacity)`,
    ),
    check('session_details_capacity_check', sql`capacity is null or capacity >= 1`),
    check('session_details_group_optional_check', sql`group_id is null or admission = 'optional'`),
    check(
      'session_details_import_key_check',
      sql`import_key is null or char_length(import_key) between 1 and 80`,
    ),
  ],
);

/**
 * The DB guard for "pick one" groups (prepared for M5.2b): a registrant holds at most one session
 * per group (unique), and the session must be in that group (the composite key into
 * `session_details (org_id, session_id, group_id)`). `registrant_id` names a registration row of
 * the higher-tier `registration` module, so it has no foreign key here.
 */
export const sessionGroupPicks = tenantTable(
  programSchema,
  'session_group_picks',
  {
    groupId: uuid('group_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    registrantId: uuid('registrant_id').notNull(),
  },
  (t) => [
    uniqueIndex('session_group_picks_org_group_registrant_key').on(t.orgId, t.groupId, t.registrantId),
    index('session_group_picks_org_session_idx').on(t.orgId, t.sessionId),
    foreignKey({
      name: 'session_group_picks_session_group_fk',
      columns: [t.orgId, t.sessionId, t.groupId],
      foreignColumns: [sessionDetails.orgId, sessionDetails.sessionId, sessionDetails.groupId],
    }).onDelete('cascade'),
  ],
);

/**
 * An event's agenda publishing state (M5.2a). No row: the agenda is **live** (M1.4f: every
 * change shows at once). `draft`: nothing public. `published`: the public agenda serves
 * `snapshot`; "changed since publish" is derived by comparing `snapshot_hash` with the current
 * agenda's hash.
 */
export const agendaPublications = tenantTable(
  programSchema,
  'agenda_publications',
  {
    eventId: uuid('event_id').notNull(),
    state: text('state').notNull().default('draft'),
    version: integer('version').notNull().default(0),
    /** The public agenda's sessions as published (the allowlisted `PublicSessionDto` shape). */
    snapshot: jsonb('snapshot'),
    snapshotHash: text('snapshot_hash'),
    publishedAt: ts('published_at'),
    publishedBy: text('published_by'),
  },
  (t) => [
    uniqueIndex('agenda_publications_org_event_key').on(t.orgId, t.eventId),
    check('agenda_publications_state_check', sql`state in ('draft', 'published')`),
    check('agenda_publications_version_check', sql`version >= 0`),
    check(
      'agenda_publications_snapshot_check',
      sql`state <> 'published' or (snapshot is not null and snapshot_hash is not null and published_at is not null)`,
    ),
  ],
);

/** A speaker's email (M5.2a): the CSV import matches speakers by it. One per speaker. */
export const speakerContacts = tenantTable(
  programSchema,
  'speaker_contacts',
  {
    eventId: uuid('event_id').notNull(),
    speakerId: uuid('speaker_id').notNull(),
    email: text('email').notNull(),
  },
  (t) => [
    uniqueIndex('speaker_contacts_org_speaker_key').on(t.orgId, t.speakerId),
    uniqueIndex('speaker_contacts_org_event_email_key').on(t.orgId, t.eventId, t.email),
    orgFk('speaker_contacts_speaker_fk', [t.orgId, t.speakerId], speakers).onDelete('cascade'),
    check('speaker_contacts_email_check', sql`email = lower(email) and email like '%_@_%'`),
  ],
);

/* ------------------------------------------------ M5.4a: exhibitor portal and booths ---- */

export const EXHIBITOR_MEMBER_ROLES = ['exhibitor_admin', 'exhibitor_staff'] as const;
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
    check(
      'exhibitor_profiles_allowance_check',
      sql`staff_allowance is null or staff_allowance between 0 and 500`,
    ),
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
    /** The portal account (exhibitor admin) that proposed it. */
    accountId: uuid('account_id'),
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
