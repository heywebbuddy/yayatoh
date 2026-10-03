import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, integer, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { orders, ordersSchema } from './schema.ts';

/**
 * M5.4b add-on orders: an order with one add-on line and no tickets, for things the organizer
 * sells that are not admissions (a sponsor package, extra lead licenses). The line names what it
 * pays for (`kind` + `ref_id`, a row of the module that sells it: program, a lower tier, so no FK);
 * a verified payment activates it in the same transaction (`payAddonOrderTx`).
 */
const minor = (name: string) => bigint(name, { mode: 'number' });

export const ADDON_KINDS = ['sponsor_package', 'lead_licenses'] as const;
export type AddonKind = (typeof ADDON_KINDS)[number];

export const addonItems = tenantTable(
  ordersSchema,
  'addon_items',
  {
    orderId: uuid('order_id').notNull(),
    kind: text('kind').notNull(),
    refId: uuid('ref_id').notNull(),
    /** What the buyer saw ("Gold sponsorship", "Lead licenses"). */
    name: text('name').notNull(),
    quantity: integer('quantity').notNull(),
    unitFaceMinor: minor('unit_face_minor').notNull(),
    /** The platform fee on the whole line (today's per-ticket fee, absorbed by the organizer). */
    feeMinor: minor('fee_minor').notNull(),
    currency: text('currency').notNull(),
  },
  (t) => [
    uniqueIndex('addon_items_org_order_key').on(t.orgId, t.orderId),
    uniqueIndex('addon_items_org_ref_key').on(t.orgId, t.kind, t.refId),
    foreignKey({
      name: 'addon_items_order_fk',
      columns: [t.orgId, t.orderId],
      foreignColumns: [orders.orgId, orders.id],
    }).onDelete('cascade'),
    check('addon_items_kind_check', sql`kind in ('sponsor_package', 'lead_licenses')`),
    check('addon_items_quantity_check', sql`quantity between 1 and 100`),
    check('addon_items_amount_check', sql`unit_face_minor >= 1 and fee_minor >= 0`),
    check('addon_items_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('addon_items_name_check', sql`char_length(name) between 1 and 120`),
  ],
);
