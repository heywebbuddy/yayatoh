import { KeysetAfter } from '@yayatoh/contracts';
import { type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { findEventTx, findOccurrenceTx } from '@yayatoh/events';
import { createCtx, DomainError } from '@yayatoh/kernel';
import { buyerOrderMessagesTx } from '@yayatoh/notifications';
import { tenantQuery } from '@yayatoh/platform';
import { organizationNameTx } from '@yayatoh/tenancy';
import { ticketsForOrderTx } from '@yayatoh/ticketing';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { hashManageToken, loadOrderTx } from './commands/checkout.ts';
import { eventRefundPolicyTx } from './commands/refund-policy.ts';
import { OrderDto, type PublicOrderDto, publicOrderSerializer } from './dto.ts';
import { ORDER_STATUSES, orderItems, orders } from './schema.ts';

export const listOrdersQuery = tenantQuery({
  name: 'orders.listOrders',
  input: z.object({
    eventId: z.uuid(),
    limit: z.int().min(1).max(200).default(50),
    /** Keyset position (newest first): rows strictly older than it. */
    after: KeysetAfter.optional(),
  }),
  output: z.array(OrderDto),
  entitlement: 'ticketing',
  permission: 'orders:read',
  handler: async ({ input, tx }) => {
    const createdMs = sql`date_trunc('milliseconds', ${orders.createdAt})`;
    const rows = await tx
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.eventId, input.eventId),
          input.after
            ? sql`(${createdMs}, ${orders.id}) < (${input.after.at.toISOString()}::timestamptz, ${input.after.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(createdMs), desc(orders.id))
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

export const OrderHitDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  status: z.enum(ORDER_STATUSES),
  buyerName: z.string(),
  buyerEmail: z.string(),
  currency: z.string(),
  totalMinor: z.int(),
  createdAt: z.date(),
});

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A contact's orders (as buyer), newest first: the contact timeline. */
export async function ordersForContactTx(tx: TenantTx, contactId: string) {
  return (
    await tx
      .select({
        id: orders.id,
        eventId: orders.eventId,
        status: orders.status,
        currency: orders.currency,
        totalMinor: orders.totalMinor,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(eq(orders.buyerContactId, contactId))
      .orderBy(desc(orders.createdAt))
      .limit(200)
  ).map((o) => ({ ...o, status: o.status as (typeof ORDER_STATUSES)[number] }));
}

/** Org-wide order search (the command palette): buyer name or email, or an order id prefix. */
export const searchOrdersQuery = tenantQuery({
  name: 'orders.search',
  input: z.object({ q: z.string().trim().min(2).max(200), limit: z.int().min(1).max(50).default(10) }),
  output: z.array(OrderHitDto),
  entitlement: 'ticketing',
  permission: 'orders:read',
  handler: async ({ input, tx }) => {
    const q = `%${escapeLike(input.q)}%`;
    const idPrefix = /^[0-9a-f-]{8,36}$/i.test(input.q) ? `${input.q.toLowerCase()}%` : null;
    return (
      await tx
        .select({
          id: orders.id,
          eventId: orders.eventId,
          status: orders.status,
          buyerName: orders.buyerName,
          buyerEmail: orders.buyerEmail,
          currency: orders.currency,
          totalMinor: orders.totalMinor,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .where(
          or(
            // The same ILIKE on buyer name/email, run by `orders.search_ids` so the trigram
            // indexes serve it under row-level security (migration 0051, M1.8f).
            sql`${orders.id} in (select orders.search_ids(${q}))`,
            idPrefix ? sql`${orders.id}::text like ${idPrefix}` : undefined,
          ),
        )
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(input.limit)
    ).map((r) => ({ ...r, status: r.status as (typeof ORDER_STATUSES)[number] }));
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
      // Tickets passed on to someone else (claim links) belong to their new holder: the buyer's
      // page no longer shows their codes, only how many were passed on.
      const all = await ticketsForOrderTx(tx, ref.order_id);
      const buyer = o.buyerEmail.trim().toLowerCase();
      // Voided (refunded) tickets no longer work: no QR for them.
      const live = all.filter((t) => t.status === 'active');
      const mine = live.filter((t) => t.holderEmail.trim().toLowerCase() === buyer);
      // Multi-date events: every ticket shows the date it admits (M1.4b).
      const dates = new Map<string, { startsAt: Date; endsAt: Date }>();
      for (const id of new Set(mine.flatMap((t) => (t.occurrenceId ? [t.occurrenceId] : [])))) {
        const occ = await findOccurrenceTx(tx, id);
        if (occ) dates.set(id, { startsAt: occ.startsAt, endsAt: occ.endsAt });
      }
      return {
        ...o,
        tickets: mine.map((t) => ({
          ...t,
          date: t.occurrenceId ? (dates.get(t.occurrenceId) ?? null) : null,
        })),
        transferred: live.length - mine.length,
        event: { ...ev, organizerName: (await organizationNameTx(tx, ref.org_id)) ?? '' },
        messages: await buyerOrderMessagesTx(tx, ref.order_id, o.buyerEmail),
        refundPolicy: await eventRefundPolicyTx(tx, o.eventId),
      };
    });
    return publicOrderSerializer.serialize(order);
  } catch (err) {
    if (err instanceof DomainError && err.code === 'not_found') return null;
    throw err;
  }
}

/**
 * M1.4d: the event a manage-token link proves ticket holding for (the buyer still holds at least
 * one live ticket), so the order page can show holder-only content. Server-side only.
 */
export async function orderHolderTarget(token: string): Promise<{ orgId: string; eventId: string } | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const refs = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; order_id: string }>(
      sql`select org_id, order_id from orders.order_ref_by_token(${hashManageToken(token)})`,
    ),
  );
  const ref = refs[0];
  if (!ref) return null;
  const ctx = createCtx({ orgId: ref.org_id, actor: { type: 'system', name: 'orders.manage-link' } });
  return withTenant(ctx, async (tx) => {
    const o = await loadOrderTx(tx, ref.order_id).catch(() => null);
    if (!o) return null;
    const buyer = o.buyerEmail.trim().toLowerCase();
    const holds = (await ticketsForOrderTx(tx, ref.order_id)).some(
      (t) => t.status === 'active' && t.holderEmail.trim().toLowerCase() === buyer,
    );
    return holds ? { orgId: ref.org_id, eventId: o.eventId } : null;
  });
}

export const OrganizerTicketDto = z.object({
  id: z.uuid(),
  serial: z.int(),
  shortCode: z.string(),
  status: z.string(),
  holderName: z.string(),
  holderEmail: z.string(),
  itemName: z.string(),
  seatLabel: z.string().nullable(),
});

/** One order as the organizer sees it: the order, its tickets (who holds them, void or not). */
export const orderDetailQuery = tenantQuery({
  name: 'orders.orderDetail',
  input: z.object({ orderId: z.uuid() }),
  output: OrderDto.extend({
    fundsFlow: z.enum(['organizer_mor', 'platform_mor']),
    collectedBy: z.enum(['platform', 'organizer']),
    paymentMethod: z.string().nullable(),
    paymentReference: z.string().nullable(),
    createdVia: z.string(),
    tickets: z.array(OrganizerTicketDto),
    /** M1.6e: checkout risk rules that asked for a review. */
    riskReview: z.array(z.string()),
    /** organizer_mor: the org's own connected account the charge is on (disputes are answered there). */
    connectedAccountId: z.string().nullable(),
  }),
  entitlement: 'ticketing',
  permission: 'orders:read',
  handler: async ({ input, tx }) => {
    const order = await loadOrderTx(tx, input.orderId);
    const names = new Map(order.items.map((i) => [i.id, i.name]));
    const tickets = (await ticketsForOrderTx(tx, order.id)).map((t) => ({
      id: t.id,
      serial: t.serial,
      shortCode: t.shortCode,
      status: t.status,
      holderName: t.holderName,
      holderEmail: t.holderEmail,
      itemName: names.get(t.orderItemId) ?? '',
      seatLabel: t.seatLabel,
    }));
    return {
      ...order,
      fundsFlow: order.fundsFlow as 'organizer_mor' | 'platform_mor',
      collectedBy: order.collectedBy as 'platform' | 'organizer',
      tickets,
      riskReview: order.riskReview ?? [],
    };
  },
});

/**
 * What a buyer holds, from their manage link, inside the caller's tenant transaction (reviews,
 * M1.4g): the order, its event, and the buyer's own live tickets with the instant each one's
 * date ends (the ticket's date for multi-date events, else the event's end). Null when the token
 * is not an order of this org.
 */
export async function orderHoldingTx(
  tx: TenantTx,
  token: string,
): Promise<{
  orderId: string;
  eventId: string;
  buyerEmail: string;
  buyerName: string;
  liveTicketEnds: Date[];
} | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const [o] = await tx
    .select({
      id: orders.id,
      eventId: orders.eventId,
      buyerEmail: orders.buyerEmail,
      buyerName: orders.buyerName,
    })
    .from(orders)
    .where(eq(orders.manageTokenHash, hashManageToken(token)));
  if (!o) return null;
  const ev = await findEventTx(tx, o.eventId);
  if (!ev) return null;
  const buyer = o.buyerEmail.trim().toLowerCase();
  const mine = (await ticketsForOrderTx(tx, o.id)).filter(
    (t) => t.status === 'active' && t.holderEmail.trim().toLowerCase() === buyer,
  );
  const liveTicketEnds: Date[] = [];
  for (const t of mine) {
    const occ = t.occurrenceId ? await findOccurrenceTx(tx, t.occurrenceId) : null;
    liveTicketEnds.push(occ?.endsAt ?? ev.endsAt);
  }
  return {
    orderId: o.id,
    eventId: o.eventId,
    buyerEmail: o.buyerEmail,
    buyerName: o.buyerName,
    liveTicketEnds,
  };
}
