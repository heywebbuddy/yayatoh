import { findEventTx } from '@yayatoh/events';
import { defineSubscriber, type Notifier } from '@yayatoh/platform';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { invoicePath } from './commands/invoices.ts';
import { formatInvoiceNumber } from './domain/invoices.ts';
import { invoices, orders } from './schema.ts';

const Invoiced = z.object({ orgId: z.uuid(), orderId: z.uuid(), invoiceId: z.uuid() });

const localePrefix = (locale: string) =>
  locale !== 'en' && /^[a-z]{2}(-[A-Z]{2})?$/.test(locale) ? `/${locale}` : '';

/**
 * A pay-later invoice was issued (M5.1d): the buyer is sent its number, amount and due date, with
 * their own link to view it, download the PDF and pay all or part of it (transactional, once per
 * invoice). The link is the invoice's signed token; the event payload carries ids only.
 */
export function invoiceMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'orders.invoice-mailer',
    events: ['order.invoiced@1'],
    handle: async (tx, event) => {
      const p = Invoiced.parse(event.payload);
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, p.invoiceId));
      const [order] = await tx.select().from(orders).where(eq(orders.id, p.orderId));
      if (!inv || !order) return;
      const ev = await findEventTx(tx, inv.eventId);
      if (!ev) return;
      await deps.notifier.enqueue(tx, {
        kind: 'orders.invoice',
        to: {
          email: inv.buyerEmail,
          name: inv.buyerName,
          userId: order.buyerUserId,
          locale: order.locale,
          timeZone: ev.timezone,
        },
        params: {
          url: `${deps.appOrigin}${localePrefix(order.locale)}${invoicePath(ev.slug, inv.id)}`,
          name: inv.buyerName,
          eventName: ev.name,
          number: formatInvoiceNumber(inv.number),
          amountMinor: inv.totalMinor,
          currency: inv.currency,
          dueOn: inv.dueOn,
        },
        dedupeKey: `invoice:${inv.id}`,
        orderId: order.id,
        eventId: inv.eventId,
      });
    },
  });
}
