import { recordTimelineTx } from '@yayatoh/crm';
import { createCtx } from '@yayatoh/kernel';
import { defineSubscriber, type Subscriber } from '@yayatoh/platform';
import { z } from 'zod';
import { orderRefTx } from './participation.ts';

const Paid = z.object({ orderId: z.uuid(), eventId: z.uuid(), totalMinor: z.int(), currency: z.string() });
const Refunded = z.object({ orderId: z.uuid(), refundId: z.uuid(), amountMinor: z.int(), currency: z.string() });

/**
 * The person timeline's orders and refunds (M6.1a): the buyer's paid orders and their refunds,
 * from the outbox into the crm projection (exactly once per order and refund). Takes replayed
 * legacy history too, like the participation projector.
 */
export function ordersTimeline(): Subscriber {
  return defineSubscriber({
    name: 'orders.timeline',
    events: ['order.paid@1', 'order.refunded@1'],
    acceptsReplayed: true,
    handle: async (tx, event) => {
      const ctx = createCtx({ orgId: event.orgId, actor: { type: 'system', name: 'orders.timeline' } });
      const at = new Date(event.occurredAt ?? Date.now());
      if (event.type === 'order.paid') {
        const p = Paid.parse(event.payload);
        const order = await orderRefTx(tx, p.orderId);
        if (!order?.buyerContactId) return;
        await recordTimelineTx(tx, ctx, [
          {
            contactId: order.buyerContactId,
            kind: 'order_paid',
            occurredAt: at,
            eventId: p.eventId,
            sourceRef: p.orderId,
            subject: { table: 'orders.orders', id: p.orderId },
            amountMinor: p.totalMinor,
            currency: p.currency,
          },
        ]);
        return;
      }
      const p = Refunded.parse(event.payload);
      const order = await orderRefTx(tx, p.orderId);
      if (!order?.buyerContactId) return;
      await recordTimelineTx(tx, ctx, [
        {
          contactId: order.buyerContactId,
          kind: 'order_refunded',
          occurredAt: at,
          eventId: order.eventId,
          sourceRef: p.refundId,
          subject: { table: 'orders.orders', id: p.orderId },
          amountMinor: p.amountMinor,
          currency: p.currency,
        },
      ]);
    },
  });
}
