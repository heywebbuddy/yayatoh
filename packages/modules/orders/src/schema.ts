import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
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
  /** M5.1d: invoiced (pay later): registered, tickets issued, waiting for the balance. */
  'awaiting_invoice',
  /** M5.1d: an invoice the organizer voided before anything was paid. */
  'void',
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
    /** U9: the org-wide coupon the order took (`ticketing.coupons`, hand-written FK); `promo_code` holds its code. */
    couponId: uuid('coupon_id'),
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
    /**
     * M3.10b: the event's refund policy as the buyer saw it at purchase (kind, days before, kept
     * per ticket; `unset` when there was none). Null: the order predates M3.10b (the current
     * policy applies). Tightening the policy later never applies to this order; loosening it does
     * (the buyer gets the better of the two).
     */
    refundPolicySnapshot: jsonb('refund_policy_snapshot').$type<{
      kind: 'unset' | 'none' | 'until' | 'always';
      daysBefore: number | null;
      retainedMinor: number;
    }>(),
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

export const WAITLIST_ENTRY_STATUSES = [
  'waiting',
  'offered',
  'accepted',
  'expired',
  'declined',
  'left',
  'removed',
] as const;

/**
 * Waitlists (M3.10a): one per ticket type and date (`occurrence_id` null for a single-date event
 * or a pass valid on every date). Created when the first person joins. `auto_offer` off pauses
 * the sweeper's offers (the organizer still offers by hand); `offer_minutes` is how long an offer
 * holds its stock (default 24 h, pending owner).
 */
export const waitlists = tenantTable(
  ordersSchema,
  'waitlists',
  {
    /** `events.events`, `ticketing.ticket_types`, `events.occurrences` (hand-written FKs, down the tiers). */
    eventId: uuid('event_id').notNull(),
    ticketTypeId: uuid('ticket_type_id').notNull(),
    occurrenceId: uuid('occurrence_id'),
    autoOffer: boolean('auto_offer').notNull().default(true),
    offerMinutes: integer('offer_minutes').notNull().default(1440),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    index('waitlists_org_event_idx').on(t.orgId, t.eventId),
    uniqueIndex('waitlists_org_type_key').on(t.orgId, t.ticketTypeId).where(sql`occurrence_id is null`),
    uniqueIndex('waitlists_org_type_date_key')
      .on(t.orgId, t.ticketTypeId, t.occurrenceId)
      .where(sql`occurrence_id is not null`),
    check('waitlists_offer_minutes_check', sql`offer_minutes between 15 and 10080`),
  ],
);

/**
 * One person in line (M3.10a). The queue order is `(position_at, id)`: joining sets it, and
 * rejoining after an expired or declined offer moves it to the back. An offer holds
 * `offered_quantity` of the ticket type's stock (`quantity_held`) until `offer_expires_at`;
 * accepting it moves that stock to the order (`order_id`).
 */
