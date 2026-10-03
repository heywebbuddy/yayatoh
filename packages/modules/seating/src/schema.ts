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
import { CHANNEL_KINDS, CODE_CHANNEL_KINDS } from './domain/channels.ts';
import { SEAT_STATUSES } from './domain/seat-state.ts';

export const seatingSchema = pgSchema('seating');

export const EVENT_LAYOUT_STATUSES = ['draft', 'published', 'locked'] as const;
/**
 * How guests look themselves up in the public seat finder (M1.7e): `code` = a one-time code
 * emailed to an address on the list (no enumeration); `name` = instant, by exact full name.
 */
export const FINDER_MODES = ['code', 'name'] as const;
/** Reasons an organizer blocks seats by hand. */
export const BLOCK_REASONS = ['channel', 'ada', 'kill'] as const;
/**
 * Every block reason a seat can carry: `assigned` = a guest was given this seat (M1.7d); `group` =
 * kept back for a group (an attendee label, e.g. a company) whose name is in `group_label` (M1.8f).
 */
export const SEAT_BLOCK_REASONS = [...BLOCK_REASONS, 'assigned', 'group'] as const;
/** Blocks a seat assignment may take over (and gives back when the guest is unseated). */
export const ASSIGNABLE_BLOCKS = ['channel', 'ada', 'group'] as const;
/** A group's name is an attendee label: 1–40 characters. */
export const MAX_GROUP_LABEL = 40;
/**
 * Seating rules (M1.7f): `ada_reserved` keeps accessible seats back until some days before the
 * event; `max_per_order_seats` caps the seats in one order. M6.11a: `ada_companion` sells
 * companion seats only with an accessible seat.
 */
export const SEATING_RULE_KINDS = ['ada_reserved', 'max_per_order_seats', 'ada_companion'] as const;
/** Decision D18: rules warn by default; `enforce` refuses (staff may override, audited). */
export const RULE_SEVERITIES = ['warn', 'enforce'] as const;

/** Reusable floor plans (the venue's rooms), per org. */
export const layouts = tenantTable(
  seatingSchema,
  'layouts',
  {
    name: text('name').notNull(),
    doc: jsonb('doc').notNull(),
    checksum: text('checksum').notNull(),
    seatCount: integer('seat_count').notNull(),
  },
  (t) => [
    index('layouts_org_name_idx').on(t.orgId, t.name),
    check('layouts_name_length', sql`length(name) between 1 and 120`),
  ],
);

/**
 * The event's own copy of a floor plan; seats are materialized from it. A multi-date event has one
 * plan for all dates (`occurrence_id` null, the default) and may give a date its own copy
 * (`occurrence_id` = that date, M1.7g): a chart. Each chart has its own seats, holds and sales.
 * `(org_id, occurrence_id)` references `events.occurrences` through a hand-written FK.
 */
