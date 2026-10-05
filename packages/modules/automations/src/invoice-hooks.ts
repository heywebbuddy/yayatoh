import { orderRefTx } from '@yayatoh/orders';
import { defineSubscriber, type PublishedEvent } from '@yayatoh/platform';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { cancelRunsTx, enrollTx, journeysForEventTx, runsOfOrder } from './lifecycle.ts';
import { journeyRuns } from './schema.ts';

const when = (event: PublishedEvent) => (event.occurredAt ? new Date(event.occurredAt) : new Date());

const Invoiced = z.object({ orgId: z.uuid(), orderId: z.uuid(), eventId: z.uuid(), dueAt: z.iso.datetime() });
const OrderRef = z.object({ orgId: z.uuid(), orderId: z.uuid() });

/** An order's invoice-reminder runs (not the purchase journeys the same order may start). */
export const invoiceRunsOfOrder = (orderId: string) =>
  and(runsOfOrder(orderId), eq(journeyRuns.trigger, 'invoice_issued'));

/**
 * Invoice reminders (M5.1d, P5-5) on journeys: an issued invoice enrolls its buyer on the event's
 * `invoice_issued` journeys (steps wait from the invoice's due date); paying it in full or the
 * organizer voiding it cancels what is still pending (`invoice_paid` / `invoice_void`), so a paid
 * invoice is never chased. Replayed history never enrolls or cancels (ADR 0008).
 */
export function journeyInvoiceHooks() {
  return defineSubscriber({
    name: 'automations.journey-invoices',
    events: ['order.invoiced@1', 'order.paid@1', 'order.voided@1'],
    handle: async (tx, event) => {
      if (event.replayed) return;
      const now = new Date();
      if (event.type === 'order.invoiced') {
        const p = Invoiced.parse(event.payload);
        const order = await orderRefTx(tx, p.orderId);
        if (!order?.buyerContactId) return;
        for (const journey of await journeysForEventTx(tx, p.eventId, 'invoice_issued'))
          await enrollTx(
            tx,
            p.orgId,
            {
              journey,
              eventId: p.eventId,
              occurrenceId: order.occurrenceId,
              contactId: order.buyerContactId,
              orderId: p.orderId,
              triggeredAt: when(event),
              locale: order.locale,
              dueAt: new Date(p.dueAt),
            },
            now,
          );
        return;
      }
      const p = OrderRef.parse(event.payload);
      await cancelRunsTx(
        tx,
        invoiceRunsOfOrder(p.orderId),
        event.type === 'order.paid' ? 'invoice_paid' : 'invoice_void',
        now,
      );
    },
  });
}
