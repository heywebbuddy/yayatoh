import { normalizeEmail } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx, findOccurrenceTx } from '@yayatoh/events';
import {
  APP_REMINDER_KINDS,
  type AppReminderKind,
  cancelQueuedTx,
  followAppDevicesTx,
  reminderTimeFor,
} from '@yayatoh/notifications';
import { defineSubscriber, type Notifier } from '@yayatoh/platform';
import {
  activeTicketsHeldByEmailTx,
  eventHoldersTx,
  ticketPushFactsTx,
  ticketsForOrderTx,
  transferFactsTx,
} from '@yayatoh/ticketing';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { orders } from './schema.ts';

/**
 * The attendee app's pushes (M7.2c, decision P7-8). Each is a `push.*` message kind: the lock screen
 * shows the event name and what changed, nothing else, and the tap opens the in-app route in
 * `_path`. They are queued only for people with the app on a phone (the notifier skips everyone
 * else), keyed so that a replayed event queues nothing twice, and `_collapse` lets a newer push
 * replace an older one about the same thing on the lock screen.
 */
interface Recipient {
  readonly email: string;
  readonly name?: string | null;
  readonly userId?: string | null;
  readonly locale?: string | null;
}

const ticketPath = (ticketId: string) => `/tickets/${ticketId}`;
const orderPath = (orderId: string) => `/orders/${orderId}`;
const eventPath = (slug: string) => `/events/${slug}`;

/** The reminder's dedupe key: one per kind, ticket and recipient. */
export const appReminderKey = (kind: AppReminderKind, ticketId: string, email: string) =>
  `app-${kind}:${ticketId}:${normalizeEmail(email)}`;

async function startOf(tx: TenantTx, eventId: string, occurrenceId: string | null) {
  const ev = await findEventTx(tx, eventId);
  if (!ev) return null;
  const date = occurrenceId ? await findOccurrenceTx(tx, occurrenceId) : null;
  return { ev, startsAt: date?.startsAt ?? ev.startsAt, occurrenceId: date?.id ?? null };
}

/**
 * Queue both reminders (24 h and 2 h before the start) for one ticket and recipient. A reminder
 * whose time has passed is skipped. The 24 h one is the same wall-clock time the day before in the
 * event's zone (DST-safe); the 2 h one is two elapsed hours. One per ticket, kind and recipient.
 */
export async function queueAppReminders(
  tx: TenantTx,
  notifier: Notifier,
  args: {
    readonly ticketId: string;
    readonly orderId: string | null;
    readonly eventId: string;
    readonly occurrenceId: string | null;
    readonly to: Recipient;
    readonly now: Date;
  },
): Promise<number> {
  const at = await startOf(tx, args.eventId, args.occurrenceId);
  if (!at || at.ev.status === 'cancelled' || at.ev.status === 'postponed') return 0;
  let queued = 0;
  for (const kind of APP_REMINDER_KINDS) {
    const sendAfter = reminderTimeFor(kind, at.startsAt, at.ev.timezone);
    if (sendAfter.getTime() <= args.now.getTime()) continue;
    const r = await notifier.enqueue(tx, {
      kind,
      to: { ...args.to, timeZone: at.ev.timezone },
      params: {
        eventName: at.ev.name,
        startsAt: at.startsAt.toISOString(),
        timeZone: at.ev.timezone,
        _path: ticketPath(args.ticketId),
        _collapse: `ticket:${args.ticketId}`,
      },
      dedupeKey: appReminderKey(kind, args.ticketId, args.to.email),
      orderId: args.orderId,
      eventId: args.eventId,
      occurrenceId: at.occurrenceId,
      sendAfter,
    });
    queued += r.queued;
  }
  return queued;
}

/** Drop a person's queued reminders for a ticket (it was transferred away, voided or refunded). */
export async function cancelAppReminders(
  tx: TenantTx,
  ticketId: string,
  emails: readonly string[],
  reason: string,
  now: Date,
): Promise<number> {
  const keys = [...new Set(emails.map(normalizeEmail))].flatMap((e) =>
    APP_REMINDER_KINDS.map((k) => appReminderKey(k, ticketId, e)),
  );
  return cancelQueuedTx(tx, keys, reason, now);
}

