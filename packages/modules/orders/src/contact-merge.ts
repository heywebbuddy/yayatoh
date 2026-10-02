import type { ContactReferenceOwner } from '@yayatoh/crm';
import { and, eq, inArray } from 'drizzle-orm';
import { orders } from './schema.ts';

const TABLE = 'orders.orders';

/**
 * Contact merges (M6.1a, ADR 0022): the orders a merged duplicate bought move to the person who stays; an undo moves exactly
 * the recorded ones back. Only this module writes its table.
 */
export const ordersContactOwner: ContactReferenceOwner = {
  module: 'orders',
  columns: [`${TABLE}.buyer_contact_id`],
  move: async (tx, _ctx, step) => {
    const rows = await tx
      .update(orders)
      .set({ buyerContactId: step.toContactId })
      .where(eq(orders.buyerContactId, step.fromContactId))
      .returning({ id: orders.id });
    return { moved: rows.map((r) => ({ table: TABLE, id: r.id })) };
  },
  restore: async (tx, _ctx, step) => {
    const ids = step.rows.filter((r) => r.table === TABLE).map((r) => r.id);
    if (ids.length === 0) return [];
    const rows = await tx
      .update(orders)
      .set({ buyerContactId: step.fromContactId })
      .where(and(eq(orders.buyerContactId, step.toContactId), inArray(orders.id, ids)))
      .returning({ id: orders.id });
    return rows.map((r) => ({ table: TABLE, id: r.id }));
  },
};
