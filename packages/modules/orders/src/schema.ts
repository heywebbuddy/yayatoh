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

export const ordersSchema = pgSchema('orders');

export const ORDER_STATUSES = [
  'reserved',
  'awaiting_payment',
  'payment_failed',
  'paid',
  'expired',
  'cancelled',
  'partially_refunded',
  'refunded',
] as const;

/**
 * How a migrated payment was charged in the legacy app (roadmap §5.3 "Legacy carry-over"), so a
 * refund routes correctly (e.g. with the `Stripe-Account` header for direct charges). Null for
 * orders taken by this platform.
 */
export const CHARGE_MODELS = [
  'legacy_platform',
  'legacy_direct_connected',
  'legacy_destination',
  'paypal',
  'offline',
  'sct',
] as const;

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const minor = (name: string) => bigint(name, { mode: 'number' });

export const orders = tenantTable(
  ordersSchema,
  'orders',
  {
    eventId: uuid('event_id').notNull(),
    status: text('status').notNull(),
    buyerEmail: text('buyer_email').notNull(),
    buyerName: text('buyer_name').notNull(),
    buyerUserId: uuid('buyer_user_id'),
    /** The buyer's org contact (`crm.contacts`, FK in a hand-written migration). */
    buyerContactId: uuid('buyer_contact_id'),
    locale: text('locale').notNull().default('en'),
    currency: text('currency').notNull(),
    subtotalMinor: minor('subtotal_minor').notNull(),
    /** Promo discount already taken off the subtotal (reporting; the subtotal is after it). */
    discountMinor: minor('discount_minor').notNull().default(0),
    /** `ticketing.promo_codes` (hand-written FK) and the code as the buyer typed it, normalized. */
    promoCodeId: uuid('promo_code_id'),
    promoCode: text('promo_code'),
    feeMinor: minor('fee_minor').notNull(),
    totalMinor: minor('total_minor').notNull(),
    fundsFlow: text('funds_flow').notNull(),
    /** The connected account charged directly (organizer_mor only; refunds go to the same one). */
    connectedAccountId: text('connected_account_id'),
    feeSchedule: jsonb('fee_schedule').notNull(),
    provider: text('provider'),
    providerPaymentId: text('provider_payment_id'),
    manageTokenHash: text('manage_token_hash').notNull(),
    /** M1.6e: checkout risk rules that asked for a review (empty: nothing flagged). */
    riskReview: text('risk_review').array().notNull().default(sql`'{}'::text[]`),
    /** The manage token, envelope-encrypted (KeyVault) so the worker can email the link. */
    manageTokenCiphertext: text('manage_token_ciphertext'),
    createdVia: text('created_via').notNull().default('web'),
    /** Who took the money: the platform (online checkout) or the organizer (box office, Zelle). */
    collectedBy: text('collected_by').notNull().default('platform'),
    /** Organizer-collected sales: how it was paid and any reference (e.g. a Zelle confirmation). */
    paymentMethod: text('payment_method'),
    paymentReference: text('payment_reference'),
    /** Migrated orders only: the legacy charge model (see CHARGE_MODELS). */
    chargeModel: text('charge_model'),
    /** Seated checkout: the chosen seats (held under the order's id until paid or expired). */
    seatUuids: uuid('seat_uuids').array().notNull().default(sql`'{}'::uuid[]`),
    /** Multi-date events (M1.4b): the chosen date (`events.occurrences`, hand-written FK). */
    occurrenceId: uuid('occurrence_id'),
    expiresAt: ts('expires_at'),
    paidAt: ts('paid_at'),
    cancelledAt: ts('cancelled_at'),
  },
  (t) => [
    index('orders_org_event_created_idx').on(t.orgId, t.eventId, t.createdAt),
    // Search (M1.8f): trigram indexes for the buyer name/email `ILIKE '%…%'` search.
    index('orders_buyer_name_trgm_idx').using('gin', t.buyerName.op('gin_trgm_ops')),
    index('orders_buyer_email_trgm_idx').using('gin', t.buyerEmail.op('gin_trgm_ops')),
    index('orders_org_status_expires_idx').on(t.orgId, t.status, t.expiresAt),
    // M1.5f: a buyer's orders by address (My tickets, resend links).
    index('orders_org_buyer_email_idx').on(t.orgId, t.buyerEmail),
    index('orders_org_occurrence_status_idx')
      .on(t.orgId, t.occurrenceId, t.status)
      .where(sql`occurrence_id is not null`),
    uniqueIndex('orders_manage_token_hash_key').on(t.manageTokenHash),
    uniqueIndex('orders_org_provider_payment_key').on(t.orgId, t.provider, t.providerPaymentId),
    check('orders_status_check', sql.raw(`status in (${ORDER_STATUSES.map((s) => `'${s}'`).join(', ')})`)),
    check(
      'orders_totals_check',
      sql`subtotal_minor >= 0 and fee_minor >= 0 and total_minor = subtotal_minor + fee_minor`,
    ),
    check('orders_discount_check', sql`discount_minor >= 0`),
    check('orders_funds_flow_check', sql`funds_flow in ('organizer_mor', 'platform_mor')`),
    check(
      'orders_connected_account_check',
      sql`(funds_flow = 'organizer_mor') = (connected_account_id is not null)`,
    ),
    check('orders_email_lower_check', sql`buyer_email = lower(buyer_email)`),
    check('orders_collected_by_check', sql`collected_by in ('platform', 'organizer')`),
    check(
      'orders_payment_method_check',
      sql`payment_method is null or payment_method in ('cash', 'zelle', 'card_terminal', 'other')`,
    ),
    check(
      'orders_charge_model_check',
      sql.raw(`charge_model is null or charge_model in (${CHARGE_MODELS.map((m) => `'${m}'`).join(', ')})`),
    ),
  ],
);