export const waitlistEntries = tenantTable(
  ordersSchema,
  'waitlist_entries',
  {
    waitlistId: uuid('waitlist_id').notNull(),
    eventId: uuid('event_id').notNull(),
    ticketTypeId: uuid('ticket_type_id').notNull(),
    occurrenceId: uuid('occurrence_id'),
    name: text('name').notNull(),
    email: text('email').notNull(),
    quantity: integer('quantity').notNull(),
    locale: text('locale').notNull().default('en'),
    status: text('status').notNull().default('waiting'),
    positionAt: ts('position_at').notNull(),
    offeredQuantity: integer('offered_quantity'),
    offeredAt: ts('offered_at'),
    offerExpiresAt: ts('offer_expires_at'),
    /** How many offers this entry has had (the offer email's dedupe key). */
    offerCount: integer('offer_count').notNull().default(0),
    /** Who made the last offer: the sweeper (`auto`) or the organizer (`manual`). */
    offeredBy: text('offered_by'),
    orderId: uuid('order_id'),
    endedAt: ts('ended_at'),
  },
  (t) => [
    index('waitlist_entries_org_queue_idx').on(t.orgId, t.waitlistId, t.status, t.positionAt, t.id),
    index('waitlist_entries_org_offer_idx').on(t.orgId, t.offerExpiresAt).where(sql`status = 'offered'`),
    index('waitlist_entries_org_email_idx').on(t.orgId, t.email),
    index('waitlist_entries_org_order_idx').on(t.orgId, t.orderId).where(sql`order_id is not null`),
    uniqueIndex('waitlist_entries_org_active_email_key')
      .on(t.orgId, t.waitlistId, t.email)
      .where(sql`status in ('waiting', 'offered')`),
    foreignKey({
      name: 'waitlist_entries_waitlist_fk',
      columns: [t.orgId, t.waitlistId],
      foreignColumns: [waitlists.orgId, waitlists.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'waitlist_entries_order_fk',
      columns: [t.orgId, t.orderId],
      foreignColumns: [orders.orgId, orders.id],
    }),
    check(
      'waitlist_entries_status_check',
      sql.raw(`status in (${WAITLIST_ENTRY_STATUSES.map((s) => `'${s}'`).join(', ')})`),
    ),
    check('waitlist_entries_quantity_check', sql`quantity between 1 and 100`),
    check(
      'waitlist_entries_offer_check',
      sql`status <> 'offered' or (offered_quantity between 1 and quantity and offer_expires_at is not null and offered_at is not null)`,
    ),
    check('waitlist_entries_offered_by_check', sql`offered_by is null or offered_by in ('auto', 'manual')`),
    check('waitlist_entries_email_lower_check', sql`email = lower(email)`),
  ],
);

export const GUEST_CHALLENGE_PURPOSES = ['checkout', 'sign_in', 'waitlist'] as const;

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

export const REFUND_REQUEST_STATUSES = ['open', 'approved', 'declined'] as const;

/**
 * Buyer refund requests (M3.10b): asked from the order page (manage link) within the refund
 * policy, answered by the organizer before `due_at` (the SLA). At most one open request per
 * order. Approving runs the normal refund command (`refund_id`); declining needs a reason, which
 * the buyer is sent.
 */
export const refundRequests = tenantTable(
  ordersSchema,
  'refund_requests',
  {
    orderId: uuid('order_id').notNull(),
    eventId: uuid('event_id').notNull(),
    status: text('status').notNull().default('open'),
    /** The tickets the buyer asked about (their own live tickets); empty: the whole order. */
    ticketIds: uuid('ticket_ids').array().notNull().default(sql`'{}'::uuid[]`),
    /** What the buyer wrote (optional). */
    message: text('message'),
    /** When the organizer should have answered (the SLA, 5 business days: pending owner). */
    dueAt: ts('due_at').notNull(),
    declineReason: text('decline_reason'),
    decidedBy: text('decided_by'),
    decidedAt: ts('decided_at'),
    /** Approved: the refund it started (`refunds`). */
    refundId: uuid('refund_id'),
  },
  (t) => [
    index('refund_requests_org_status_due_idx').on(t.orgId, t.status, t.dueAt),
    index('refund_requests_org_order_idx').on(t.orgId, t.orderId),
    index('refund_requests_org_event_idx').on(t.orgId, t.eventId, t.createdAt),
    uniqueIndex('refund_requests_org_order_open_key').on(t.orgId, t.orderId).where(sql`status = 'open'`),
    check(
      'refund_requests_status_check',
      sql.raw(`status in (${REFUND_REQUEST_STATUSES.map((s) => `'${s}'`).join(', ')})`),
    ),
    check('refund_requests_message_check', sql`message is null or length(message) between 1 and 1000`),
    check(
      'refund_requests_decline_check',
      sql`(status = 'declined') = (decline_reason is not null) and (decline_reason is null or length(decline_reason) between 3 and 500)`,
    ),
    check('refund_requests_decided_check', sql`(status = 'open') = (decided_at is null)`),
    check('refund_requests_refund_check', sql`status = 'approved' or refund_id is null`),
    foreignKey({
      name: 'refund_requests_order_fk',
      columns: [t.orgId, t.orderId],
      foreignColumns: [orders.orgId, orders.id],
    }),
    foreignKey({
      name: 'refund_requests_refund_fk',
      columns: [t.orgId, t.refundId],
      foreignColumns: [refunds.orgId, refunds.id],
    }),
  ],
);

/** Internal notes on an order (M3.10b): support context for the team, shown on the order timeline. */
export const orderNotes = tenantTable(
  ordersSchema,
  'order_notes',
  {
    orderId: uuid('order_id').notNull(),
    body: text('body').notNull(),
    authorId: text('author_id').notNull(),
  },
  (t) => [
    index('order_notes_org_order_idx').on(t.orgId, t.orderId, t.createdAt),
    check('order_notes_body_check', sql`length(body) between 1 and 2000`),
    foreignKey({
      name: 'order_notes_order_fk',
      columns: [t.orgId, t.orderId],
      foreignColumns: [orders.orgId, orders.id],
    }),
  ],
);

export const MASS_REFUND_STATUSES = ['running', 'paused', 'done'] as const;
export const MASS_REFUND_ITEM_STATUSES = [
  'pending',
  'refunded',
  'skipped_disputed',
  'skipped',
  'failed',
] as const;

/**
 * A mass refund (M3.10b): every paid order of a cancelled event refunded in a resumable batch
 * (pg-boss job `orders.mass-refund`). Items are snapshotted at the start, one per order; each is
 * refunded at most once (its refund is recorded with the item, and the provider call is keyed by
 * the refund). Disputed charges are skipped. Pausing stops the job between orders; resuming picks
 * up where it stopped. At the end the run is reconciled against the ledger.
 */
export const massRefunds = tenantTable(
  ordersSchema,
  'mass_refunds',
  {
    eventId: uuid('event_id').notNull(),
    /** The refund reason: the platform minimum (roadmap §5.3) refunds face and fee. */
    reason: text('reason').notNull(),
    status: text('status').notNull().default('running'),
    currency: text('currency').notNull(),
    total: integer('total').notNull(),
    processed: integer('processed').notNull().default(0),
    refunded: integer('refunded').notNull().default(0),
    skippedDisputed: integer('skipped_disputed').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    refundedMinor: minor('refunded_minor').notNull().default(0),
    requestedBy: text('requested_by').notNull(),
    pausedAt: ts('paused_at'),
    finishedAt: ts('finished_at'),
    /** Reconciliation at the end: cash the ledger moved for these refunds vs what they refunded. */
    reconciledAt: ts('reconciled_at'),
    reconciled: boolean('reconciled'),
    ledgerCashMinor: minor('ledger_cash_minor'),
    expectedCashMinor: minor('expected_cash_minor'),
    receivableMinor: minor('receivable_minor'),
  },
  (t) => [
    index('mass_refunds_org_event_idx').on(t.orgId, t.eventId, t.createdAt),
    index('mass_refunds_org_status_idx').on(t.orgId, t.status),
    uniqueIndex('mass_refunds_org_event_live_key')
      .on(t.orgId, t.eventId)
      .where(sql`status in ('running', 'paused')`),
    check(
      'mass_refunds_status_check',
      sql.raw(`status in (${MASS_REFUND_STATUSES.map((s) => `'${s}'`).join(', ')})`),
    ),
    check('mass_refunds_reason_check', sql`reason in ('event_cancelled', 'event_postponed')`),
    check(
      'mass_refunds_counts_check',
      sql`total >= 0 and processed between 0 and total and refunded + skipped_disputed + skipped + failed = processed and refunded_minor >= 0`,
    ),
    check('mass_refunds_done_check', sql`(status = 'done') = (finished_at is not null)`),
  ],
);

export const massRefundItems = tenantTable(
  ordersSchema,
  'mass_refund_items',
  {
    runId: uuid('run_id').notNull(),
    orderId: uuid('order_id').notNull(),
    /** Processing order (orders oldest first). */
    position: integer('position').notNull(),
    status: text('status').notNull().default('pending'),
    /** The refund this item started; set in the same transaction, so a retry resumes it. */
    refundId: uuid('refund_id'),
    amountMinor: minor('amount_minor').notNull().default(0),
    /** Skipped or failed: why (a stable code shown to the organizer). */
    code: text('code'),
  },
  (t) => [
    uniqueIndex('mass_refund_items_org_run_order_key').on(t.orgId, t.runId, t.orderId),
    uniqueIndex('mass_refund_items_org_run_position_key').on(t.orgId, t.runId, t.position),
    index('mass_refund_items_org_run_status_idx').on(t.orgId, t.runId, t.status, t.position),
    index('mass_refund_items_org_order_idx').on(t.orgId, t.orderId),
    check(
      'mass_refund_items_status_check',
      sql.raw(`status in (${MASS_REFUND_ITEM_STATUSES.map((s) => `'${s}'`).join(', ')})`),
    ),
    check('mass_refund_items_amount_check', sql`amount_minor >= 0`),
    check('mass_refund_items_code_check', sql`code is null or code ~ '^[a-z_]{1,60}$'`),
    foreignKey({
      name: 'mass_refund_items_run_fk',
      columns: [t.orgId, t.runId],
      foreignColumns: [massRefunds.orgId, massRefunds.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'mass_refund_items_order_fk',
      columns: [t.orgId, t.orderId],
      foreignColumns: [orders.orgId, orders.id],
    }),
    foreignKey({
      name: 'mass_refund_items_refund_fk',
      columns: [t.orgId, t.refundId],
      foreignColumns: [refunds.orgId, refunds.id],
    }),
  ],
);

/** The per-org credit note counter (M3.10c): numbers are gap-free per org, taken under this row's lock. */
export const creditNoteSequences = tenantTable(
  ordersSchema,
  'credit_note_sequences',
  { lastNumber: integer('last_number').notNull().default(0) },
  (t) => [
    uniqueIndex('credit_note_sequences_org_key').on(t.orgId),
    check('credit_note_sequences_last_check', sql`last_number >= 0`),
  ],
);

export const CREDIT_NOTE_KINDS = ['full', 'partial'] as const;
export const CREDIT_NOTE_DISPOSITIONS = ['store_credit', 'refunded'] as const;

/**
 * Credit notes (M3.10c): a document reducing what an order cost, numbered per org (CN-00001…),
 * full (what is left of the order) or partial, with a reason. `store_credit`: the amount becomes
 * credit the buyer spends with `code` on a later order of the same org (`balance_minor` is what
 * is left); `refunded`: the amount was paid back outside the provider (recorded, nothing moves).
 */
export const creditNotes = tenantTable(
  ordersSchema,
  'credit_notes',
  {
    orderId: uuid('order_id').notNull(),
    eventId: uuid('event_id').notNull(),
    number: integer('number').notNull(),
    kind: text('kind').notNull(),
    disposition: text('disposition').notNull(),
    reason: text('reason').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    balanceMinor: minor('balance_minor').notNull(),
    currency: text('currency').notNull(),
    /** Store credit only: what the buyer types at checkout (`CR-XXXX-XXXX`). */
    code: text('code'),
    /** Snapshots for the document. */
    buyerName: text('buyer_name').notNull(),
    buyerEmail: text('buyer_email').notNull(),
    issuedBy: text('issued_by').notNull(),
  },
  (t) => [
    uniqueIndex('credit_notes_org_number_key').on(t.orgId, t.number),
    uniqueIndex('credit_notes_org_code_key').on(t.orgId, t.code).where(sql`code is not null`),
    index('credit_notes_org_order_idx').on(t.orgId, t.orderId, t.createdAt),
    index('credit_notes_org_created_idx').on(t.orgId, t.createdAt),
    foreignKey({
      name: 'credit_notes_order_fk',
      columns: [t.orgId, t.orderId],
      foreignColumns: [orders.orgId, orders.id],
    }),
    check('credit_notes_number_check', sql`number >= 1`),
    check('credit_notes_kind_check', sql`kind in ('full', 'partial')`),
    check('credit_notes_disposition_check', sql`disposition in ('store_credit', 'refunded')`),
    check('credit_notes_reason_check', sql`length(reason) between 3 and 500`),
    check('credit_notes_amount_check', sql`amount_minor > 0 and balance_minor between 0 and amount_minor`),
    check(
      'credit_notes_store_credit_check',
      sql`(disposition = 'store_credit') = (code is not null) and (disposition = 'store_credit' or balance_minor = 0)`,
    ),
    check('credit_notes_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
  ],
);

/**
 * Store credit spent on an order (M3.10c): taken from the note's balance at checkout (a discount
 * on the order's tickets) and given back if the order lapses unpaid (`released_at`).
 */
export const creditNoteApplications = tenantTable(
  ordersSchema,
  'credit_note_applications',
  {
    creditNoteId: uuid('credit_note_id').notNull(),
    orderId: uuid('order_id').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    releasedAt: ts('released_at'),
  },
  (t) => [
    index('credit_note_applications_org_note_idx').on(t.orgId, t.creditNoteId),
    uniqueIndex('credit_note_applications_org_order_key').on(t.orgId, t.orderId),
    foreignKey({
      name: 'credit_note_applications_note_fk',
      columns: [t.orgId, t.creditNoteId],
      foreignColumns: [creditNotes.orgId, creditNotes.id],
    }),
    foreignKey({
      name: 'credit_note_applications_order_fk',
      columns: [t.orgId, t.orderId],
      foreignColumns: [orders.orgId, orders.id],
    }),
    check('credit_note_applications_amount_check', sql`amount_minor > 0`),
  ],
);

export const MACRO_ACTIONS = ['email_buyer', 'add_note', 'resend_tickets', 'transfer_ticket'] as const;

/**
 * Support macros (M3.10c): a saved reply and the actions that go with it, run from an order.
 * `subject` and `body` may use merge fields (`{{buyer_name}}`…); archived macros are kept for the
 * run history.
 */
export const supportMacros = tenantTable(
  ordersSchema,
  'support_macros',
  {
    name: text('name').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    actions: text('actions').array().notNull(),
    updatedBy: text('updated_by').notNull(),
    archivedAt: ts('archived_at'),
  },
  (t) => [
    uniqueIndex('support_macros_org_name_key')
      .on(t.orgId, sql`lower(${t.name})`)
      .where(sql`archived_at is null`),
    check('support_macros_name_check', sql`length(name) between 2 and 80`),
    check('support_macros_subject_check', sql`length(subject) between 1 and 200`),
    check('support_macros_body_check', sql`length(body) between 1 and 5000`),
    check(
      'support_macros_actions_check',
      sql.raw(
        `cardinality(actions) between 1 and 4 and actions <@ array[${MACRO_ACTIONS.map((a) => `'${a}'`).join(', ')}]::text[]`,
      ),
    ),
  ],
);

/** One run of a macro on an order (M3.10c): what it did, for the order timeline and audit. */
export const supportMacroRuns = tenantTable(
  ordersSchema,
  'support_macro_runs',
  {
    macroId: uuid('macro_id').notNull(),
    orderId: uuid('order_id').notNull(),
    macroName: text('macro_name').notNull(),
    actions: text('actions').array().notNull(),
    /** The reply as it was sent (merge fields filled). */
    replySubject: text('reply_subject').notNull(),
    replyBody: text('reply_body').notNull(),
    ranBy: text('ran_by').notNull(),
  },
  (t) => [
    index('support_macro_runs_org_order_idx').on(t.orgId, t.orderId, t.createdAt),
    foreignKey({
      name: 'support_macro_runs_macro_fk',
      columns: [t.orgId, t.macroId],
      foreignColumns: [supportMacros.orgId, supportMacros.id],
    }),
    foreignKey({
      name: 'support_macro_runs_order_fk',
      columns: [t.orgId, t.orderId],
      foreignColumns: [orders.orgId, orders.id],
    }),
  ],
);

/**
 * M4.8a: the donation item of a gift order (P4-9). A gift is an order with no ticket lines and
 * one donation item: the gift and the processing fee the donor chose to cover (P4-10), both going
 * to the charity. `gift_id` is the `donations` module's gift (a higher tier: no foreign key).
 * Paid as a direct charge on the organizer's connected account with application fee 0.
 */
export const donationItems = tenantTable(
  ordersSchema,
  'donation_items',
  {
    orderId: uuid('order_id').notNull(),
    giftId: uuid('gift_id').notNull(),
    /** What the donor gives to (the campaign's name when the gift was made). */
    name: text('name').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    feeCoverMinor: minor('fee_cover_minor').notNull().default(0),
    currency: text('currency').notNull(),
  },
  (t) => [
    uniqueIndex('donation_items_org_order_key').on(t.orgId, t.orderId),
    uniqueIndex('donation_items_org_gift_key').on(t.orgId, t.giftId),
    foreignKey({
      name: 'donation_items_order_fk',
      columns: [t.orgId, t.orderId],
      foreignColumns: [orders.orgId, orders.id],
    }).onDelete('cascade'),
    check('donation_items_amount_check', sql`amount_minor > 0 and fee_cover_minor >= 0`),
    check('donation_items_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('donation_items_name_length', sql`length(name) between 1 and 120`),
  ],
);

/* ------------------------------------------------------------------- M5.1d invoices ---- */

export const INVOICE_STATUSES = ['open', 'paid', 'void'] as const;
export const INVOICE_PAYMENT_CHANNELS = ['pay_link', 'offline'] as const;
/** How the money came: a card through the pay link, or what staff recorded (organizer-collected). */
export const INVOICE_PAYMENT_METHODS = ['card', 'check', 'wire', 'cash', 'other'] as const;
export const INVOICE_PAYMENT_STATUSES = ['pending', 'succeeded', 'failed'] as const;

/** Gap-free invoice numbers per org (M5.1d; the counter row is locked by the upsert). */
export const invoiceSequences = tenantTable(
  ordersSchema,
  'invoice_sequences',
  { lastNumber: integer('last_number').notNull().default(0) },
  (t) => [
    uniqueIndex('invoice_sequences_org_key').on(t.orgId),
    check('invoice_sequences_last_check', sql`last_number >= 0`),
  ],
);

/**
 * An invoice (M5.1d, P5-5): one per pay-later order, numbered per org (INV-00001…, never reused:
 * a void invoice keeps its number). Terms are snapshotted: due on `due_on` (a calendar day in the
 * event's timezone; `due_at` is that day's start there). `paid_minor` and `fee_allocated_minor`
 * are the running sums of its succeeded payments (the balance is `total_minor - paid_minor`).
 * Never cancelled automatically: only the organizer voids one.
 */
export const invoices = tenantTable(
  ordersSchema,
  'invoices',
  {
    orderId: uuid('order_id').notNull(),
    eventId: uuid('event_id').notNull(),
    number: integer('number').notNull(),
    status: text('status').notNull().default('open'),
    poNumber: text('po_number'),
    billingCompany: text('billing_company'),
    /** Snapshots for the document. */
    buyerName: text('buyer_name').notNull(),
    buyerEmail: text('buyer_email').notNull(),
    currency: text('currency').notNull(),
    totalMinor: minor('total_minor').notNull(),
    /** The order's platform fee, spread over the payments (each payment's fee part). */
    feeMinor: minor('fee_minor').notNull(),
    paidMinor: minor('paid_minor').notNull().default(0),
    feeAllocatedMinor: minor('fee_allocated_minor').notNull().default(0),
    /** `net30_event7`: Net 30 from the invoice date, due no later than 7 days before the event. */
    terms: text('terms').notNull(),
    issuedOn: date('issued_on', { mode: 'string' }).notNull(),
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    dueAt: ts('due_at').notNull(),
    paidAt: ts('paid_at'),
    voidedAt: ts('voided_at'),
    voidReason: text('void_reason'),
    issuedBy: text('issued_by').notNull(),
  },
  (t) => [
    uniqueIndex('invoices_org_number_key').on(t.orgId, t.number),
    uniqueIndex('invoices_org_order_key').on(t.orgId, t.orderId),
    index('invoices_org_event_status_idx').on(t.orgId, t.eventId, t.status, t.dueOn),
    foreignKey({
      name: 'invoices_order_fk',
      columns: [t.orgId, t.orderId],
      foreignColumns: [orders.orgId, orders.id],
    }),
    check('invoices_number_check', sql`number >= 1`),
    check(
      'invoices_status_check',
      sql.raw(`status in (${INVOICE_STATUSES.map((s) => `'${s}'`).join(', ')})`),
    ),
    check(
      'invoices_amounts_check',
      sql`total_minor > 0 and fee_minor between 0 and total_minor and paid_minor >= 0 and fee_allocated_minor between 0 and fee_minor`,
    ),
    check(
      'invoices_paid_check',
      sql`(status = 'paid') = (paid_at is not null) and (status <> 'paid' or paid_minor >= total_minor)`,
    ),
    // A pay link opened before a void may still be paid afterwards: recorded, to be refunded.
    check('invoices_void_check', sql`(status = 'void') = (voided_at is not null)`),
    check('invoices_due_check', sql`due_on >= issued_on`),
    check('invoices_terms_check', sql`terms in ('net30_event7')`),
    check('invoices_po_check', sql`po_number is null or length(po_number) between 1 and 60`),
    check(
      'invoices_company_check',
      sql`billing_company is null or length(billing_company) between 1 and 120`,
    ),
    check('invoices_void_reason_check', sql`void_reason is null or length(void_reason) between 3 and 500`),
    check('invoices_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
  ],
);

/**
 * A payment against an invoice (M5.1d): a card payment through the pay link (`pending` until the
 * provider's verified webhook, on the org's funds flow at the time) or one staff recorded
 * (check, wire, cash: organizer-collected, the fee part becomes a receivable). `idempotency_key`
 * is unique per org: replaying a pay link or a recording never creates a second payment.
 */
export const invoicePayments = tenantTable(
  ordersSchema,
  'invoice_payments',
  {
    invoiceId: uuid('invoice_id').notNull(),
    orderId: uuid('order_id').notNull(),
    channel: text('channel').notNull(),
    method: text('method').notNull(),
    status: text('status').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    /** The platform fee part of this payment (fixed when it succeeds; the card's application fee). */
    feePartMinor: minor('fee_part_minor').notNull().default(0),
    currency: text('currency').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    fundsFlow: text('funds_flow'),
    connectedAccountId: text('connected_account_id'),
    provider: text('provider'),
    providerPaymentId: text('provider_payment_id'),
    /** Offline: the cheque number or wire reference staff typed. */
    reference: text('reference'),
    note: text('note'),
    /** Offline: the day the money arrived (staff's calendar). */
    receivedOn: date('received_on', { mode: 'string' }),
    recordedBy: text('recorded_by').notNull(),
    completedAt: ts('completed_at'),
  },
  (t) => [
    uniqueIndex('invoice_payments_org_key').on(t.orgId, t.idempotencyKey),
    uniqueIndex('invoice_payments_org_provider_key')
      .on(t.orgId, t.provider, t.providerPaymentId)
      .where(sql`provider_payment_id is not null`),
    index('invoice_payments_org_invoice_idx').on(t.orgId, t.invoiceId, t.createdAt),
    index('invoice_payments_org_order_idx').on(t.orgId, t.orderId),
    foreignKey({
      name: 'invoice_payments_invoice_fk',
      columns: [t.orgId, t.invoiceId],
      foreignColumns: [invoices.orgId, invoices.id],
    }),
    foreignKey({
      name: 'invoice_payments_order_fk',
      columns: [t.orgId, t.orderId],
      foreignColumns: [orders.orgId, orders.id],
    }),
    check(
      'invoice_payments_channel_check',
      sql.raw(`channel in (${INVOICE_PAYMENT_CHANNELS.map((s) => `'${s}'`).join(', ')})`),
    ),
    check(
      'invoice_payments_method_check',
      sql.raw(`method in (${INVOICE_PAYMENT_METHODS.map((s) => `'${s}'`).join(', ')})`),
    ),
    check(
      'invoice_payments_status_check',
      sql.raw(`status in (${INVOICE_PAYMENT_STATUSES.map((s) => `'${s}'`).join(', ')})`),
    ),
    check(
      'invoice_payments_amount_check',
      sql`amount_minor > 0 and fee_part_minor between 0 and amount_minor`,
    ),
    check(
      'invoice_payments_kind_check',
      sql`(channel = 'pay_link') = (method = 'card') and (channel = 'pay_link' or (status = 'succeeded' and received_on is not null))`,
    ),
    check(
      'invoice_payments_flow_check',
      sql`(channel = 'offline') = (funds_flow is null) and (funds_flow is null or funds_flow in ('organizer_mor', 'platform_mor')) and ((funds_flow = 'organizer_mor') = (connected_account_id is not null))`,
    ),
    check('invoice_payments_done_check', sql`(status = 'pending') = (completed_at is null)`),
    check('invoice_payments_reference_check', sql`reference is null or length(reference) between 1 and 80`),
    check('invoice_payments_note_check', sql`note is null or length(note) <= 500`),
    check('invoice_payments_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
  ],
);