export const eventLayouts = tenantTable(
  seatingSchema,
  'event_layouts',
  {
    eventId: uuid('event_id').notNull(),
    /** The date this chart is for; null = the event plan (every date without its own chart). */
    occurrenceId: uuid('occurrence_id'),
    sourceLayoutId: uuid('source_layout_id'),
    doc: jsonb('doc').notNull(),
    checksum: text('checksum').notNull(),
    seatCount: integer('seat_count').notNull(),
    status: text('status').notNull().default('draft'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    /** The organizer shows guests the venue map and the seat finder (M1.7e). */
    publicMap: boolean('public_map').notNull().default(false),
    finderMode: text('finder_mode').notNull().default('code'),
  },
  (t) => [
    uniqueIndex('event_layouts_org_event_plan_key').on(t.orgId, t.eventId).where(sql`occurrence_id is null`),
    uniqueIndex('event_layouts_org_event_date_key')
      .on(t.orgId, t.eventId, t.occurrenceId)
      .where(sql`occurrence_id is not null`),
    check(
      'event_layouts_status_check',
      sql.raw(`status in (${EVENT_LAYOUT_STATUSES.map((s) => `'${s}'`).join(', ')})`),
    ),
    check(
      'event_layouts_finder_mode_check',
      sql.raw(`finder_mode in (${FINDER_MODES.map((s) => `'${s}'`).join(', ')})`),
    ),
  ],
);

/** Per-event seat state (ADR 0012). Holds live here, in Postgres. */
export const eventSeats = tenantTable(
  seatingSchema,
  'event_seats',
  {
    eventId: uuid('event_id').notNull(),
    /** The chart (M1.7g): null = the event plan, else the date with its own copy of the plan. */
    occurrenceId: uuid('occurrence_id'),
    seatUuid: uuid('seat_uuid').notNull(),
    label: text('label').notNull(),
    itemId: uuid('item_id').notNull(),
    sectionId: uuid('section_id'),
    /** The ticket type (price category) this seat sells as; null = not on sale yet. */
    ticketTypeId: uuid('ticket_type_id'),
    accessible: boolean('accessible').notNull().default(false),
    status: text('status').notNull().default('available'),
    holdId: uuid('hold_id'),
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
    ticketId: uuid('ticket_id'),
    blockReason: text('block_reason'),
    /**
     * The group this seat is kept for (M1.8f): set while it is blocked for the group, and kept
     * while a member sits in it, so unseating them gives the seat back to their group.
     */
    groupLabel: text('group_label'),
    /**
     * The date a held or sold seat of the event plan is for (M1.7g): a date may get its own chart
     * only while no seat of the plan is held or sold for it (or for an unknown date).
     */
    heldForOccurrenceId: uuid('held_for_occurrence_id'),
  },
  (t) => [
    uniqueIndex('event_seats_org_event_plan_seat_key')
      .on(t.orgId, t.eventId, t.seatUuid)
      .where(sql`occurrence_id is null`),
    uniqueIndex('event_seats_org_event_date_seat_key')
      .on(t.orgId, t.eventId, t.occurrenceId, t.seatUuid)
      .where(sql`occurrence_id is not null`),
    index('event_seats_org_held_for_idx')
      .on(t.orgId, t.eventId, t.heldForOccurrenceId)
      .where(sql`held_for_occurrence_id is not null`),
    index('event_seats_org_event_status_idx').on(t.orgId, t.eventId, t.status),
    index('event_seats_org_event_group_idx')
      .on(t.orgId, t.eventId, t.groupLabel)
      .where(sql`group_label is not null`),
    index('event_seats_org_hold_idx').on(t.orgId, t.holdId),
    check(
      'event_seats_status_check',
      sql.raw(`status in (${SEAT_STATUSES.map((s) => `'${s}'`).join(', ')})`),
    ),
    check(
      'event_seats_block_check',
      sql.raw(
        `(status = 'blocked') = (block_reason is not null) and (block_reason is null or block_reason in (${SEAT_BLOCK_REASONS.map((s) => `'${s}'`).join(', ')}))`,
      ),
    ),
    check(
      'event_seats_hold_check',
      sql`(status = 'held') = (hold_id is not null and hold_expires_at is not null)`,
    ),
    check('event_seats_sold_check', sql`(status = 'sold') = (ticket_id is not null)`),
    check(
      'event_seats_held_for_check',
      sql`held_for_occurrence_id is null or (occurrence_id is null and status in ('held', 'sold'))`,
    ),
    check(
      'event_seats_group_check',
      sql`(block_reason is distinct from 'group' or group_label is not null) and (group_label is null or length(group_label) between 1 and 40)`,
    ),
  ],
);

/**
 * Organizer seat assignment (M1.7d): an attendee sits in one seat of a table or row. Every
 * assignment holds a real seat, blocked with reason `assigned`, so a sale can never take it.
 * `pinned` = the organizer chose this exact seat (otherwise any free seat at the table was
 * taken and may be moved to make room). `prior_block` is the block the seat had before
 * (a channel or accessibility hold) and gets back when the guest is unseated.
 * `(org_id, attendee_id)` references `attendees.attendees` (a lower tier) through a
 * hand-written migration, so this module never imports attendees' schema.
 */
export const seatAssignments = tenantTable(
  seatingSchema,
  'seat_assignments',
  {
    eventId: uuid('event_id').notNull(),
    /** The chart the seat is on (M1.7g): null = the event plan, else a date's own chart. */
    occurrenceId: uuid('occurrence_id'),
    attendeeId: uuid('attendee_id').notNull(),
    itemId: uuid('item_id').notNull(),
    seatUuid: uuid('seat_uuid').notNull(),
    pinned: boolean('pinned').notNull().default(false),
    priorBlock: text('prior_block'),
  },
  (t) => [
    uniqueIndex('seat_assignments_org_event_plan_attendee_key')
      .on(t.orgId, t.eventId, t.attendeeId)
      .where(sql`occurrence_id is null`),
    uniqueIndex('seat_assignments_org_event_date_attendee_key')
      .on(t.orgId, t.eventId, t.occurrenceId, t.attendeeId)
      .where(sql`occurrence_id is not null`),
    uniqueIndex('seat_assignments_org_event_plan_seat_key')
      .on(t.orgId, t.eventId, t.seatUuid)
      .where(sql`occurrence_id is null`),
    uniqueIndex('seat_assignments_org_event_date_seat_key')
      .on(t.orgId, t.eventId, t.occurrenceId, t.seatUuid)
      .where(sql`occurrence_id is not null`),
    index('seat_assignments_org_event_item_idx').on(t.orgId, t.eventId, t.itemId),
    index('seat_assignments_org_attendee_idx').on(t.orgId, t.attendeeId),
    check(
      'seat_assignments_prior_block_check',
      sql.raw(`prior_block is null or prior_block in (${ASSIGNABLE_BLOCKS.map((s) => `'${s}'`).join(', ')})`),
    ),
  ],
);

/**
 * Seat finder one-time codes (M1.7e). A row is written for every lookup, whether or not the email
 * is on the list, so the answer and the work done never reveal who is invited. `email` is kept
 * only for addresses on the list (the mailer needs it); `email_hash` (HMAC) counts codes per
 * address. The code itself is never stored: it is derived from the row id under the app secret
 * for the email, and only its HMAC (`code_hash`) is kept. Five wrong tries lock a code; a code
 * works once and for ten minutes.
 */
export const finderCodes = tenantTable(
  seatingSchema,
  'finder_codes',
  {
    eventId: uuid('event_id').notNull(),
    emailHash: text('email_hash').notNull(),
    email: text('email'),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [
    index('finder_codes_org_event_email_idx').on(t.orgId, t.eventId, t.emailHash, t.createdAt),
    index('finder_codes_org_expires_idx').on(t.orgId, t.expiresAt),
    check('finder_codes_attempts_check', sql`attempts between 0 and 5`),
  ],
);

/**
 * An event's seating rules (M1.7f): at most one of each kind, with its parameters and whether it
 * warns (the default, decision D18) or is enforced. Checkout, the box office and the organizer's
 * assign view evaluate them (`evaluateSeatRules`).
 */
export const seatingRules = tenantTable(
  seatingSchema,
  'seating_rules',
  {
    eventId: uuid('event_id').notNull(),
    kind: text('kind').notNull(),
    severity: text('severity').notNull().default('warn'),
    params: jsonb('params').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    uniqueIndex('seating_rules_org_event_kind_key').on(t.orgId, t.eventId, t.kind),
    check(
      'seating_rules_kind_check',
      sql.raw(`kind in (${SEATING_RULE_KINDS.map((s) => `'${s}'`).join(', ')})`),
    ),
    check(
      'seating_rules_severity_check',
      sql.raw(`severity in (${RULE_SEVERITIES.map((s) => `'${s}'`).join(', ')})`),
    ),
    check('seating_rules_params_check', sql`jsonb_typeof(params) = 'object'`),
  ],
);

/**
 * A sub-event's own chart (M4.1c): a wedding's ceremony in rows and its reception at tables, on
 * the same day, need different drawings. A sub-event without one uses the chart of its date
 * (M1.7g), then the event plan (`resolveSubEventChartTx`). A drawing only for now: guests are
 * seated on it with M4.3a; nothing is ever sold on it. `(org_id, event_id, sub_event_id)`
 * references `guests.sub_events` through a hand-written foreign key (same event; the chart goes
 * with its sub-event), so this module never imports guests' schema.
 */
export const subEventCharts = tenantTable(
  seatingSchema,
  'sub_event_charts',
  {
    eventId: uuid('event_id').notNull(),
    subEventId: uuid('sub_event_id').notNull(),
    /** The library layout it was copied from, when it was (else a copy of the fallback chart). */
    sourceLayoutId: uuid('source_layout_id'),
    doc: jsonb('doc').notNull(),
    checksum: text('checksum').notNull(),
    seatCount: integer('seat_count').notNull(),
  },
  (t) => [
    uniqueIndex('sub_event_charts_org_sub_event_key').on(t.orgId, t.subEventId),
    index('sub_event_charts_org_event_idx').on(t.orgId, t.eventId),
  ],
);

/** M4.2b: longest sponsor name on a hosted table. */
export const MAX_SPONSOR_NAME = 80;

/**
 * Hosted tables (M4.2b gala tables and sponsors): a table of the event's plan (`item_id`, a table
 * item of the plan document; per-date copies keep the ids, so one row covers every chart) carries
 * a sponsor name and an optional logo (an image of the org's own media, `/media/{org}/…`). The
 * editor always shows it; guests see it in the seat finder only once `published` and while the
 * plan's map is public (`publicTableSponsors`).
 */
export const tableSponsors = tenantTable(
  seatingSchema,
  'table_sponsors',
  {
    eventId: uuid('event_id').notNull(),
    itemId: uuid('item_id').notNull(),
    sponsorName: text('sponsor_name').notNull(),
    logoUrl: text('logo_url'),
    published: boolean('published').notNull().default(false),
  },
  (t) => [
    uniqueIndex('table_sponsors_org_event_item_key').on(t.orgId, t.eventId, t.itemId),
    check('table_sponsors_name_length', sql`length(sponsor_name) between 1 and 80`),
    check(
      'table_sponsors_logo_check',
      sql`logo_url is null or (length(logo_url) <= 300 and logo_url ~ '^/media/[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$')`,
    ),
  ],
);
/**
 * Best available (M6.11a): whether buyers and the box office may ask for "best available"
 * instead of choosing seats, and the organizer's section scores (`{ sectionId: 0–100 }`, higher
 * is better; sections without a score rank by distance to the stage). One row per event; every
 * chart of the event uses it (seat and section ids repeat across charts).
 */
export const selectionSettings = tenantTable(
  seatingSchema,
  'selection_settings',
  {
    eventId: uuid('event_id').notNull(),
    bestAvailable: boolean('best_available').notNull().default(false),
    sectionScores: jsonb('section_scores').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    uniqueIndex('selection_settings_org_event_key').on(t.orgId, t.eventId),
    check('selection_settings_scores_check', sql`jsonb_typeof(section_scores) = 'object'`),
  ],
);

/**
 * Companion seats (M6.11a): seats the organizer keeps next to accessible seats for the people
 * who come with a wheelchair user. With the `ada_companion` rule they are sold only with an
 * accessible seat. Per event (seat ids repeat across an event's charts, so a date's own chart
 * keeps them).
 */
export const companionSeats = tenantTable(
  seatingSchema,
  'companion_seats',
  {
    eventId: uuid('event_id').notNull(),
    seatUuid: uuid('seat_uuid').notNull(),
  },
  (t) => [uniqueIndex('companion_seats_org_event_seat_key').on(t.orgId, t.eventId, t.seatUuid)],
);

// ─── M6.11b: sales channels and allotments, layout revisions ────────────────────────────────

/**
 * Sales channels (M6.11b). `public` = online without a code; `box_office` = staff at the box
 * office; `sponsor` and `promoter` = online with the channel's code (a promoter's link carries
 * it). At most one `public` and one `box_office` channel per event.
 */
export { CHANNEL_KINDS, CODE_CHANNEL_KINDS };
/** A channel code: 3–32 letters, digits, dashes or underscores, kept upper-case. */
export const CHANNEL_CODE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

/**
 * An event's sales channel (M6.11b): seats allotted to it (`channel_seats`) are sold only through
 * it until `release_at`, when unsold ones go back to every channel. Per event: every chart of the
 * event uses the same allotments (seat ids repeat across charts).
 */
export const seatChannels = tenantTable(
  seatingSchema,
  'seat_channels',
  {
    eventId: uuid('event_id').notNull(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    /** Upper-case; required for sponsor and promoter channels, none for the others. */
    code: text('code'),
    /** When unsold allotted seats go back to every channel; null = never. */
    releaseAt: timestamp('release_at', { withTimezone: true }),
  },
  (t) => [
    index('seat_channels_org_event_idx').on(t.orgId, t.eventId),
    uniqueIndex('seat_channels_org_event_code_key')
      .on(t.orgId, t.eventId, t.code)
      .where(sql`code is not null`),
    uniqueIndex('seat_channels_org_event_kind_key')
      .on(t.orgId, t.eventId, t.kind)
      .where(sql`kind in ('public', 'box_office')`),
    check('seat_channels_kind_check', sql.raw(`kind in (${CHANNEL_KINDS.map((s) => `'${s}'`).join(', ')})`)),
    check('seat_channels_name_length', sql`length(name) between 1 and 80`),
    check(
      'seat_channels_code_check',
      sql`(kind in ('sponsor', 'promoter')) = (code is not null) and (code is null or code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$')`,
    ),
  ],
);

/**
 * Seats allotted to a channel (M6.11b): a seat is in at most one channel per event. Removing the
 * channel removes its allotment (the seats go back to every channel).
 */
export const channelSeats = tenantTable(
  seatingSchema,
  'channel_seats',
  {
    eventId: uuid('event_id').notNull(),
    channelId: uuid('channel_id').notNull(),
    seatUuid: uuid('seat_uuid').notNull(),
  },
  (t) => [
    uniqueIndex('channel_seats_org_event_seat_key').on(t.orgId, t.eventId, t.seatUuid),
    index('channel_seats_org_channel_idx').on(t.orgId, t.channelId),
    foreignKey({
      name: 'channel_seats_channel_fk',
      columns: [t.orgId, t.channelId],
      foreignColumns: [seatChannels.orgId, seatChannels.id],
    }).onDelete('cascade'),
  ],
);

/**
 * The channel an order's seats were sold through (M6.11b): attribution for the channel's
 * report, and the channel a paid-late order re-holds its seats through. `order_id` is the
 * order's id (the seat hold's id); orders is a higher tier, so there is no FK to it.
 */
export const channelOrders = tenantTable(
  seatingSchema,
  'channel_orders',
  {
    eventId: uuid('event_id').notNull(),
    channelId: uuid('channel_id').notNull(),
    orderId: uuid('order_id').notNull(),
    seats: integer('seats').notNull(),
    /** When the order's seats were sold (its payment); null while it is only reserved. */
    soldAt: timestamp('sold_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('channel_orders_org_order_key').on(t.orgId, t.orderId),
    index('channel_orders_org_channel_idx').on(t.orgId, t.channelId),
    check('channel_orders_seats_check', sql`seats between 1 and 500`),
    foreignKey({
      name: 'channel_orders_channel_fk',
      columns: [t.orgId, t.channelId],
      foreignColumns: [seatChannels.orgId, seatChannels.id],
    }).onDelete('cascade'),
  ],
);

/** Why a revision was written: an edit of the plan, or a restore of an earlier revision. */
export const REVISION_KINDS = ['save', 'restore'] as const;

/**
 * Layout revisions (M6.11b): every save of a chart's plan (and every restore) is a numbered
 * revision of that chart, with the whole document. The newest 100 per chart are kept.
 */
export const layoutRevisions = tenantTable(
  seatingSchema,
  'layout_revisions',
  {
    eventId: uuid('event_id').notNull(),
    /** The chart (M1.7g): null = the event plan, else the date with its own chart. */
    occurrenceId: uuid('occurrence_id'),
    number: integer('number').notNull(),
    kind: text('kind').notNull().default('save'),
    /** For a restore: the revision it brought back. */
    restoredFrom: integer('restored_from'),
    doc: jsonb('doc').notNull(),
    checksum: text('checksum').notNull(),
    seatCount: integer('seat_count').notNull(),
    /** Who saved it (a member's user id; null for the system). */
    actorId: uuid('actor_id'),
  },
  (t) => [
    uniqueIndex('layout_revisions_org_event_plan_number_key')
      .on(t.orgId, t.eventId, t.number)
      .where(sql`occurrence_id is null`),
    uniqueIndex('layout_revisions_org_event_date_number_key')
      .on(t.orgId, t.eventId, t.occurrenceId, t.number)
      .where(sql`occurrence_id is not null`),
    check(
      'layout_revisions_kind_check',
      sql.raw(`kind in (${REVISION_KINDS.map((s) => `'${s}'`).join(', ')})`),
    ),
    check('layout_revisions_number_check', sql`number >= 1`),
    check('layout_revisions_restore_check', sql`(kind = 'restore') = (restored_from is not null)`),
  ],
);
