import { findEventTx, findOccurrenceTx, occurrencesOfEventTx } from '@yayatoh/events';
import { type ReminderTarget, reminderTime, rescheduleRemindersTx } from '@yayatoh/notifications';
import { defineSubscriber, keyVault, type Notifier } from '@yayatoh/platform';
import { ticketsForOrderTx } from '@yayatoh/ticketing';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { orders, refundRequests } from './schema.ts';

const Payload = z.object({ orgId: z.uuid(), orderId: z.uuid() });
const RefundPayload = z.object({
  orgId: z.uuid(),
  orderId: z.uuid(),
  refundId: z.uuid(),
  amountMinor: z.number().int(),
  currency: z.string(),
  fully: z.boolean(),
});

/**
 * How long before the start the event reminder goes out (roadmap M1.10: reminder idempotency): a
 * day, as the same wall-clock time the day before in the event's timezone (`reminderTime`).
 */
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
        // Multi-date events (M1.4b): the reminder is about the date the buyer chose.
        const date = order.occurrenceId ? await findOccurrenceTx(tx, order.occurrenceId) : null;
        const startsAt = date?.startsAt ?? ev?.startsAt ?? null;
        const remindAt = ev && startsAt ? reminderTime(startsAt, ev.timezone) : null;
        if (ev && startsAt && remindAt && remindAt.getTime() > Date.now())
          await deps.notifier.enqueue(tx, {
            kind: 'events.reminder',
            to,
            params: {
              url,
              name: order.buyerName,
              eventName: ev.name,
              startsAt: startsAt.toISOString(),
              timeZone: ev.timezone,
              venue: ev.venueName ?? '',
            },
            dedupeKey: `event-reminder:${ev.id}:${date ? `${date.id}:` : ''}${order.buyerEmail.trim().toLowerCase()}`,
            orderId: order.id,
            eventId: ev.id,
            occurrenceId: date?.id ?? null,
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

const EventPayload = z.object({ orgId: z.uuid(), eventId: z.uuid() });

/**
 * Reminders follow reschedules (M1.10d): when an event's (or one of its dates') start time
 * changes, or the event or a date is cancelled, its queued reminders are re-planned from the start
 * time as it is now. Idempotent: replaying any of these events changes nothing further.
 */
export function reminderRescheduler() {
  return defineSubscriber({
    name: 'orders.reminder-rescheduler',
    events: [
      'event.updated@1',
      'event.rescheduled@1',
      'event.postponed@1',
      'event.cancelled@1',
      'event.occurrences_updated@1',
      'event.occurrence_cancelled@1',
    ],
    handle: async (tx, event) => {
      const p = EventPayload.parse(event.payload);
      const ev = await findEventTx(tx, p.eventId);
      if (!ev) return;
      const dates = new Map((await occurrencesOfEventTx(tx, ev.id)).map((d) => [d.id, d]));
      const base = { timeZone: ev.timezone, eventName: ev.name, venue: ev.venueName ?? '' };
      const eventCancelled = ev.status === 'cancelled';
      const postponed = ev.status === 'postponed';
      await rescheduleRemindersTx(
        tx,
        p.orgId,
        ev.id,
        (occurrenceId): ReminderTarget | null => {
          if (!occurrenceId) return { ...base, startsAt: ev.startsAt, cancelled: eventCancelled, postponed };
          const d = dates.get(occurrenceId);
          if (!d) return null;
          return {
            ...base,
            startsAt: d.startsAt,
            cancelled: eventCancelled || d.status === 'cancelled',
            postponed,
          };
        },
        new Date(),
      );
    },
  });
}

const RequestPayload = z.object({ orgId: z.uuid(), orderId: z.uuid(), requestId: z.uuid() });

/**
 * A buyer asked for a refund (M3.10b): owners, admins and finance hear about it, with a link to
 * the queue (the SLA clock runs from now).
 */
export function refundRequestNotifier(deps: { notifier: Notifier }) {
  return defineSubscriber({
    name: 'orders.refund-request-notifier',
    events: ['order.refund_requested@1'],
    handle: async (tx, event) => {
      const p = RequestPayload.parse(event.payload);
      const [order] = await tx.select().from(orders).where(eq(orders.id, p.orderId));
      const [req] = await tx.select().from(refundRequests).where(eq(refundRequests.id, p.requestId));
      if (!order || !req) return;
      const ev = await findEventTx(tx, order.eventId);
      await deps.notifier.notifyMembers(tx, {
        kind: 'orders.refund-requested',
        params: { name: order.buyerName, eventName: ev?.name ?? '', count: req.ticketIds.length },
        dedupeKey: `refund-requested:${req.id}`,
        href: '/refund-requests',
        orderId: order.id,
        eventId: order.eventId,
      });
    },
  });
}

/** The organizer declined a buyer's refund request (M3.10b): the buyer is sent the reason. */
export function refundDeclineMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'orders.refund-decline-mailer',
    events: ['order.refund_request_declined@1'],
    handle: async (tx, event) => {
      const p = RequestPayload.parse(event.payload);
      const [order] = await tx.select().from(orders).where(eq(orders.id, p.orderId));
      const [req] = await tx.select().from(refundRequests).where(eq(refundRequests.id, p.requestId));
      if (!order || !req || req.status !== 'declined') return;
      const ev = await findEventTx(tx, order.eventId);
      await deps.notifier.enqueue(tx, {
        kind: 'orders.refund-declined',
        to: {
          email: order.buyerEmail,
          name: order.buyerName,
          userId: order.buyerUserId,
          locale: order.locale,
          timeZone: ev?.timezone ?? null,
        },
        params: {
          url: (await manageUrl(deps.appOrigin, p.orgId, order)) ?? '',
          name: order.buyerName,
          eventName: ev?.name ?? '',
          reason: req.declineReason ?? '',
        },
        dedupeKey: `refund-declined:${req.id}`,
        orderId: order.id,
        eventId: order.eventId,
      });
    },
  });
}

const PostponedPayload = z.object({ orgId: z.uuid(), eventId: z.uuid() });

/**
 * An event was postponed (M3.10b): every buyer with a live order hears that their tickets stay
 * valid and that they can ask for a refund under the refund policy from their order page. One
 * message per order and postponement.
 */
export function postponementMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'orders.postponement-mailer',
    events: ['event.postponed@1'],
    handle: async (tx, event) => {
      const p = PostponedPayload.parse(event.payload);
      const ev = await findEventTx(tx, p.eventId);
      if (ev?.status !== 'postponed') return;
      const sold = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.eventId, ev.id), inArray(orders.status, ['paid', 'partially_refunded'])));
      for (const order of sold) {
        const url = await manageUrl(deps.appOrigin, p.orgId, order);
        if (!url) continue;
        await deps.notifier.enqueue(tx, {
          kind: 'events.postponed',
          to: {
            email: order.buyerEmail,
            name: order.buyerName,
            userId: order.buyerUserId,
            locale: order.locale,
            timeZone: ev.timezone,
          },
          params: { url, name: order.buyerName, eventName: ev.name },
          dedupeKey: `event-postponed:${event.id}:${order.id}`,
          orderId: order.id,
          eventId: ev.id,
        });
      }
    },
  });
}