const OrderPayload = z.object({ orgId: z.uuid(), orderId: z.uuid() });
const TransferPayload = z.object({ orgId: z.uuid(), transferId: z.uuid() });
const EventPayload = z.object({
  orgId: z.uuid(),
  eventId: z.uuid(),
  schedule: z.array(z.string()).optional(),
});
const TicketsPayload = z.object({ orgId: z.uuid(), eventId: z.uuid(), ticketIds: z.array(z.uuid()) });

/**
 * The person's phone follows them (M7.2c): when they buy from, or are given a ticket by, an org
 * they hadn't bought from before, their phones are stored there too. Done first, so the same
 * event's pushes can reach it.
 */
async function follow(tx: TenantTx, orgId: string, emails: readonly string[], now: Date) {
  for (const e of new Set(emails.map(normalizeEmail))) await followAppDevicesTx(tx, orgId, e, now);
}

export function appPushNotifier(deps: { notifier: Notifier }) {
  const { notifier } = deps;
  return defineSubscriber({
    name: 'orders.app-push',
    events: [
      'order.paid@1',
      'order.refunded@1',
      'tickets.cancelled@1',
      'ticket.transferred@1',
      'ticket.transfer_cancelled@1',
      'event.updated@1',
      'event.rescheduled@1',
      'event.postponed@1',
      'event.cancelled@1',
    ],
    handle: async (tx, event) => {
      const now = new Date();
      switch (event.type) {
        case 'order.paid': {
          const p = OrderPayload.parse(event.payload);
          const [order] = await tx.select().from(orders).where(eq(orders.id, p.orderId));
          if (!order) return;
          const tickets = (await ticketsForOrderTx(tx, order.id)).filter((t) => t.status === 'active');
          await follow(
            tx,
            p.orgId,
            [order.buyerEmail, ...tickets.flatMap((t) => (t.holderEmail ? [t.holderEmail] : []))],
            now,
          );
          const ev = await findEventTx(tx, order.eventId);
          if (!ev) return;
          const buyer: Recipient = {
            email: order.buyerEmail,
            name: order.buyerName,
            userId: order.buyerUserId,
            locale: order.locale,
          };
          await notifier.enqueue(tx, {
            kind: 'push.order-confirmed',
            to: { ...buyer, timeZone: ev.timezone },
            params: { eventName: ev.name, _path: orderPath(order.id), _collapse: `order:${order.id}` },
            dedupeKey: `push-order-confirmed:${order.id}`,
            orderId: order.id,
            eventId: ev.id,
          });
          for (const t of tickets)
            await queueAppReminders(tx, notifier, {
              ticketId: t.id,
              orderId: order.id,
              eventId: ev.id,
              occurrenceId: t.occurrenceId ?? order.occurrenceId,
              to: t.holderEmail ? { email: t.holderEmail, locale: order.locale } : buyer,
              now,
            });
          return;
        }
        case 'order.refunded': {
          // A refunded ticket gets no reminder (a partial refund voids only some of the tickets).
          const p = OrderPayload.parse(event.payload);
          const [order] = await tx.select().from(orders).where(eq(orders.id, p.orderId));
          if (!order) return;
          for (const t of await ticketsForOrderTx(tx, order.id))
            if (t.status !== 'active')
              await cancelAppReminders(
                tx,
                t.id,
                [order.buyerEmail, t.holderEmail ?? order.buyerEmail],
                'ticket_void',
                now,
              );
          return;
        }
        case 'tickets.cancelled': {
          const p = TicketsPayload.parse(event.payload);
          for (const t of await ticketPushFactsTx(tx, p.ticketIds)) {
            if (t.status === 'active') continue;
            const [order] = await tx.select().from(orders).where(eq(orders.id, t.orderId));
            await cancelAppReminders(
              tx,
              t.id,
              [t.holderEmail, order?.buyerEmail].filter((e): e is string => Boolean(e)),
              'ticket_void',
              now,
            );
          }
          return;
        }
        case 'ticket.transferred': {
          const p = TransferPayload.parse(event.payload);
          const t = await transferFactsTx(tx, p.transferId);
          if (!t || t.status !== 'claimed') return;
          const [ticket] = await ticketPushFactsTx(tx, [t.ticketId]);
          const ev = await findEventTx(tx, t.eventId);
          if (!ticket || !ev) return;
          await follow(tx, p.orgId, [t.toEmail], now);
          // The ticket is no longer the sender's: its reminders move to the new holder.
          await cancelAppReminders(tx, t.ticketId, [t.fromEmail], 'ticket_transferred', now);
          await notifier.enqueue(tx, {
            kind: 'push.transfer-accepted',
            to: { email: t.fromEmail, timeZone: ev.timezone },
            params: { eventName: ev.name, _path: orderPath(t.orderId), _collapse: `transfer:${t.id}` },
            dedupeKey: `push-transfer-accepted:${t.id}`,
            orderId: t.orderId,
            eventId: ev.id,
          });
          await notifier.enqueue(tx, {
            kind: 'push.ticket-received',
            to: { email: t.toEmail, timeZone: ev.timezone },
            params: { eventName: ev.name, _path: ticketPath(t.ticketId), _collapse: `ticket:${t.ticketId}` },
            dedupeKey: `push-ticket-received:${t.id}`,
            orderId: t.orderId,
            eventId: ev.id,
          });
          await queueAppReminders(tx, notifier, {
            ticketId: t.ticketId,
            orderId: t.orderId,
            eventId: ev.id,
            occurrenceId: ticket.occurrenceId,
            to: { email: t.toEmail },
            now,
          });
          return;
        }
        case 'ticket.transfer_cancelled': {
          const p = TransferPayload.parse(event.payload);
          const t = await transferFactsTx(tx, p.transferId);
          if (!t || t.status !== 'cancelled') return;
          const ev = await findEventTx(tx, t.eventId);
          if (!ev) return;
          // Told to whoever did not cancel it: the sender when the organizer withdrew the offer, and
          // the recipient when they already have the app here (an offer they could have claimed).
          const targets = t.initiatedBy === 'organizer' ? [t.fromEmail, t.toEmail] : [t.toEmail];
          for (const email of targets)
            await notifier.enqueue(tx, {
              kind: 'push.transfer-cancelled',
              to: { email, timeZone: ev.timezone },
              params: {
                eventName: ev.name,
                _path: email === t.fromEmail ? ticketPath(t.ticketId) : eventPath(ev.slug),
                _collapse: `transfer:${t.id}`,
              },
              dedupeKey: `push-transfer-cancelled:${t.id}:${normalizeEmail(email)}`,
              orderId: t.orderId,
              eventId: ev.id,
            });
          return;
        }
        default: {
          // event.updated / rescheduled / postponed / cancelled
          const p = EventPayload.parse(event.payload);
          const ev = await findEventTx(tx, p.eventId);
          if (!ev) return;
          const cancelled = event.type === 'event.cancelled' && ev.status === 'cancelled';
          const changed =
            event.type === 'event.rescheduled' ||
            event.type === 'event.postponed' ||
            (event.type === 'event.updated' && (p.schedule?.length ?? 0) > 0);
          if (!cancelled && !changed) return;
          const holders = await eventHoldersTx(tx, ev.id);
          const emails = [...new Set(holders.map((h) => normalizeEmail(h.holderEmail)))];
          await follow(tx, p.orgId, emails, now);
          for (const email of emails)
            await notifier.enqueue(tx, {
              kind: cancelled ? 'push.event-cancelled' : 'push.event-changed',
              to: { email, timeZone: ev.timezone },
              params: { eventName: ev.name, _path: eventPath(ev.slug), _collapse: `event:${ev.id}` },
              dedupeKey: `push-${cancelled ? 'event-cancelled' : 'event-changed'}:${event.id}:${email}`,
              eventId: ev.id,
            });
        }
      }
    },
  });
}

/**
 * A phone was just registered in this org (`POST /v1/me/devices`): queue the reminders of the
 * tickets this person already holds, which were skipped while they had no phone here. Safe to run
 * again: each reminder is keyed by kind, ticket and person.
 */
export async function queueRemindersForHolderTx(
  tx: TenantTx,
  notifier: Notifier,
  email: string,
  now: Date,
): Promise<number> {
  let queued = 0;
  for (const t of await activeTicketsHeldByEmailTx(tx, email))
    queued += await queueAppReminders(tx, notifier, {
      ticketId: t.id,
      orderId: t.orderId,
      eventId: t.eventId,
      occurrenceId: t.occurrenceId,
      to: { email },
      now,
    });
  return queued;
}
