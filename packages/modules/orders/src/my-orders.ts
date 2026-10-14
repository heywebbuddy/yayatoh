import { defineSerializer } from '@yayatoh/contracts';
import { withoutTenant, withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { createCtx } from '@yayatoh/kernel';
import { keyVault } from '@yayatoh/platform';
import { organizationNameTx } from '@yayatoh/tenancy';
import { ticketsForOrderTx } from '@yayatoh/ticketing';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { loadOrderTx } from './commands/checkout.ts';
import { orderRefundPolicyTx } from './commands/refund-policy.ts';
import { buyerRefundPanelTx } from './commands/refund-requests.ts';
import { BuyerRefundPanelDto, OrderItemDto, RefundPolicyDto } from './dto.ts';
import { GUEST_VISIBLE_STATUSES } from './guest/orders.ts';
import { normalizeGuestEmail } from './guest/otp.ts';
import { ORDER_STATUSES, orders } from './schema.ts';

/**
 * A person's own order for the attendee app (M7.2b): an order bought by their verified email, found
 * through the same SECURITY DEFINER lookup as the web's "My tickets" (`orders.order_refs_by_email`)
 * and then read under that org's RLS. The list is `guestOrders` itself (one source for the web and
 * the app); this adds the detail and the manage-link credential the refund command wants, which
 * never leaves the server.
 */
export const MyOrderDetailDto = z.object({
  id: z.uuid(),
  orgId: z.uuid(),
  orgName: z.string(),
  eventId: z.uuid(),
  event: z.object({
    slug: z.string(),
    name: z.string(),
    startsAt: z.date(),
    endsAt: z.date(),
    timezone: z.string(),
  }),
  status: z.enum(ORDER_STATUSES),
  currency: z.string(),
  subtotalMinor: z.int(),
  discountMinor: z.int(),
  feeMinor: z.int(),
  totalMinor: z.int(),
  paidAt: z.date().nullable(),
  createdAt: z.date(),
  items: z.array(OrderItemDto),
  /** The refund terms the order was bought under (or a looser current one); null when none is set. */
  refundPolicy: RefundPolicyDto.nullable(),
  /** The latest refund request and whether the person may ask now. */
  refundRequest: BuyerRefundPanelDto,
  /** The order's tickets the person still holds (active). */
  ticketIds: z.array(z.uuid()),
  /** Tickets of this order now held by someone else (passed on). */
  transferred: z.int(),
});
export type MyOrderDetailDto = z.infer<typeof MyOrderDetailDto>;
export const myOrderDetailSerializer = defineSerializer('orders.myOrderDetail', MyOrderDetailDto);

async function refOf(email: string, orderId: string): Promise<string | null> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; order_id: string }>(
      sql`select org_id, order_id from orders.order_refs_by_email(${email})`,
    ),
  );
  return [...rows].find((r) => r.order_id === orderId)?.org_id ?? null;
}

const actor = { type: 'system' as const, name: 'orders.my-orders' };

/** One order of the person, or null when it is not an order their verified address bought. */
export async function myOrderDetail(rawEmail: string, orderId: string): Promise<MyOrderDetailDto | null> {
  const email = normalizeGuestEmail(rawEmail);
  const orgId = await refOf(email, orderId);
  if (!orgId) return null;
  const ctx = createCtx({ orgId, actor });
  return withTenant(ctx, async (tx) => {
    const o = await loadOrderTx(tx, orderId).catch(() => null);
    if (!o || o.buyerEmail.trim().toLowerCase() !== email) return null;
    if (!(GUEST_VISIBLE_STATUSES as readonly string[]).includes(o.status)) return null;
    const ev = await findEventTx(tx, o.eventId);
    if (!ev) return null;
    const all = await ticketsForOrderTx(tx, o.id);
    const mine = all.filter((t) => t.status === 'active' && t.holderEmail.trim().toLowerCase() === email);
    return myOrderDetailSerializer.serialize({
      id: o.id,
      orgId,
      orgName: (await organizationNameTx(tx, orgId)) ?? '',
      eventId: o.eventId,
      event: {
        slug: ev.slug,
        name: ev.name,
        startsAt: ev.startsAt,
        endsAt: ev.endsAt,
        timezone: ev.timezone,
      },
      status: o.status,
      currency: o.currency,
      subtotalMinor: o.subtotalMinor,
      discountMinor: o.discountMinor,
      feeMinor: o.feeMinor,
      totalMinor: o.totalMinor,
      paidAt: o.paidAt,
      createdAt: o.createdAt,
      items: o.items,
      refundPolicy: await orderRefundPolicyTx(tx, o),
      refundRequest: await buyerRefundPanelTx(tx, ctx, o),
      ticketIds: mine.map((t) => t.id),
      transferred: all.filter((t) => t.status === 'active').length - mine.length,
    });
  });
}

/**
 * The org and manage-link token of an order the person bought: the credential
 * `orders.requestRefund` takes, decrypted from the order's envelope. Server-side only; null when
 * the order is not theirs.
 */
export async function myOrderRefundTarget(
  rawEmail: string,
  orderId: string,
): Promise<{ orgId: string; manageToken: string } | null> {
  const email = normalizeGuestEmail(rawEmail);
  const orgId = await refOf(email, orderId);
  if (!orgId) return null;
  const [row] = await withTenant(createCtx({ orgId, actor }), (tx) =>
    tx
      .select({ buyerEmail: orders.buyerEmail, ciphertext: orders.manageTokenCiphertext })
      .from(orders)
      .where(eq(orders.id, orderId)),
  );
  if (!row?.ciphertext || row.buyerEmail.trim().toLowerCase() !== email) return null;
  return {
    orgId,
    manageToken: new TextDecoder().decode(await keyVault().decrypt(orgId, row.ciphertext)),
  };
}
