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
  // M4.1d: the RSVP flow (party link, PIN, states, deadline).
  'rsvp_link_created',
  'rsvp_link_reset',
  'rsvp_pin_reset',
  'rsvp_sent',
  'rsvp_viewed',
  'rsvp_submitted',
  'rsvp_reopened',
  // M4.1f: invitations sent by email/text and the contact collector's approvals.
  'invitation_sent',
  'collector_approved',
  'collector_merged',
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

/* ------------------------------------------------------------------- M4.1b: imports ---- */

/** Where an imported list came from: pasted text, a CSV or XLSX file, or a Google Sheet link. */
export const IMPORT_SOURCES = ['paste', 'csv', 'xlsx', 'sheet'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];
/** staged → validated (mapping checked, parties planned) → importing → imported. */
export const IMPORT_STATUSES = ['staged', 'validated', 'importing', 'imported'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/**
 * One guest-list import (M4.1b). The header row is sealed like the rows (a pasted list without a
 * header puts a guest there). Nothing reaches the guest list until the host checks the mapping
 * and confirms. A Google Sheet's link is never stored.
 */
export const importBatches = tenantTable(
  guestsSchema,
  'import_batches',
  {
    eventId: uuid('event_id').notNull(),
    source: text('source').notNull(),
    /** The uploaded file's name; empty for a pasted list or a sheet. */
    fileName: text('file_name').notNull().default(''),
    /** XLSX: the sheet read. */
    sheet: text('sheet'),
    /** XLSX: every sheet of the workbook. */
    sheets: text('sheets').array().notNull().default(sql`'{}'::text[]`),
    /** Sealed JSON `{ headers }` (key vault, org-scoped); null once purged. */
    headersCiphertext: text('headers_ciphertext'),
    columnCount: integer('column_count').notNull(),
    /** field → column index (`GuestMapping`). */
    mapping: jsonb('mapping').$type<Record<string, number>>().notNull().default({}),
    rowCount: integer('row_count').notNull(),
    status: text('status').notNull().default('staged'),
    partiesPlanned: integer('parties_planned').notNull().default(0),
    guestsPlanned: integer('guests_planned').notNull().default(0),
    partiesImported: integer('parties_imported').notNull().default(0),
    guestsImported: integer('guests_imported').notNull().default(0),
    validatedAt: timestamp('validated_at', { withTimezone: true, mode: 'date' }),
    importedAt: timestamp('imported_at', { withTimezone: true, mode: 'date' }),
    /** Staged rows (and the rejected ones after the import) are purged at this time. */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    purgedAt: timestamp('purged_at', { withTimezone: true, mode: 'date' }),
    uploadedBy: uuid('uploaded_by'),
  },
  (t) => [
    index('import_batches_org_event_idx').on(t.orgId, t.eventId, t.createdAt),
    index('import_batches_org_expiry_idx').on(t.orgId, t.expiresAt).where(sql`purged_at is null`),
    check('import_batches_source_check', inList('source', IMPORT_SOURCES)),
    check('import_batches_status_check', inList('status', IMPORT_STATUSES)),
    check('import_batches_file_name_length', sql`length(file_name) <= 200`),
    check('import_batches_sheet_length', sql`sheet is null or length(sheet) between 1 and 200`),
    check('import_batches_sheets_check', sql`cardinality(sheets) <= 100`),
    check('import_batches_columns_check', sql`column_count between 1 and 50`),
  ],
);

/**
 * A staged row of an import: its cells sealed (P4-3: dietary, accessibility and address columns
 * are in there), the reason it can't be imported, and the party it becomes part of. The planned
 * party id is the import's idempotency key: a party is created with that id once. Imported rows
 * lose their cells at once; rejected rows keep them (for the download) until the batch expires.
 */
export const importRows = tenantTable(
  guestsSchema,
  'import_rows',
  {
    batchId: uuid('batch_id').notNull(),
    /** 1-based data row number (the header is row 0), as the host sees it in their sheet. */
    rowNo: integer('row_no').notNull(),
    /** Sealed JSON `{ cells }`; null once imported or purged. */
    cellsCiphertext: text('cells_ciphertext'),
    errorCode: text('error_code'),
    plannedPartyId: uuid('planned_party_id'),
    importedAt: timestamp('imported_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('import_rows_org_batch_row_key').on(t.orgId, t.batchId, t.rowNo),
    index('import_rows_org_planned_idx')
      .on(t.orgId, t.plannedPartyId)
      .where(sql`planned_party_id is not null`),
    check('import_rows_error_length', sql`error_code is null or length(error_code) between 1 and 40`),
    foreignKey({
      name: 'import_rows_batch_fk',
      columns: [t.orgId, t.batchId],
      foreignColumns: [importBatches.orgId, importBatches.id],
    }).onDelete('cascade'),
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

/* ------------------------------------------------------------------------ M4.1d: RSVP ---- */

/**
 * Where a party is in the RSVP flow (roadmap §5.2): `invited` (on the list), `sent` (the host
 * sent or printed the invitation), `viewed` (the party opened its page), `responded` (it
 * answered, or the host recorded its answer).
 */
export const PARTY_RSVP_STATES = ['invited', 'sent', 'viewed', 'responded'] as const;
export type PartyRsvpState = (typeof PARTY_RSVP_STATES)[number];

/**
 * An event's RSVP settings (M4.1d): the deadline (after it the page is read-only unless the host
 * reopens a party), whether the paper fallback (exact full name + the party's PIN) is on, and the
 * short code of that fallback's address (`/rsvp/find/{code}`), unique across the platform so the
 * address alone finds the event (a SECURITY DEFINER function resolves it, ids only).
 */
export const rsvpSettings = tenantTable(
  guestsSchema,
  'rsvp_settings',
  {
    eventId: uuid('event_id').notNull(),
    deadline: timestamp('deadline', { withTimezone: true, mode: 'date' }),
    nameLookup: boolean('name_lookup').notNull().default(true),
    lookupCode: text('lookup_code').notNull(),
  },
  (t) => [
    uniqueIndex('rsvp_settings_org_event_key').on(t.orgId, t.eventId),
    uniqueIndex('rsvp_settings_lookup_code_key').on(t.lookupCode),
    // Generated codes are 8 characters (`LOOKUP_ALPHABET`); the check also admits the canary's
    // `CANARY_<nn>_<row>` shape (column privacy seed `code`).
    check('rsvp_settings_lookup_code_check', sql`lookup_code ~ '^[0-9A-Z_]{8,40}$'`),
  ],
);

/**
 * A party's RSVP state and credentials (M4.1d). The party link is `signLinkToken(link_id)`:
 * resetting the link gives a new `link_id`, so every earlier link (and its QR) stops working;
 * it also stops at `link_expires_at`. The PIN printed on the invitation is derived from the party
 * and `pin_version` under the app secret (never stored); resetting it bumps the version.
 * `reopened`: the host let the party answer once more after the deadline.
 */
export const partyRsvp = tenantTable(
  guestsSchema,
  'party_rsvp',
  {
    eventId: uuid('event_id').notNull(),
    partyId: uuid('party_id').notNull(),
    linkId: uuid('link_id').notNull(),
    linkExpiresAt: timestamp('link_expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    pinVersion: integer('pin_version').notNull().default(1),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    viewedAt: timestamp('viewed_at', { withTimezone: true, mode: 'date' }),
    respondedAt: timestamp('responded_at', { withTimezone: true, mode: 'date' }),
    reopened: boolean('reopened').notNull().default(false),
  },
  (t) => [
    uniqueIndex('party_rsvp_org_party_key').on(t.orgId, t.partyId),
    index('party_rsvp_org_event_idx').on(t.orgId, t.eventId),
    uniqueIndex('party_rsvp_link_key').on(t.linkId),
    check('party_rsvp_pin_version_check', sql`pin_version >= 1`),
    foreignKey({
      name: 'party_rsvp_party_fk',
      columns: [t.orgId, t.partyId],
      foreignColumns: [parties.orgId, parties.id],
    }).onDelete('cascade'),
  ],
);

/* -------------------------------------------------------------- M4.1e: the event's menu ---- */

/**
 * The event's menu (M4.1e): what an RSVP meal question offers, with dietary notes ("Vegetarian,
 * contains nuts"), in the host's order. A guest's choice is written to `guests.meal` as the
 * option's label, so a rename renames it on every guest who chose it; an option someone chose
 * can't be removed. Labels are unique per event (case-insensitive). `(org_id, event_id)` references
 * `events.events` through a hand-written foreign key (cascade).
 */
export const menuOptions = tenantTable(
  guestsSchema,
  'menu_options',
  {
    eventId: uuid('event_id').notNull(),
    label: text('label').notNull(),
    notes: text('notes'),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    index('menu_options_org_event_idx').on(t.orgId, t.eventId, t.position),
    uniqueIndex('menu_options_org_event_label_key').on(t.orgId, t.eventId, sql`lower(${t.label})`),
    check('menu_options_label_length', sql`length(label) between 1 and 80`),
    check('menu_options_notes_length', sql`notes is null or length(notes) between 1 and 200`),
    check('menu_options_position_check', sql`position >= 0`),
  ],
);

/* ------------------------------------------- M4.1f: invitations and the contact collector ---- */

/**
 * The public contact collector of an event (M4.1f): a shareable link (`/collect/{code}`, also a
 * QR code) where guests leave their household's names, postal address, email and phone. The code
 * is unique across the platform so the address alone finds the event (a SECURITY DEFINER function
 * resolves it while the collector is on, ids only).
 */
export const collectorSettings = tenantTable(
  guestsSchema,
  'collector_settings',
  {
    eventId: uuid('event_id').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    code: text('code').notNull(),
  },
  (t) => [
    uniqueIndex('collector_settings_org_event_key').on(t.orgId, t.eventId),
    uniqueIndex('collector_settings_code_key').on(t.code),
    // Generated codes are 8 characters (`LOOKUP_ALPHABET`); the canary seeds `CANARY_<nn>_<row>`.
    check('collector_settings_code_check', sql`code ~ '^[0-9A-Z_]{8,40}$'`),
  ],
);

/** pending → approved (a new party) | merged (into an existing party) | rejected. */
export const COLLECTOR_STATUSES = ['pending', 'approved', 'merged', 'rejected'] as const;
export type CollectorStatus = (typeof COLLECTOR_STATUSES)[number];

/**
 * One collector submission waiting for the host (M4.1f). Everything the guest typed is sealed
 * in `payload_ciphertext` (names, address, email, phone: P4-3) and nothing reaches the guest list
 * until the host approves it into a new party or merges it into an existing one; the payload is
 * cleared once the host decides (the data then lives on the party, or nowhere).
 */
export const collectorSubmissions = tenantTable(
  guestsSchema,
  'collector_submissions',
  {
    eventId: uuid('event_id').notNull(),
    status: text('status').notNull().default('pending'),
    /** Sealed JSON `CollectorPayload` (key vault, org-scoped); null once decided. */
    payloadCiphertext: text('payload_ciphertext'),
    /** The language the guest used (their invitations' default). */
    locale: text('locale').notNull().default('en'),
    /** The party it became part of (approved or merged). */
    partyId: uuid('party_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
    decidedBy: uuid('decided_by'),
  },
  (t) => [
    index('collector_submissions_org_event_idx').on(t.orgId, t.eventId, t.status, t.createdAt),
    check('collector_submissions_status_check', inList('status', COLLECTOR_STATUSES)),
    check('collector_submissions_locale_check', sql`locale ~ '^[a-z]{2}(-[A-Z]{2})?$'`),
    check(
      'collector_submissions_decided_check',
      sql`(status = 'pending') = (decided_at is null) and (status = 'pending' or payload_ciphertext is null)`,
    ),
  ],
);

/** How an invitation reaches a party. */
export const INVITE_CHANNELS = ['email', 'sms'] as const;
export type InviteChannel = (typeof INVITE_CHANNELS)[number];

/**
 * An event's invitation wording in one language (M4.1f): the email's subject and message and the
 * text message. Without a row the built-in wording of that language is used.
 */
export const invitationTemplates = tenantTable(
  guestsSchema,
  'invitation_templates',
  {
    eventId: uuid('event_id').notNull(),
    locale: text('locale').notNull(),
    subject: text('subject').notNull(),
    message: text('message').notNull(),
    smsText: text('sms_text').notNull(),
  },
  (t) => [
    uniqueIndex('invitation_templates_org_event_locale_key').on(t.orgId, t.eventId, t.locale),
    check('invitation_templates_locale_check', sql`locale ~ '^[a-z]{2}(-[A-Z]{2})?$'`),
    check('invitation_templates_subject_length', sql`length(subject) between 1 and 150`),
    check('invitation_templates_message_length', sql`length(message) between 1 and 2000`),
    check('invitation_templates_sms_length', sql`length(sms_text) between 1 and 320`),
  ],
);

/** A party's invitation preferences (M4.1f): the language its invitations and reminders use. */
export const partyInvites = tenantTable(
  guestsSchema,
  'party_invites',
  {
    eventId: uuid('event_id').notNull(),
    partyId: uuid('party_id').notNull(),
    locale: text('locale').notNull().default('en'),
  },
  (t) => [
    uniqueIndex('party_invites_org_party_key').on(t.orgId, t.partyId),
    index('party_invites_org_event_idx').on(t.orgId, t.eventId),
    check('party_invites_locale_check', sql`locale ~ '^[a-z]{2}(-[A-Z]{2})?$'`),
    foreignKey({
      name: 'party_invites_party_fk',
      columns: [t.orgId, t.partyId],
      foreignColumns: [parties.orgId, parties.id],
    }).onDelete('cascade'),
  ],
);

/** What a message to a party was: the invitation, a deadline reminder, or the host's test. */
export const INVITE_MESSAGE_KINDS = ['invitation', 'reminder', 'test'] as const;
export type InviteMessageKind = (typeof INVITE_MESSAGE_KINDS)[number];

/**
 * Every invitation, reminder and test message queued for a party (M4.1f): the channel and the
 * notifications dedupe key. Its delivery state (sent, delivered, bounced, failed) is read from
 * the notifications module by that key, so a bounce shows on the party. Test sends have no party.
 * No address is stored here (it stays sealed on the guest).
 */
export const inviteMessages = tenantTable(
  guestsSchema,
  'invite_messages',
  {
    eventId: uuid('event_id').notNull(),
    partyId: uuid('party_id'),
    kind: text('kind').notNull(),
    channel: text('channel').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    locale: text('locale').notNull(),
    sentBy: uuid('sent_by'),
  },
  (t) => [
    uniqueIndex('invite_messages_org_channel_key').on(t.orgId, t.channel, t.dedupeKey),
    index('invite_messages_org_party_idx').on(t.orgId, t.partyId, t.createdAt),
    index('invite_messages_org_event_idx').on(t.orgId, t.eventId, t.createdAt),
    check('invite_messages_kind_check', inList('kind', INVITE_MESSAGE_KINDS)),
    check('invite_messages_channel_check', inList('channel', INVITE_CHANNELS)),
    check('invite_messages_party_check', sql`(kind = 'test') = (party_id is null)`),
    check('invite_messages_key_length', sql`length(dedupe_key) between 1 and 255`),
    foreignKey({
      name: 'invite_messages_party_fk',
      columns: [t.orgId, t.partyId],
      foreignColumns: [parties.orgId, parties.id],
    }).onDelete('cascade'),
  ],
);
