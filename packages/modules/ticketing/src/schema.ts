import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
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

/** Per-org Ed25519 signing keys for yy1 ticket codes (ADR 0011). Private keys are envelope-encrypted. */
export const signingKeys = tenantTable(
  ticketingSchema,
  'signing_keys',
  {
    kid: integer('kid').notNull(),
    publicKey: text('public_key').notNull(),
    privateKeyCiphertext: text('private_key_ciphertext').notNull(),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('signing_keys_org_kid_key').on(t.orgId, t.kid),
    check('signing_keys_kid_check', sql`kid between 1 and 65535`),
  ],
);

export const TICKET_STATUSES = ['active', 'void'] as const;

export const tickets = tenantTable(
  ticketingSchema,
  'tickets',
  {
    eventId: uuid('event_id').notNull(),
    ticketTypeId: uuid('ticket_type_id').notNull(),
    orderId: uuid('order_id').notNull(),
    orderItemId: uuid('order_item_id').notNull(),
    serial: integer('serial').notNull(),
    shortCode: text('short_code').notNull(),
    status: text('status').notNull().default('active'),
    voidReason: text('void_reason'),
    rev: integer('rev').notNull().default(0),
    holderName: text('holder_name').notNull(),
    holderEmail: text('holder_email').notNull(),
    attendeeId: uuid('attendee_id'),
  },
  (t) => [
    uniqueIndex('tickets_org_event_serial_key').on(t.orgId, t.eventId, t.serial),
    uniqueIndex('tickets_org_short_code_key').on(t.orgId, t.shortCode),
    index('tickets_org_order_idx').on(t.orgId, t.orderId),
    foreignKey({
      name: 'tickets_ticket_type_fk',
      columns: [t.orgId, t.ticketTypeId],
      foreignColumns: [ticketTypes.orgId, ticketTypes.id],
    }),
    check('tickets_status_check', sql`status in ('active', 'void')`),
    check('tickets_rev_check', sql`rev between 0 and 65535`),
  ],
);

/** Scannable payloads. yy1 codes are issued here; migrated legacy payloads are stored, never regenerated. */
export const ticketBarcodes = tenantTable(
  ticketingSchema,
  'ticket_barcodes',
  {
    ticketId: uuid('ticket_id').notNull(),
    format: text('format').notNull(),
    instance: text('instance'),
    payload: text('payload').notNull(),
    rev: integer('rev').notNull(),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('ticket_barcodes_org_payload_key').on(t.orgId, t.payload),
    index('ticket_barcodes_org_ticket_idx').on(t.orgId, t.ticketId),
    foreignKey({
      name: 'ticket_barcodes_ticket_fk',
      columns: [t.orgId, t.ticketId],
      foreignColumns: [tickets.orgId, tickets.id],
    }).onDelete('cascade'),
    check('ticket_barcodes_format_check', sql`format in ('yy1', 'legacy_eventmie')`),
  ],
);
