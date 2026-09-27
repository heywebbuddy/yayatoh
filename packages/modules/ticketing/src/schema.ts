import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const ticketingSchema = pgSchema('ticketing');

export const TICKET_TYPE_VISIBILITIES = ['public', 'hidden'] as const;
export const FEE_MODES = ['pass_on', 'absorb'] as const;

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const ticketTypes = tenantTable(
  ticketingSchema,
  'ticket_types',
  {
    eventId: uuid('event_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    priceMinor: bigint('price_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    feeMode: text('fee_mode').notNull().default('pass_on'),
    quantityTotal: integer('quantity_total').notNull(),
    quantitySold: integer('quantity_sold').notNull().default(0),
    quantityHeld: integer('quantity_held').notNull().default(0),
    minPerOrder: integer('min_per_order').notNull().default(1),
    maxPerOrder: integer('max_per_order').notNull().default(10),
    salesStartAt: ts('sales_start_at'),
    salesEndAt: ts('sales_end_at'),
    visibility: text('visibility').notNull().default('public'),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: ts('archived_at'),
  },
  (t) => [
    index('ticket_types_org_event_idx').on(t.orgId, t.eventId, t.sortOrder),
    check(
      'ticket_types_inventory_check',
      sql`quantity_sold >= 0 and quantity_held >= 0 and quantity_sold + quantity_held <= quantity_total`,
    ),
    check('ticket_types_price_check', sql`price_minor >= 0`),
    check('ticket_types_per_order_check', sql`min_per_order >= 1 and max_per_order >= min_per_order`),
    check(
      'ticket_types_window_check',
      sql`sales_end_at is null or sales_start_at is null or sales_end_at > sales_start_at`,
    ),
    check('ticket_types_visibility_check', sql`visibility in ('public', 'hidden')`),
    check('ticket_types_fee_mode_check', sql`fee_mode in ('pass_on', 'absorb')`),
    check('ticket_types_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
  ],
);
