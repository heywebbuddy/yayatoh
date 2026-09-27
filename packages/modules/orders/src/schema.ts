import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
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
    /** The manage token, envelope-encrypted (KeyVault) so the worker can email the link. */
    manageTokenCiphertext: text('manage_token_ciphertext'),
    createdVia: text('created_via').notNull().default('web'),
    expiresAt: ts('expires_at'),
    paidAt: ts('paid_at'),
    cancelledAt: ts('cancelled_at'),
  },
  (t) => [
    index('orders_org_event_created_idx').on(t.orgId, t.eventId, t.createdAt),
    index('orders_org_status_expires_idx').on(t.orgId, t.status, t.expiresAt),
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
