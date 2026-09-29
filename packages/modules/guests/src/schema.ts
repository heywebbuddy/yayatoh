import { tenantTable } from '@yayatoh/db';
import { type SQL, sql } from 'drizzle-orm';
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

export const guestsSchema = pgSchema('guests');

/**
 * How a change reached the guest list (roadmap §5.1 "paper/manual entry recorded with its
 * source"). `manual`: the host typed it; `paper`: the host typed a paper reply on the guest's
 * behalf. `import`, `collector` and `rsvp` arrive with M4.1b, M4.1f and M4.1d.
 */
export const GUEST_SOURCES = ['manual', 'paper', 'import', 'collector', 'rsvp'] as const;
export type GuestSource = (typeof GUEST_SOURCES)[number];
/** What the console lets a host pick today. */
export const ENTRY_SOURCES = ['manual', 'paper'] as const satisfies readonly GuestSource[];

export const AGE_CLASSES = ['adult', 'child', 'infant'] as const;
export type AgeClass = (typeof AGE_CLASSES)[number];

/** A named guest of the party, or a plus-one slot ("Guest of …") that may be named later. */
export const GUEST_KINDS = ['guest', 'plus_one'] as const;
export type GuestKind = (typeof GUEST_KINDS)[number];

export const HISTORY_ACTIONS = [
  'party_created',
  'party_updated',
  'party_removed',
  'guest_added',
  'guest_updated',
  'guest_removed',
  'guest_moved',
  'plus_one_added',
  'plus_one_named',
  // M4.1c: sub-events, invitations and host-recorded responses.
  'sub_event_created',
  'sub_event_updated',
  'sub_event_moved',
  'sub_event_removed',
  'invitation_added',
  'invitation_removed',
  'response_recorded',
  'response_cleared',
] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

