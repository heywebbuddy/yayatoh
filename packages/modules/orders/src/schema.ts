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
    locale: text('locale').notNull().default('en'),
    currency: text('currency').notNull(),
    subtotalMinor: minor('subtotal_minor').notNull(),
    feeMinor: minor('fee_minor').notNull(),
    totalMinor: minor('total_minor').notNull(),
    fundsFlow: text('funds_flow').notNull(),
    feeSchedule: jsonb('fee_schedule').notNull(),
    provider: text('provider'),
    providerPaymentId: text('provider_payment_id'),
    manageTokenHash: text('manage_token_hash').notNull(),
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
    check('orders_funds_flow_check', sql`funds_flow in ('organizer_mor', 'platform_mor')`),
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
  ],
);
