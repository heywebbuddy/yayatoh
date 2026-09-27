import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
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

export const ticketingSchema = pgSchema('ticketing');

export interface AccessDate {
  readonly date: string;
  readonly name: string;
}

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
    /** Early-bird: this face price applies until `early_ends_at` (legacy `sale_price`). */
    earlyPriceMinor: bigint('early_price_minor', { mode: 'number' }),
    earlyEndsAt: ts('early_ends_at'),
    /** Choose-your-amount: `price_minor` is the minimum the buyer may give (legacy `is_donation`). */
    isDonation: boolean('is_donation').notNull().default(false),
    /** Days a multi-day pass admits, e.g. [{date: '2027-10-14', name: 'Gala Night'}] (legacy `access_dates`). */
    accessDates: jsonb('access_dates').$type<AccessDate[]>().notNull().default(sql`'[]'::jsonb`),
    /** Multi-date events (M1.4b): the occurrences this type sells for; empty = every date. */
    occurrenceIds: uuid('occurrence_ids').array().notNull().default(sql`'{}'::uuid[]`),
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
    check(
      'ticket_types_early_check',
      sql`(early_price_minor is null) = (early_ends_at is null) and (early_price_minor is null or (early_price_minor >= 0 and early_price_minor < price_minor))`,
    ),
    check('ticket_types_donation_check', sql`not is_donation or early_price_minor is null`),
    check('ticket_types_access_dates_check', sql`jsonb_typeof(access_dates) = 'array'`),
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
    /** Seated events: the seat, as printed ("Row A · 5"). */
    seatLabel: text('seat_label'),
    /** Multi-date events (M1.4b): the date this ticket admits (`events.occurrences`, hand-written FK). */
    occurrenceId: uuid('occurrence_id'),
  },
  (t) => [
    uniqueIndex('tickets_org_event_serial_key').on(t.orgId, t.eventId, t.serial),
    uniqueIndex('tickets_org_short_code_key').on(t.orgId, t.shortCode),
    index('tickets_org_order_idx').on(t.orgId, t.orderId),
    index('tickets_org_event_updated_idx').on(t.orgId, t.eventId, t.updatedAt, t.id),
    index('tickets_org_occurrence_idx').on(t.orgId, t.occurrenceId).where(sql`occurrence_id is not null`),
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

export const PROMO_KINDS = ['percent', 'amount'] as const;

/**
 * Event promo codes: a percentage (basis points) or a fixed amount off each ticket's face price,
 * before fees. Uses are claimed with a conditional UPDATE, so `max_redemptions` is never exceeded.
 */
export const promoCodes = tenantTable(
  ticketingSchema,
  'promo_codes',
  {
    eventId: uuid('event_id').notNull(),
    code: text('code').notNull(),
    kind: text('kind').notNull(),
    percentBps: integer('percent_bps'),
    amountMinor: bigint('amount_minor', { mode: 'number' }),
    currency: text('currency').notNull(),
    /** Empty = every ticket type of the event. */
    ticketTypeIds: uuid('ticket_type_ids').array().notNull().default(sql`'{}'::uuid[]`),
    maxRedemptions: integer('max_redemptions'),
    redeemedCount: integer('redeemed_count').notNull().default(0),
    startsAt: ts('starts_at'),
    endsAt: ts('ends_at'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('promo_codes_org_event_code_key').on(t.orgId, t.eventId, t.code),
    check('promo_codes_code_check', sql`code ~ '^[A-Z0-9_-]{3,32}$'`),
    check('promo_codes_kind_check', sql`kind in ('percent', 'amount')`),
    check(
      'promo_codes_value_check',
      sql`(kind = 'percent' and percent_bps between 1 and 10000 and amount_minor is null) or (kind = 'amount' and amount_minor > 0 and percent_bps is null)`,
    ),
    check(
      'promo_codes_redemptions_check',
      sql`redeemed_count >= 0 and (max_redemptions is null or (max_redemptions >= 1 and redeemed_count <= max_redemptions))`,
    ),
    check('promo_codes_window_check', sql`ends_at is null or starts_at is null or ends_at > starts_at`),
    check('promo_codes_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
  ],
);

/**
 * Distribution (roadmap M1.8): a claim link hands one ticket to whoever opens it and enters
 * their name and email. Claiming reissues the ticket (rev + 1), so the old QR stops working.
 * The link token is `<id>~hmac`; at most one open link per ticket.
 */
export const ticketClaims = tenantTable(
  ticketingSchema,
  'ticket_claims',
  {
    ticketId: uuid('ticket_id').notNull(),
    recipientEmail: text('recipient_email'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'date' }),
    claimedByEmail: text('claimed_by_email'),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdBy: text('created_by').notNull(),
  },
  (t) => [
    uniqueIndex('ticket_claims_org_ticket_open_key')
      .on(t.orgId, t.ticketId)
      .where(sql`claimed_at is null and revoked_at is null`),
    foreignKey({
      name: 'ticket_claims_ticket_fk',
      columns: [t.orgId, t.ticketId],
      foreignColumns: [tickets.orgId, tickets.id],
    }),
  ],
);

/**
 * Magic links for ticket holders (self-service): one event, one normalized email, valid for
 * 7 days. The page lists that email's active tickets at the event.
 */
export const holderLinks = tenantTable(
  ticketingSchema,
  'holder_links',
  {
    eventId: uuid('event_id').notNull(),
    emailNorm: text('email_norm').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [index('holder_links_org_email_idx').on(t.orgId, t.emailNorm, t.createdAt)],
);
