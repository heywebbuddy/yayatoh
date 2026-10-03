import { attendeeContactIdsTx, participationAttendeesTx } from '@yayatoh/attendees';
import type { TenantTx } from '@yayatoh/db';
import { orderRefTx } from '@yayatoh/orders';
import { defineSubscriber, type PublishedEvent } from '@yayatoh/platform';
import { z } from 'zod';
import { journeyInvoiceHooks } from './invoice-hooks.ts';
import {
  cancelRunsTx,
  enrollTx,
  journeysForEventTx,
  rescheduleEventTx,
  runsOfContactsWhere,
  runsOfEvent,
  runsOfOrder,
} from './lifecycle.ts';
import { rsvpReminderHooks } from './rsvp-reminders.ts';

/**
 * Journey subscribers (M3.7a). None of them accepts `replayed` events (ADR 0008): backfilled
 * history (the legacy migration) never enrolls anyone, never cancels and never moves a step —
 * `consumeEvent` records such events as handled without calling these, and each handler checks
 * the flag again.
 */

const when = (event: PublishedEvent) => (event.occurredAt ? new Date(event.occurredAt) : new Date());

const OrderPaid = z.object({ orgId: z.uuid(), orderId: z.uuid() });
const Admitted = z.object({
  orgId: z.uuid(),
  eventId: z.uuid(),
  ticketId: z.uuid(),
  admittedAt: z.iso.datetime().optional(),
});

/** Triggers: an order paid (the buyer) and a check-in (the ticket's holder). */
export function journeyTriggers() {
  return defineSubscriber({
    name: 'automations.journey-triggers',
    events: ['order.paid@1', 'ticket.admitted@1'],
    handle: async (tx, event) => {
      if (event.replayed) return;
      const now = new Date();
      if (event.type === 'order.paid') {
        const p = OrderPaid.parse(event.payload);
        const order = await orderRefTx(tx, p.orderId);
        if (!order?.buyerContactId) return;
        for (const journey of await journeysForEventTx(tx, order.eventId, 'order_paid'))
          await enrollTx(
            tx,
            p.orgId,
            {
              journey,
              eventId: order.eventId,
              occurrenceId: order.occurrenceId,
              contactId: order.buyerContactId,
              orderId: p.orderId,
              triggeredAt: when(event),
              locale: order.locale,
            },
            now,
          );
        return;
      }
      const p = Admitted.parse(event.payload);
      const journeys = await journeysForEventTx(tx, p.eventId, 'checked_in');
      if (journeys.length === 0) return;
      const [contactId] = await attendeeContactIdsTx(tx, { ticketIds: [p.ticketId] });
      if (!contactId) return;
      for (const journey of journeys)
        await enrollTx(
          tx,
          p.orgId,
          {
            journey,
            eventId: p.eventId,
            contactId,
            triggeredAt: p.admittedAt ? new Date(p.admittedAt) : when(event),
          },
          now,
        );
    },
  });
}

const Refunded = z.object({ orgId: z.uuid(), orderId: z.uuid(), fully: z.boolean() });
const TicketsCancelled = z.object({ orgId: z.uuid(), eventId: z.uuid(), ticketIds: z.array(z.uuid()) });
const AttendeeCancelled = z.object({ orgId: z.uuid(), eventId: z.uuid(), attendeeId: z.uuid() });
const EventRef = z.object({ orgId: z.uuid(), eventId: z.uuid(), occurrenceId: z.uuid().optional() });

/** People who no longer hold an active place at the event (their last ticket or guest spot went). */
async function goneTx(tx: TenantTx, eventId: string, contactIds: readonly string[]) {
  if (contactIds.length === 0) return [];
  const active = new Set(
    (await participationAttendeesTx(tx, eventId, contactIds))
      .filter((a) => a.status === 'active')
      .map((a) => a.contactId),
  );
  return contactIds.filter((c) => !active.has(c));
}

/**
 * Cancellation hooks: a full refund cancels the runs that order started; a cancelled ticket or
 * guest spot cancels the person's runs once they hold nothing at the event; a cancelled event (or
 * date) cancels every run for it. Pending steps become `cancelled`; what ran stays.
 */
export function journeyCancellations() {
  return defineSubscriber({
    name: 'automations.journey-cancellations',
    events: [
      'order.refunded@1',
      'tickets.cancelled@1',
      'attendee.cancelled@1',
      'event.cancelled@1',
      'event.occurrence_cancelled@1',
    ],
    handle: async (tx, event) => {
      if (event.replayed) return;
      const now = new Date();
      switch (event.type) {
        case 'order.refunded': {
          const p = Refunded.parse(event.payload);
          if (p.fully) await cancelRunsTx(tx, runsOfOrder(p.orderId), 'order_refunded', now);
          return;
        }
        case 'tickets.cancelled': {
          const p = TicketsCancelled.parse(event.payload);
          const gone = await goneTx(
            tx,
            p.eventId,
            await attendeeContactIdsTx(tx, { ticketIds: p.ticketIds }),
          );
          if (gone.length)
            await cancelRunsTx(tx, runsOfContactsWhere(p.eventId, gone), 'ticket_cancelled', now);
          return;
        }
        case 'attendee.cancelled': {
          const p = AttendeeCancelled.parse(event.payload);
          const gone = await goneTx(
            tx,
            p.eventId,
            await attendeeContactIdsTx(tx, { attendeeIds: [p.attendeeId] }),
          );
          if (gone.length)
            await cancelRunsTx(tx, runsOfContactsWhere(p.eventId, gone), 'ticket_cancelled', now);
          return;
        }
        case 'event.cancelled': {
          const p = EventRef.parse(event.payload);
          await cancelRunsTx(tx, runsOfEvent(p.eventId), 'event_cancelled', now);
          return;
        }
        case 'event.occurrence_cancelled': {
          const p = EventRef.parse(event.payload);
          if (p.occurrenceId)
            await cancelRunsTx(tx, runsOfEvent(p.eventId, p.occurrenceId), 'event_cancelled', now);
          return;
        }
      }
    },
  });
}

/** Reschedule on date change: pending steps follow the event's (or its dates') new times. */
export function journeyRescheduler() {
  return defineSubscriber({
    name: 'automations.journey-rescheduler',
    events: ['event.updated@1', 'event.rescheduled@1', 'event.postponed@1', 'event.occurrences_updated@1'],
    handle: async (tx, event) => {
      if (event.replayed) return;
      const p = EventRef.parse(event.payload);
      await rescheduleEventTx(tx, p.eventId, new Date());
    },
  });
}

/** Every journey subscriber, for the worker's and the dev drain's composition roots. */
export const journeySubscribers = () => [
  journeyTriggers(),
  journeyCancellations(),
  journeyRescheduler(),
  // M4.1f: RSVP reminders (enroll on a sent invitation, stop on an answer, follow the deadline).
  rsvpReminderHooks(),
  // M5.1d: invoice reminders.
  journeyInvoiceHooks(),
];
