import { findEventTx } from '@yayatoh/events';
import { defineSubscriber, keyVault, type Mailer } from '@yayatoh/platform';
import { ticketsForOrderTx } from '@yayatoh/ticketing';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { orders } from './schema.ts';

const Payload = z.object({ orgId: z.uuid(), orderId: z.uuid() });

/**
 * Emails the buyer their tickets link when an order is paid (outbox → worker). The link carries
 * the manage token, decrypted here from its envelope; it is never written to the event payload.
 */
export function ticketMailer(deps: { mailer: Mailer; appOrigin: string }) {
  return defineSubscriber({
    name: 'orders.ticket-mailer',
    events: ['order.paid@1'],
    handle: async (tx, event) => {
      const p = Payload.parse(event.payload);
      const [order] = await tx.select().from(orders).where(eq(orders.id, p.orderId));
      // Orders created before tokens were stored encrypted have no link to send.
      if (!order?.manageTokenCiphertext) return;
      const token = new TextDecoder().decode(await keyVault().decrypt(p.orgId, order.manageTokenCiphertext));
      const ev = await findEventTx(tx, order.eventId);
      const tickets = await ticketsForOrderTx(tx, order.id);
      // The locale came from the request; only a well-formed tag goes into the URL.
      const prefix =
        order.locale !== 'en' && /^[a-z]{2}(-[A-Z]{2})?$/.test(order.locale) ? `/${order.locale}` : '';
      await deps.mailer.send({
        to: order.buyerEmail,
        template: 'orders.tickets',
        locale: order.locale,
        params: {
          url: `${deps.appOrigin}${prefix}/orders/${token}`,
          name: order.buyerName,
          eventName: ev?.name ?? '',
          count: tickets.length,
        },
        idempotencyKey: `order-tickets:${order.id}`,
      });
    },
  });
}