export const orderItems = tenantTable(
  ordersSchema,
  'order_items',
  {
    orderId: uuid('order_id').notNull(),
    ticketTypeId: uuid('ticket_type_id').notNull(),
    name: text('name').notNull(),
    quantity: integer('quantity').notNull(),
    unitFaceMinor: minor('unit_face_minor').notNull(),
    unitDiscountMinor: minor('unit_discount_minor').notNull().default(0),
    unitFeeMinor: minor('unit_fee_minor').notNull(),
    unitAllInMinor: minor('unit_all_in_minor').notNull(),
    unitOrganizerNetMinor: minor('unit_organizer_net_minor').notNull(),
  },
  (t) => [
    index('order_items_org_order_idx').on(t.orgId, t.orderId),
    foreignKey({
      name: 'order_items_order_fk',
      columns: [t.orgId, t.orderId],
      foreignColumns: [orders.orgId, orders.id],
    }).onDelete('cascade'),
    check('order_items_quantity_check', sql`quantity >= 1`),
    check('order_items_discount_check', sql`unit_discount_minor between 0 and unit_face_minor`),
  ],
);

export const REFUND_STATUSES = ['pending', 'succeeded', 'failed'] as const;
export const REFUND_REASONS = [
  'requested_by_customer',
  'event_cancelled',
  'event_postponed',
  'duplicate',
  'fraudulent',
  'goodwill',
] as const;

/**
 * Refunds (M1.6b): whole tickets (voided on success) or a goodwill amount. `fee_refunded_minor`
 * is the platform-fee part given back, set by the refund policy.
 */
export const refunds = tenantTable(
  ordersSchema,
  'refunds',
  {
    orderId: uuid('order_id').notNull(),
    status: text('status').notNull().default('pending'),
    reason: text('reason').notNull(),
    note: text('note'),
    amountMinor: minor('amount_minor').notNull(),
    feeRefundedMinor: minor('fee_refunded_minor').notNull().default(0),
    currency: text('currency').notNull(),
    ticketIds: uuid('ticket_ids').array().notNull().default(sql`'{}'::uuid[]`),
    providerRefundId: text('provider_refund_id'),
    failureCode: text('failure_code'),
    requestedBy: text('requested_by').notNull(),
    completedAt: ts('completed_at'),
    /** M1.6e: kept by the organizer under the event's refund policy (already taken off the amount). */
    retainedMinor: minor('retained_minor').notNull().default(0),
    /** M1.6e: refunded outside the event's refund policy by someone allowed to (audited, with a note). */
    policyOverride: boolean('policy_override').notNull().default(false),
  },
  (t) => [
    index('refunds_org_order_idx').on(t.orgId, t.orderId),
    check('refunds_status_check', sql.raw(`status in (${REFUND_STATUSES.map((s) => `'${s}'`).join(', ')})`)),
    check('refunds_reason_check', sql.raw(`reason in (${REFUND_REASONS.map((s) => `'${s}'`).join(', ')})`)),
    check('refunds_amount_check', sql`amount_minor > 0 and fee_refunded_minor between 0 and amount_minor`),
    foreignKey({
      name: 'refunds_order_fk',
      columns: [t.orgId, t.orderId],
      foreignColumns: [orders.orgId, orders.id],
    }),
  ],
);

