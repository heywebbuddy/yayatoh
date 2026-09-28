import { withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { createCtx } from '@yayatoh/kernel';
import { keyVault } from '@yayatoh/platform';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { orders } from './schema.ts';

/**
 * A signed-in person's own orders at one organizer (M1.2f: "Your tickets" on the tenant site).
 * Only orders they placed while signed in (`buyer_user_id`), in the org the host belongs to;
 * allowlisted fields, and the order's own manage token so the page can link to it (the person
 * is the buyer; the token is the same link their confirmation email holds).
 */
export const BuyerOrderDto = z.object({
  orderId: z.uuid(),
  status: z.enum(['paid', 'partially_refunded', 'refunded', 'awaiting_payment']),
  eventName: z.string(),
  eventSlug: z.string(),
  startsAt: z.date(),
  timezone: z.string(),
  placedAt: z.date(),
  manageToken: z.string().nullable(),
});
export type BuyerOrderDto = z.infer<typeof BuyerOrderDto>;

const SHOWN = ['paid', 'partially_refunded', 'refunded', 'awaiting_payment'] as const;

export async function buyerOrdersInOrg(orgId: string, userId: string, limit = 50): Promise<BuyerOrderDto[]> {
  return withTenant(createCtx({ orgId, actor: { type: 'user', userId } }), async (tx) => {
    const rows = await tx
      .select({
        id: orders.id,
        eventId: orders.eventId,
        status: orders.status,
        createdAt: orders.createdAt,
        manageTokenCiphertext: orders.manageTokenCiphertext,
      })
      .from(orders)
      .where(and(eq(orders.buyerUserId, userId), inArray(orders.status, [...SHOWN])))
      .orderBy(desc(orders.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200));
    const events = new Map<string, Awaited<ReturnType<typeof findEventTx>>>();
    for (const id of new Set(rows.map((r) => r.eventId))) events.set(id, await findEventTx(tx, id));
    const out: BuyerOrderDto[] = [];
    for (const r of rows) {
      const ev = events.get(r.eventId);
      if (!ev) continue;
      const manageToken = r.manageTokenCiphertext
        ? new TextDecoder().decode(await keyVault().decrypt(orgId, r.manageTokenCiphertext))
        : null;
      out.push(
        BuyerOrderDto.parse({
          orderId: r.id,
          status: r.status,
          eventName: ev.name,
          eventSlug: ev.slug,
          startsAt: ev.startsAt,
          timezone: ev.timezone,
          placedAt: r.createdAt,
          manageToken,
        }),
      );
    }
    return out;
  });
}
