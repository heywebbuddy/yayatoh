import { withoutTenant, withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { createCtx, DomainError } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { organizationNameTx } from '@yayatoh/tenancy';
import { ticketsForOrderTx } from '@yayatoh/ticketing';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { hashManageToken, loadOrderTx } from './commands/checkout.ts';
import { OrderDto, type PublicOrderDto, publicOrderSerializer } from './dto.ts';
import { orderItems, orders } from './schema.ts';

export const listOrdersQuery = tenantQuery({
  name: 'orders.listOrders',
  input: z.object({ eventId: z.uuid(), limit: z.int().min(1).max(200).default(50) }),
  output: z.array(OrderDto),
  entitlement: 'ticketing',
  permission: 'orders:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select()
      .from(orders)
      .where(eq(orders.eventId, input.eventId))
      .orderBy(desc(orders.createdAt))
      .limit(input.limit);
    const items = rows.length
      ? await tx
          .select()
          .from(orderItems)
          .where(
            inArray(
              orderItems.orderId,
              rows.map((r) => r.id),
            ),
          )
      : [];
    return rows.map((r) => ({ ...r, items: items.filter((i) => i.orderId === r.id) }));
  },
});

/**
 * A guest's order via their manage token. The token is hashed, resolved to (org, order) by a
 * SECURITY DEFINER function, then read under that org's RLS and allowlisted.
 */
export async function orderByManageToken(token: string): Promise<PublicOrderDto | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const refs = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; order_id: string }>(
      sql`select org_id, order_id from orders.order_ref_by_token(${hashManageToken(token)})`,
    ),
  );
  const ref = refs[0];
  if (!ref) return null;
  const ctx = createCtx({ orgId: ref.org_id, actor: { type: 'system', name: 'orders.manage-link' } });
  try {
    const order = await withTenant(ctx, async (tx) => {
      const o = await loadOrderTx(tx, ref.order_id);
      const ev = await findEventTx(tx, o.eventId);
      if (!ev) throw new DomainError('not_found');
      return {
        ...o,
        tickets: await ticketsForOrderTx(tx, ref.order_id),
        event: { ...ev, organizerName: (await organizationNameTx(tx, ref.org_id)) ?? '' },
      };
    });
    return publicOrderSerializer.serialize(order);
  } catch (err) {
    if (err instanceof DomainError && err.code === 'not_found') return null;
    throw err;
  }
}
