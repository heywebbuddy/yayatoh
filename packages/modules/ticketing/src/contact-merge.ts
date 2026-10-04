import type { ContactReferenceOwner } from '@yayatoh/crm';
import { and, eq, inArray } from 'drizzle-orm';
import { couponRedemptions } from './schema.ts';

const TABLE = 'ticketing.coupon_redemptions';

/**
 * Contact merges (M6.1a, ADR 0023): a merged duplicate's coupon uses (U9) move to the person who
 * stays, so a per-buyer limit counts them together; an undo moves exactly the recorded ones back.
 */
export const ticketingContactOwner: ContactReferenceOwner = {
  module: 'ticketing',
  columns: [`${TABLE}.buyer_contact_id`],
  move: async (tx, _ctx, step) => {
    const rows = await tx
      .update(couponRedemptions)
      .set({ buyerContactId: step.toContactId })
      .where(eq(couponRedemptions.buyerContactId, step.fromContactId))
      .returning({ id: couponRedemptions.id });
    return { moved: rows.map((r) => ({ table: TABLE, id: r.id })) };
  },
  restore: async (tx, _ctx, step) => {
    const ids = step.rows.filter((r) => r.table === TABLE).map((r) => r.id);
    if (ids.length === 0) return [];
    const rows = await tx
      .update(couponRedemptions)
      .set({ buyerContactId: step.fromContactId })
      .where(and(eq(couponRedemptions.buyerContactId, step.toContactId), inArray(couponRedemptions.id, ids)))
      .returning({ id: couponRedemptions.id });
    return rows.map((r) => ({ table: TABLE, id: r.id }));
  },
};
