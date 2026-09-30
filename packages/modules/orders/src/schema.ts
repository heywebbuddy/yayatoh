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