const inList = (column: string, values: readonly string[]): SQL =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`);

/**
 * A party (household, envelope): the unit a wedding invites and seats together. Belongs to one
 * event: `(org_id, event_id)` references `events.events` (a lower tier) through a hand-written
 * foreign key in the migration, cascading on event delete.
 */
export const parties = tenantTable(
  guestsSchema,
  'parties',
  {
    eventId: uuid('event_id').notNull(),
    /** How the host refers to the household ("The Garcias"). */
    name: text('name').notNull(),
    /** The name on the envelope ("Mr. and Mrs. Luis Garcia"), when different. */
    envelopeName: text('envelope_name'),
    /** Host-defined side ("Bride", "Groom", "Both", "Work"), free text. */
    side: text('side'),
    vip: boolean('vip').notNull().default(false),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    /** Host-only notes. */
    notes: text('notes').notNull().default(''),
    source: text('source').notNull().default('manual'),
  },
  (t) => [
    index('parties_org_event_idx').on(t.orgId, t.eventId, t.name),
    check('parties_name_length', sql`length(name) between 1 and 120`),
    check('parties_envelope_length', sql`envelope_name is null or length(envelope_name) between 1 and 200`),
    check('parties_side_length', sql`side is null or length(side) between 1 and 40`),
    check('parties_tags_check', sql`cardinality(tags) <= 20`),
    check('parties_notes_length', sql`length(notes) <= 2000`),
    check('parties_source_check', inList('source', GUEST_SOURCES)),
  ],
);

/**
 * A guest in a party. `plus_one` rows are "Guest of <host>" slots: a name is optional until the
 * host (or, from M4.1d, the party) names them. Dietary and accessibility answers and the home
 * address are sealed together in `private_ciphertext` (the org's key vault; P4-3).
 * `(org_id, attendee_id)` and `(org_id, contact_id)` reference `attendees.attendees` and
 * `crm.contacts` (lower tiers) through hand-written foreign keys that clear the link when the
 * record goes.
 */
export const guests = tenantTable(
  guestsSchema,
  'guests',
  {
    eventId: uuid('event_id').notNull(),
    partyId: uuid('party_id').notNull(),
    kind: text('kind').notNull().default('guest'),
    /** The guest whose plus-one this is (same party), for `plus_one` rows. */
    hostGuestId: uuid('host_guest_id'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    ageClass: text('age_class').notNull().default('adult'),
    /** Free text until RSVP questions (M4.1e) offer the host's menu. */
    meal: text('meal'),
    /** Sealed JSON `{ dietary?, accessibility?, address? }` (key vault, org-scoped). */
    privateCiphertext: text('private_ciphertext'),
    attendeeId: uuid('attendee_id'),
    contactId: uuid('contact_id'),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [
    index('guests_org_party_idx').on(t.orgId, t.partyId, t.createdAt),
    index('guests_org_event_idx').on(t.orgId, t.eventId),
    // One primary contact per party; one plus-one per host.
    uniqueIndex('guests_org_party_primary_key').on(t.orgId, t.partyId).where(sql`is_primary`),
    uniqueIndex('guests_org_host_key').on(t.orgId, t.hostGuestId).where(sql`host_guest_id is not null`),
    uniqueIndex('guests_org_attendee_key').on(t.orgId, t.attendeeId).where(sql`attendee_id is not null`),
    index('guests_org_contact_idx').on(t.orgId, t.contactId).where(sql`contact_id is not null`),
    check('guests_kind_check', inList('kind', GUEST_KINDS)),
    check('guests_age_class_check', inList('age_class', AGE_CLASSES)),
    check(
      'guests_kind_shape',
      sql`(kind = 'guest' and host_guest_id is null and first_name is not null) or (kind = 'plus_one' and host_guest_id is not null and not is_primary)`,
    ),
    check('guests_first_name_length', sql`first_name is null or length(first_name) between 1 and 80`),
    check('guests_last_name_length', sql`last_name is null or length(last_name) between 1 and 80`),
    check('guests_meal_length', sql`meal is null or length(meal) between 1 and 80`),
    check('guests_not_own_host', sql`host_guest_id is null or host_guest_id <> id`),
    foreignKey({
      name: 'guests_party_fk',
      columns: [t.orgId, t.partyId],
      foreignColumns: [parties.orgId, parties.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'guests_host_fk',
      columns: [t.orgId, t.hostGuestId],
      foreignColumns: [t.orgId, t.id],
    }).onDelete('cascade'),
  ],
);

/**
 * Every change to a party or guest, with its source and actor (roadmap §5.1). Append-only for the
 * runtime role (the migration revokes UPDATE and DELETE). `party_id` and `guest_id` carry no
 * foreign key so the history outlives the rows it describes; the event foreign key
 * (hand-written) removes it with the event. RSVP states (M4.1d) add actions, not columns.
 */
export const rsvpHistory = tenantTable(
  guestsSchema,
  'rsvp_history',
  {
    eventId: uuid('event_id').notNull(),
    /** Null only for sub-event actions (M4.1c), which belong to no party. */
    partyId: uuid('party_id'),
    guestId: uuid('guest_id'),
    /** The sub-event an M4.1c action is about (no foreign key: history outlives it). */
    subEventId: uuid('sub_event_id'),
    action: text('action').notNull(),
    source: text('source').notNull(),
    /** `user:<id>`, `api_key:<id>` or `system:<name>` (kernel `actorId`). */
    actor: text('actor').notNull(),
    /** Names of the fields that changed (never their values: some are sealed). */
    fields: text('fields').array().notNull().default(sql`'{}'::text[]`),
    /** Structural facts only, e.g. `{ fromPartyId }` for a move. */
    detail: jsonb('detail').$type<Record<string, string | number>>().notNull().default({}),
  },
  (t) => [
    index('rsvp_history_org_party_idx').on(t.orgId, t.partyId, t.createdAt),
    index('rsvp_history_org_event_idx').on(t.orgId, t.eventId, t.createdAt),
    index('rsvp_history_org_sub_event_idx')
      .on(t.orgId, t.subEventId, t.createdAt)
      .where(sql`sub_event_id is not null`),
    check('rsvp_history_action_check', inList('action', HISTORY_ACTIONS)),
    check('rsvp_history_party_check', sql`party_id is not null or sub_event_id is not null`),
    check('rsvp_history_source_check', inList('source', GUEST_SOURCES)),
  ],
);

/* ------------------------------------------------------------------ M4.1c: sub-events ---- */

/** What a sub-event is (roadmap §5.1): the wedding's parts, or anything else the host names. */
export const SUB_EVENT_KINDS = ['ceremony', 'reception', 'rehearsal_dinner', 'custom'] as const;
export type SubEventKind = (typeof SUB_EVENT_KINDS)[number];

/** A host-recorded answer for one guest and one sub-event (M4.1d adds the public RSVP). */
export const RESPONSE_STATUSES = ['attending', 'declined'] as const;
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number];

/**
 * A part of the event guests are invited to separately (ceremony, reception, rehearsal dinner…):
 * times as instants (shown in the event's zone), a place (free text and/or a venue of the org),
 * an optional date of the event (`events.occurrences`, so it can use that date's chart) and an
 * order. `invite_all`: everyone on the list is invited, including parties added later.
 * `(org_id, event_id)`, `(org_id, venue_id)` and `(org_id, occurrence_id)` reference lower tiers
 * through hand-written foreign keys (the venue and date links clear when those go).
 */
export const subEvents = tenantTable(
  guestsSchema,
  'sub_events',
  {
    eventId: uuid('event_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('custom'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    /** Free-text place ("The garden"), with or without a venue. */
    place: text('place'),
    venueId: uuid('venue_id'),
    occurrenceId: uuid('occurrence_id'),
    position: integer('position').notNull().default(0),
    inviteAll: boolean('invite_all').notNull().default(false),
  },
  (t) => [
    index('sub_events_org_event_idx').on(t.orgId, t.eventId, t.position),
    // Lets seating's per-sub-event chart reference (org, event, sub-event) in one foreign key.
    uniqueIndex('sub_events_org_event_id_key').on(t.orgId, t.eventId, t.id),
    check('sub_events_name_length', sql`length(name) between 1 and 120`),
    check('sub_events_kind_check', inList('kind', SUB_EVENT_KINDS)),
    check('sub_events_place_length', sql`place is null or length(place) between 1 and 200`),
    check('sub_events_time_order', sql`ends_at > starts_at`),
  ],
);

/**
 * Who is invited to which sub-event: one row per named guest (`kind = 'guest'`). A plus-one has
 * no rows: they follow their host's invitations. A sub-event with `invite_all` needs no rows.
 */
export const invitations = tenantTable(
  guestsSchema,
  'invitations',
  {
    eventId: uuid('event_id').notNull(),
    subEventId: uuid('sub_event_id').notNull(),
    guestId: uuid('guest_id').notNull(),
  },
  (t) => [
    uniqueIndex('invitations_org_sub_event_guest_key').on(t.orgId, t.subEventId, t.guestId),
    index('invitations_org_guest_idx').on(t.orgId, t.guestId),
    index('invitations_org_event_idx').on(t.orgId, t.eventId),
    foreignKey({
      name: 'invitations_sub_event_fk',
      columns: [t.orgId, t.subEventId],
      foreignColumns: [subEvents.orgId, subEvents.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'invitations_guest_fk',
      columns: [t.orgId, t.guestId],
      foreignColumns: [guests.orgId, guests.id],
    }).onDelete('cascade'),
  ],
);

/**
 * A guest's answer for one sub-event, recorded by the host (`manual`, `paper`) or, from M4.1d,
 * by the party (`rsvp`). Only for an invited guest (`assertInvitedTx`, in every command that
 * writes here); uninviting clears it.
 */
export const subEventResponses = tenantTable(
  guestsSchema,
  'sub_event_responses',
  {
    eventId: uuid('event_id').notNull(),
    subEventId: uuid('sub_event_id').notNull(),
    guestId: uuid('guest_id').notNull(),
    status: text('status').notNull(),
    source: text('source').notNull(),
  },
  (t) => [
    uniqueIndex('sub_event_responses_org_sub_event_guest_key').on(t.orgId, t.subEventId, t.guestId),
    index('sub_event_responses_org_guest_idx').on(t.orgId, t.guestId),
    index('sub_event_responses_org_event_idx').on(t.orgId, t.eventId),
    check('sub_event_responses_status_check', inList('status', RESPONSE_STATUSES)),
    check('sub_event_responses_source_check', inList('source', GUEST_SOURCES)),
    foreignKey({
      name: 'sub_event_responses_sub_event_fk',
      columns: [t.orgId, t.subEventId],
      foreignColumns: [subEvents.orgId, subEvents.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'sub_event_responses_guest_fk',
      columns: [t.orgId, t.guestId],
      foreignColumns: [guests.orgId, guests.id],
    }).onDelete('cascade'),
  ],
);
