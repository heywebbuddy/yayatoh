import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
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
 * event; `max_per_order_seats` caps the seats in one order.
 */
export const SEATING_RULE_KINDS = ['ada_reserved', 'max_per_order_seats'] as const;
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

/** The event's own copy of a floor plan; seats are materialized from it. */
export const eventLayouts = tenantTable(
  seatingSchema,
  'event_layouts',
  {
    eventId: uuid('event_id').notNull(),
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
    uniqueIndex('event_layouts_org_event_key').on(t.orgId, t.eventId),
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
  },
  (t) => [
    uniqueIndex('event_seats_org_event_seat_key').on(t.orgId, t.eventId, t.seatUuid),
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
    attendeeId: uuid('attendee_id').notNull(),
    itemId: uuid('item_id').notNull(),
    seatUuid: uuid('seat_uuid').notNull(),
    pinned: boolean('pinned').notNull().default(false),
    priorBlock: text('prior_block'),
  },
  (t) => [
    uniqueIndex('seat_assignments_org_event_attendee_key').on(t.orgId, t.eventId, t.attendeeId),
    uniqueIndex('seat_assignments_org_event_seat_key').on(t.orgId, t.eventId, t.seatUuid),
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
