import { DomainError } from '@yayatoh/kernel';
import { claimProviderEventTx, closeDisputeTx, openDisputeTx } from '@yayatoh/payments';
import { tenantCommand } from '@yayatoh/platform';
import { releaseAttendeeSeatsTx, voidSeatTx } from '@yayatoh/seating';
import { ticketsForOrderTx, voidTicketsTx } from '@yayatoh/ticketing';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { orderLifecycle } from '../domain/lifecycle.ts';
import { orders } from '../schema.ts';

/**
 * A verified dispute webhook (M1.6d), deduplicated by provider event id. Created: the disputed
 * amount is held from the organizer's funds (payments). Closed and lost: the buyer keeps the money,
 * so the order's tickets are voided and it counts as refunded. Closed and won: the hold is undone.
 */
export const applyDisputeEventCommand = tenantCommand({
  name: 'orders.applyDisputeEvent',
  input: z.object({
    provider: z.enum(['fake', 'stripe']),
    id: z.string().min(1).max(255),
    type: z.enum(['dispute.created', 'dispute.closed']),
    orgId: z.uuid(),
    providerPaymentId: z.string().min(1),
    providerDisputeId: z.string().min(1).max(255),
    amountMinor: z.int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    reason: z.string().max(100),
    outcome: z.enum(['won', 'lost']).optional(),
    evidenceDueBy: z.coerce.date().optional(),
  }),
  output: z.object({ outcome: z.enum(['applied', 'duplicate']), status: z.string() }),
  entitlement: null,
  permission: 'platform:payments.webhook',
  handler: async ({ input, ctx, tx, emit }) => {
    if (!(await claimProviderEventTx(tx, input)))
      return { outcome: 'duplicate' as const, status: 'unchanged' };
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.provider, input.provider), eq(orders.providerPaymentId, input.providerPaymentId)))
      .for('update');
    if (!order) throw new DomainError('not_found', 'No order for this payment');
    if (input.currency !== order.currency || input.amountMinor > order.totalMinor)
      throw new DomainError('conflict', 'Dispute does not match the order');
    if (input.type === 'dispute.created') {
      const { row, created } = await openDisputeTx(tx, ctx, {
        orderId: order.id,
        eventId: order.eventId,
        fundsFlow: order.fundsFlow as 'organizer_mor' | 'platform_mor',
        provider: input.provider,
        providerDisputeId: input.providerDisputeId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        reason: input.reason,
        evidenceDueBy: input.evidenceDueBy ?? null,
      });
      if (created)
        emit({
          type: 'order.disputed',
          version: 1,
          aggregateType: 'order',
          aggregateId: order.id,
          payload: {
            orgId: order.orgId,
            orderId: order.id,
            disputeId: row.id,
            amountMinor: input.amountMinor,
          },
        });
      return { outcome: 'applied' as const, status: row.status };
    }
    if (!input.outcome) throw new DomainError('validation_failed', 'A closed dispute needs an outcome');
    const { row, changed } = await closeDisputeTx(tx, ctx, {
      provider: input.provider,
      providerDisputeId: input.providerDisputeId,
      outcome: input.outcome,
    });
    if (changed && input.outcome === 'lost') {
      const live = (await ticketsForOrderTx(tx, order.id))
        .filter((t) => t.status === 'active')
        .map((t) => t.id);
      const voided = await voidTicketsTx(tx, ctx, {
        orderId: order.id,
        ticketIds: live,
        reason: 'dispute_lost',
      });
      for (const t of voided) await voidSeatTx(tx, ctx, t.id);
      await releaseAttendeeSeatsTx(
        tx,
        ctx,
        voided.flatMap((t) => (t.attendeeId ? [t.attendeeId] : [])),
      );
      if (orderLifecycle.can(order.status as never, 'refund'))
        await tx
          .update(orders)
          .set({ status: 'refunded', updatedAt: ctx.now })
          .where(eq(orders.id, order.id));
    }
    if (changed)
      emit({
        type: 'order.dispute_closed',
        version: 1,
        aggregateType: 'order',
        aggregateId: order.id,
        payload: { orgId: order.orgId, orderId: order.id, disputeId: row.id, outcome: input.outcome },
      });
    return { outcome: 'applied' as const, status: row.status };
  },
  audit: (input, r) => ({
    action: 'order.dispute_event',
    targetType: 'order',
    targetId: null,
    data: {
      eventId: input.id,
      type: input.type,
      outcome: r?.outcome,
      providerDisputeId: input.providerDisputeId,
    },
  }),
});
