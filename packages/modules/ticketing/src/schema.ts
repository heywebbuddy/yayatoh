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
/** Modules that may manage ticket types (M5.1a, ADR 0021). */
export const TICKET_TYPE_MANAGERS = ['registration'] as const;
export type TicketTypeManager = (typeof TICKET_TYPE_MANAGERS)[number];

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
    /** M3.10c transfer rules: may holders pass this ticket on (organizers always may). */
    transfersAllowed: boolean('transfers_allowed').notNull().default(true),
    /** M3.10c: holder transfers close this many hours before the event starts (null: at the start). */
    transferCutoffHours: integer('transfer_cutoff_hours'),
    /** M3.10c: what a holder transfer costs, in minor units of the ticket's currency (0: free). */
    transferFeeMinor: bigint('transfer_fee_minor', { mode: 'number' }).notNull().default(0),
    /**
     * M5.1a (ADR 0021): a ticket type another module sells for itself (a registration type ×
     * admission item cell). Only that module may quote, edit or archive it; null = ordinary pass.
     */
    managedBy: text('managed_by'),
    /**
     * M4.2b gala tables: a table ticket ("Table of 10"). One unit sold = one table of this many
     * seats: `table_size` tickets (guest slots) the buyer names through the table's claim link.
     * Null = an ordinary pass. Inventory, price and per-order limits count tables.
     */
    tableSize: integer('table_size'),
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
    check(
      'ticket_types_transfer_rules_check',
      sql`transfer_fee_minor >= 0 and (transfer_cutoff_hours is null or transfer_cutoff_hours between 0 and 8760)`,
    ),
    check('ticket_types_managed_by_check', sql`managed_by is null or managed_by in ('registration')`),
    check(
      'ticket_types_table_size_check',
      sql`table_size is null or (table_size between 2 and 20 and not is_donation)`,
    ),
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
    /** M4.2b: the purchased table this ticket is a guest slot of (`table_units`, hand-written FK). */
    tableUnitId: uuid('table_unit_id'),
    /**
     * M5.1d: sold on an invoice whose balance is still due. The door and the badge desk admit or
     * print it only with an audited staff override; cleared when the invoice is paid.
     */
    paymentDue: boolean('payment_due').notNull().default(false),
  },
  (t) => [
    uniqueIndex('tickets_org_event_serial_key').on(t.orgId, t.eventId, t.serial),
    uniqueIndex('tickets_org_short_code_key').on(t.orgId, t.shortCode),
    index('tickets_org_order_idx').on(t.orgId, t.orderId),
    index('tickets_org_event_updated_idx').on(t.orgId, t.eventId, t.updatedAt, t.id),
    index('tickets_org_occurrence_idx').on(t.orgId, t.occurrenceId).where(sql`occurrence_id is not null`),
    index('tickets_org_table_unit_idx').on(t.orgId, t.tableUnitId).where(sql`table_unit_id is not null`),
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

export const COUPON_SCOPES = ['all', 'events'] as const;

/**
 * U9 org-wide coupons (UX-5): one code for every event of the org or for chosen events. Same
 * discount kinds as promo codes; an amount coupon carries a currency and applies only to events
 * in that currency. Uses are claimed with a conditional UPDATE (total limit); the per-buyer limit
 * is checked under that row lock against `coupon_redemptions`.
 */
export const coupons = tenantTable(
  ticketingSchema,
  'coupons',
  {
    code: text('code').notNull(),
    kind: text('kind').notNull(),
    percentBps: integer('percent_bps'),
    amountMinor: bigint('amount_minor', { mode: 'number' }),
    /** Amount coupons only (null for percentages). */
    currency: text('currency'),
    scope: text('scope').notNull().default('all'),
    /** `scope = 'events'`: the events it applies to (at least one). */
    eventIds: uuid('event_ids').array().notNull().default(sql`'{}'::uuid[]`),
    maxRedemptions: integer('max_redemptions'),
    perBuyerLimit: integer('per_buyer_limit'),
    redeemedCount: integer('redeemed_count').notNull().default(0),
    startsAt: ts('starts_at'),
    endsAt: ts('ends_at'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('coupons_org_code_key').on(t.orgId, t.code),
    check('coupons_code_check', sql`code ~ '^[A-Z0-9_-]{3,32}$'`),
    check('coupons_kind_check', sql`kind in ('percent', 'amount')`),
    check(
      'coupons_value_check',
      sql`(kind = 'percent' and percent_bps between 1 and 10000 and amount_minor is null and currency is null) or (kind = 'amount' and amount_minor > 0 and percent_bps is null and currency ~ '^[A-Z]{3}$')`,
    ),
    check(
      'coupons_scope_check',
      sql`(scope = 'all' and cardinality(event_ids) = 0) or (scope = 'events' and cardinality(event_ids) >= 1)`,
    ),
    check(
      'coupons_redemptions_check',
      sql`redeemed_count >= 0 and (max_redemptions is null or (max_redemptions >= 1 and redeemed_count <= max_redemptions))`,
    ),
    check('coupons_per_buyer_check', sql`per_buyer_limit is null or per_buyer_limit >= 1`),
    check('coupons_window_check', sql`ends_at is null or starts_at is null or ends_at > starts_at`),
  ],
);

/**
 * One row per order that took a coupon (an order takes at most one code). `released_at` is set
 * when the order lapses or is cancelled unpaid, which gives the use back.
 */
export const couponRedemptions = tenantTable(
  ticketingSchema,
  'coupon_redemptions',
  {
    couponId: uuid('coupon_id').notNull(),
    orderId: uuid('order_id').notNull(),
    eventId: uuid('event_id').notNull(),
    /** The buyer's CRM contact (one per email address): the per-buyer limit counts by it. */
    buyerContactId: uuid('buyer_contact_id').notNull(),
    releasedAt: ts('released_at'),
  },
  (t) => [
    uniqueIndex('coupon_redemptions_org_order_key').on(t.orgId, t.orderId),
    index('coupon_redemptions_org_coupon_buyer_idx').on(t.orgId, t.couponId, t.buyerContactId),
    foreignKey({
      name: 'coupon_redemptions_coupon_fk',
      columns: [t.orgId, t.couponId],
      foreignColumns: [coupons.orgId, coupons.id],
    }).onDelete('cascade'),
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

export const TRANSFER_STATUSES = ['pending', 'claimed', 'cancelled'] as const;
export const TRANSFER_INITIATORS = ['organizer', 'holder'] as const;

/**
 * Ticket transfers with a claim step (M3.10c): the holder or the organizer names the new holder;
 * the ticket stays with the current holder until the recipient opens the claim link (signed,
 * single use, expiring: `ticket_claims`) and confirms. Claiming voids the old code (QR, short code
 * and wallet pass) and reissues the ticket to the recipient; cancelling before that revokes the
 * link. At most one pending transfer per ticket. `fee_minor` is the ticket type's transfer fee at
 * the time (holder transfers only; organizers transfer for free).
 */
export const ticketTransfers = tenantTable(
  ticketingSchema,
  'ticket_transfers',
  {
    ticketId: uuid('ticket_id').notNull(),
    eventId: uuid('event_id').notNull(),
    orderId: uuid('order_id').notNull(),
    claimId: uuid('claim_id').notNull(),
    status: text('status').notNull().default('pending'),
    initiatedBy: text('initiated_by').notNull(),
    fromName: text('from_name').notNull(),
    fromEmail: text('from_email').notNull(),
    toName: text('to_name').notNull(),
    toEmail: text('to_email').notNull(),
    feeMinor: bigint('fee_minor', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull(),
    createdBy: text('created_by').notNull(),
    /** The ticket's code revision before and after the claim. */
    fromRev: integer('from_rev').notNull(),
    toRev: integer('to_rev'),
    claimedAt: ts('claimed_at'),
    cancelledAt: ts('cancelled_at'),
  },
  (t) => [
    index('ticket_transfers_org_order_idx').on(t.orgId, t.orderId, t.createdAt),
    index('ticket_transfers_org_ticket_idx').on(t.orgId, t.ticketId, t.createdAt),
    uniqueIndex('ticket_transfers_org_claim_key').on(t.orgId, t.claimId),
    uniqueIndex('ticket_transfers_org_ticket_pending_key')
      .on(t.orgId, t.ticketId)
      .where(sql`status = 'pending'`),
    foreignKey({
      name: 'ticket_transfers_ticket_fk',
      columns: [t.orgId, t.ticketId],
      foreignColumns: [tickets.orgId, tickets.id],
    }),
    foreignKey({
      name: 'ticket_transfers_claim_fk',
      columns: [t.orgId, t.claimId],
      foreignColumns: [ticketClaims.orgId, ticketClaims.id],
    }),
    check('ticket_transfers_status_check', sql`status in ('pending', 'claimed', 'cancelled')`),
    check('ticket_transfers_initiated_by_check', sql`initiated_by in ('organizer', 'holder')`),
    check('ticket_transfers_fee_check', sql`fee_minor >= 0`),
    check('ticket_transfers_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('ticket_transfers_email_lower_check', sql`to_email = lower(to_email)`),
    check(
      'ticket_transfers_state_check',
      sql`(status = 'claimed') = (claimed_at is not null and to_rev is not null) and (status = 'cancelled') = (cancelled_at is not null)`,
    ),
  ],
);

export const WALLET_PASS_STATUSES = ['active', 'voided'] as const;

/**
 * Wallet passes (M3.10c) as the pass provider holds them (fake in dev and CI; Apple/Google wait
 * for the owner's accounts): one per ticket code revision. A transfer voids the old holder's pass
 * and issues one for the new holder; `pushed_at` is when the provider was told.
 */
export const walletPasses = tenantTable(
  ticketingSchema,
  'wallet_passes',
  {
    ticketId: uuid('ticket_id').notNull(),
    rev: integer('rev').notNull(),
    serial: text('serial').notNull(),
    holderName: text('holder_name').notNull(),
    status: text('status').notNull().default('active'),
    provider: text('provider').notNull().default('fake'),
    pushedAt: ts('pushed_at'),
    voidedAt: ts('voided_at'),
  },
  (t) => [
    uniqueIndex('wallet_passes_org_ticket_rev_key').on(t.orgId, t.ticketId, t.rev),
    uniqueIndex('wallet_passes_org_serial_key').on(t.orgId, t.serial),
    uniqueIndex('wallet_passes_org_ticket_active_key').on(t.orgId, t.ticketId).where(sql`status = 'active'`),
    foreignKey({
      name: 'wallet_passes_ticket_fk',
      columns: [t.orgId, t.ticketId],
      foreignColumns: [tickets.orgId, tickets.id],
    }),
    check('wallet_passes_status_check', sql`status in ('active', 'voided')`),
    check('wallet_passes_provider_check', sql`provider in ('fake', 'apple', 'google')`),
    check('wallet_passes_voided_check', sql`(status = 'voided') = (voided_at is not null)`),
  ],
);

/**
 * M4.2b gala tables: one purchased table (a unit of a table ticket type). Its `size` tickets are
 * issued with it in the order's transaction and point here (`tickets.table_unit_id`), so a table
 * always has exactly `size` guest slots. The buyer names them through the table's claim link
 * (`<id>~hmac`, purpose `table-naming`); `link_sends` / `last_link_sent_at` count the emails that
 * carried it (the first after payment, resends by the buyer, reminders by the host).
 */
export const tableUnits = tenantTable(
  ticketingSchema,
  'table_units',
  {
    eventId: uuid('event_id').notNull(),
    orderId: uuid('order_id').notNull(),
    orderItemId: uuid('order_item_id').notNull(),
    ticketTypeId: uuid('ticket_type_id').notNull(),
    /** 1…n within the order item ("Table 2 of 3"). */
    unitNo: integer('unit_no').notNull(),
    size: integer('size').notNull(),
    linkSends: integer('link_sends').notNull().default(0),
    lastLinkSentAt: ts('last_link_sent_at'),
    reminders: integer('reminders').notNull().default(0),
    lastRemindedAt: ts('last_reminded_at'),
  },
  (t) => [
    uniqueIndex('table_units_org_item_unit_key').on(t.orgId, t.orderItemId, t.unitNo),
    index('table_units_org_event_idx').on(t.orgId, t.eventId, t.createdAt),
    index('table_units_org_order_idx').on(t.orgId, t.orderId),
    foreignKey({
      name: 'table_units_ticket_type_fk',
      columns: [t.orgId, t.ticketTypeId],
      foreignColumns: [ticketTypes.orgId, ticketTypes.id],
    }),
    check('table_units_size_check', sql`size between 2 and 20 and unit_no >= 1`),
    check('table_units_counts_check', sql`link_sends >= 0 and reminders >= 0`),
  ],
);
