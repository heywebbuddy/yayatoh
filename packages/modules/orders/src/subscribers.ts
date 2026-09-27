import { findEventTx } from '@yayatoh/events';
import { defineSubscriber, keyVault, type Notifier } from '@yayatoh/platform';
import { ticketsForOrderTx } from '@yayatoh/ticketing';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { orders } from './schema.ts';

const Payload = z.object({ orgId: z.uuid(), orderId: z.uuid() });
const RefundPayload = z.object({
  orgId: z.uuid(),
  orderId: z.uuid(),
  refundId: z.uuid(),
  amountMinor: z.number().int(),
  currency: z.string(),
  fully: z.boolean(),
});

/** How long before the start the event reminder goes out (roadmap M1.10: reminder idempotency). */
export const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

// The locale came from the request; only a well-formed tag goes into a URL.
const localePrefix = (locale: string) =>
  locale !== 'en' && /^[a-z]{2}(-[A-Z]{2})?$/.test(locale) ? `/${locale}` : '';

async function manageUrl(appOrigin: string, orgId: string, order: typeof orders.$inferSelect) {
  if (!order.manageTokenCiphertext) return null;
  const token = new TextDecoder().decode(await keyVault().decrypt(orgId, order.manageTokenCiphertext));
  return `${appOrigin}${localePrefix(order.locale)}/orders/${token}`;
}

/**
 * When an order is paid (outbox → worker): queue the buyer's tickets email, the event reminder
 * (24 h before the start, one per buyer email and event, however many orders they placed) and
 * the "new order" alert for the org's sales team. The tickets link carries the manage token,
 * decrypted here from its envelope; it is never written to the event payload.
 */
export function ticketMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'orders.ticket-mailer',
    events: ['order.paid@1'],
    handle: async (tx, event) => {
      const p = Payload.parse(event.payload);
      const [order] = await tx.select().from(orders).where(eq(orders.id, p.orderId));
      if (!order) return;
      const ev = await findEventTx(tx, order.eventId);
      const tickets = await ticketsForOrderTx(tx, order.id);
      const to = {
        email: order.buyerEmail,
        name: order.buyerName,
        userId: order.buyerUserId,
        locale: order.locale,
        timeZone: ev?.timezone ?? null,
      };
      const url = await manageUrl(deps.appOrigin, p.orgId, order);
      // Orders created before tokens were stored encrypted have no link to send.
      if (url) {
        await deps.notifier.enqueue(tx, {
          kind: 'orders.tickets',
          to,
          params: { url, name: order.buyerName, eventName: ev?.name ?? '', count: tickets.length },
          dedupeKey: `order-tickets:${order.id}`,
          orderId: order.id,
          eventId: order.eventId,
        });
        const remindAt = ev ? new Date(ev.startsAt.getTime() - REMINDER_LEAD_MS) : null;
        if (ev && remindAt && remindAt.getTime() > Date.now())
          await deps.notifier.enqueue(tx, {
            kind: 'events.reminder',
            to,
            params: {
              url,
              name: order.buyerName,
              eventName: ev.name,
              startsAt: ev.startsAt.toISOString(),
              timeZone: ev.timezone,
              venue: ev.venueName ?? '',
            },
            dedupeKey: `event-reminder:${ev.id}:${order.buyerEmail.trim().toLowerCase()}`,
            orderId: order.id,
            eventId: ev.id,
            sendAfter: remindAt,
          });
      }
      await deps.notifier.notifyMembers(tx, {
        kind: 'sales.order_paid',
        params: {
          name: order.buyerName,
          eventName: ev?.name ?? '',
          count: tickets.length,
          amountMinor: order.totalMinor,
          currency: order.currency,
        },
        dedupeKey: `order-paid:${order.id}`,
        href: ev ? `/e/${ev.slug}/orders/${order.id}` : null,
        orderId: order.id,
        eventId: order.eventId,
      });
    },
  });
}

/** Tells the buyer about a refund once the provider confirmed it. */
export function refundMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'orders.refund-mailer',
    events: ['order.refunded@1'],
    handle: async (tx, event) => {
      const p = RefundPayload.parse(event.payload);
      const [order] = await tx.select().from(orders).where(eq(orders.id, p.orderId));
      if (!order) return;
      const ev = await findEventTx(tx, order.eventId);
      const url = await manageUrl(deps.appOrigin, p.orgId, order);
      await deps.notifier.enqueue(tx, {
        kind: 'orders.refund',
        to: {
          email: order.buyerEmail,
          name: order.buyerName,
          userId: order.buyerUserId,
          locale: order.locale,
          timeZone: ev?.timezone ?? null,
        },
        params: {
          url: url ?? '',
          name: order.buyerName,
          eventName: ev?.name ?? '',
          amountMinor: p.amountMinor,
          currency: p.currency,
          fully: p.fully ? 'yes' : 'no',
        },
        dedupeKey: `order-refund:${p.refundId}`,
        orderId: order.id,
        eventId: order.eventId,
      });
    },
  });
}
