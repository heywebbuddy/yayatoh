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
export const BLOCK_REASONS = ['channel', 'ada', 'kill'] as const;

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
  },
  (t) => [
    uniqueIndex('event_layouts_org_event_key').on(t.orgId, t.eventId),
    check(
      'event_layouts_status_check',
      sql.raw(`status in (${EVENT_LAYOUT_STATUSES.map((s) => `'${s}'`).join(', ')})`),
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
  },
  (t) => [
    uniqueIndex('event_seats_org_event_seat_key').on(t.orgId, t.eventId, t.seatUuid),
    index('event_seats_org_event_status_idx').on(t.orgId, t.eventId, t.status),
    index('event_seats_org_hold_idx').on(t.orgId, t.holdId),
    check(
      'event_seats_status_check',
      sql.raw(`status in (${SEAT_STATUSES.map((s) => `'${s}'`).join(', ')})`),
    ),
    check(
      'event_seats_block_check',
      sql.raw(
        `(status = 'blocked') = (block_reason is not null) and (block_reason is null or block_reason in (${BLOCK_REASONS.map((s) => `'${s}'`).join(', ')}))`,
      ),
    ),
    check(
      'event_seats_hold_check',
      sql`(status = 'held') = (hold_id is not null and hold_expires_at is not null)`,
    ),
    check('event_seats_sold_check', sql`(status = 'sold') = (ticket_id is not null)`),
  ],
);
