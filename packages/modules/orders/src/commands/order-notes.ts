import { actorId, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { orderNotes, orders } from '../schema.ts';

export const OrderNoteDto = z.object({
  id: z.uuid(),
  body: z.string(),
  /** `user:<id>`, `system:<name>`… (the console shows the member's name when it knows it). */
  authorId: z.string(),
  createdAt: z.date(),
});
export type OrderNoteDto = z.infer<typeof OrderNoteDto>;

/** Add an internal note to an order (M3.10b): support context on the order timeline, never shown to buyers. */
export const addOrderNoteCommand = tenantCommand({
  name: 'orders.addOrderNote',
  input: z.object({ orderId: z.uuid(), body: z.string().trim().min(1).max(2000) }),
  output: OrderNoteDto,
  entitlement: 'ticketing',
  permission: 'orders:note',
  handler: async ({ input, ctx, tx }) => {
    const [order] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, input.orderId));
    if (!order) throw new DomainError('not_found', 'Order not found');
    const [row] = await tx
      .insert(orderNotes)
      .values({
        orgId: requireOrg(ctx),
        orderId: order.id,
        body: input.body,
        authorId: actorId(ctx.actor),
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return row;
  },
  audit: (input, r) => ({
    action: 'order.note',
    targetType: 'order',
    targetId: input.orderId,
    data: { noteId: r?.id },
  }),
});

/** An order's notes, oldest first. */
export const orderNotesQuery = tenantQuery({
  name: 'orders.orderNotes',
  input: z.object({ orderId: z.uuid() }),
  output: z.array(OrderNoteDto),
  entitlement: 'ticketing',
  permission: 'orders:read',
  handler: async ({ input, tx }) =>
    tx
      .select()
      .from(orderNotes)
      .where(eq(orderNotes.orderId, input.orderId))
      .orderBy(asc(orderNotes.createdAt), asc(orderNotes.id))
      .limit(500),
});