export const REFUND_POLICY_KINDS = ['none', 'until', 'always'] as const;

/**
 * An event's refund policy (M1.6e): what buyers are told and what discretionary refunds may do.
 * No row: refunds are at the organizer's discretion and no policy text is shown. The platform
 * minimum (cancellation, long postponement) always refunds in full, whatever the policy says.
 */
export const refundPolicies = tenantTable(
  ordersSchema,
  'refund_policies',
  {
    /** `events.events` (hand-written FK, down the tiers). */
    eventId: uuid('event_id').notNull(),
    kind: text('kind').notNull(),
    daysBefore: integer('days_before'),
    retainedMinor: minor('retained_minor').notNull().default(0),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    uniqueIndex('refund_policies_org_event_key').on(t.orgId, t.eventId),
    check(
      'refund_policies_kind_check',
      sql.raw(`kind in (${REFUND_POLICY_KINDS.map((s) => `'${s}'`).join(', ')})`),
    ),
    check(
      'refund_policies_days_check',
      sql`(kind = 'until') = (days_before is not null) and (days_before is null or days_before between 0 and 365)`,
    ),
    check(
      'refund_policies_retained_check',
      sql`retained_minor >= 0 and (kind <> 'none' or retained_minor = 0)`,
    ),
  ],
);

/**
 * Checkout settings per event (M1.5f). No row: the defaults (buyers confirm their email with a
 * code before ordering; pending owner).
 */
export const checkoutSettings = tenantTable(
  ordersSchema,
  'checkout_settings',
  {
    /** `events.events` (hand-written FK, down the tiers). */
    eventId: uuid('event_id').notNull(),
    verifyEmail: boolean('verify_email').notNull().default(true),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [uniqueIndex('checkout_settings_org_event_key').on(t.orgId, t.eventId)],
);

export const GUEST_CHALLENGE_PURPOSES = ['checkout', 'sign_in'] as const;

// Global (listed in GLOBAL_TABLES): a guest proving an email is not yet anyone's tenant data, and
// marketplace sign-in spans orgs. Codes, links and browsers are stored as HMACs only.
/**
 * One emailed code (and, for sign-in, magic link) proving an address (M1.5f). `scope_org_id` is
 * the org whose site asked (null: the marketplace). Rows are pruned a day after they expire.
 */
export const guestChallenges = ordersSchema.table(
  'guest_challenges',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    purpose: text('purpose').notNull(),
    scopeOrgId: uuid('scope_org_id'),
    emailHash: text('email_hash').notNull(),
    /** Needed to open the session or check out once verified; gone when the row is pruned. */
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: ts('expires_at').notNull(),
    linkHash: text('link_hash'),
    browserHash: text('browser_hash'),
    linkExpiresAt: ts('link_expires_at'),
    usedAt: ts('used_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('guest_challenges_email_idx').on(t.emailHash, t.purpose, t.createdAt),
    index('guest_challenges_expires_idx').on(t.expiresAt),
    uniqueIndex('guest_challenges_link_key').on(t.linkHash),
    check(
      'guest_challenges_purpose_check',
      sql.raw(`purpose in (${GUEST_CHALLENGE_PURPOSES.map((p) => `'${p}'`).join(', ')})`),
    ),
    check('guest_challenges_attempts_check', sql`attempts between 0 and 5`),
    check('guest_challenges_email_lower_check', sql`email = lower(email)`),
    check(
      'guest_challenges_link_check',
      sql`(link_hash is null) = (link_expires_at is null) and (link_hash is null or browser_hash is not null)`,
    ),
  ],
);

/**
 * Attendee ("My tickets") sessions (M1.5f): separate from organizer sessions (Better Auth), bound
 * to the host that issued them, for one org's site or the marketplace (null scope). The cookie
 * holds a random token; only its HMAC is stored.
 */
export const guestSessions = ordersSchema.table(
  'guest_sessions',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    tokenHash: text('token_hash').notNull(),
    scopeOrgId: uuid('scope_org_id'),
    host: text('host').notNull(),
    emailHash: text('email_hash').notNull(),
    email: text('email').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('guest_sessions_token_key').on(t.tokenHash),
    index('guest_sessions_email_idx').on(t.emailHash),
    index('guest_sessions_expires_idx').on(t.expiresAt),
    check('guest_sessions_email_lower_check', sql`email = lower(email)`),
  ],
);
