import { attendeeContactIdsTx, participationAttendeesTx } from '@yayatoh/attendees';
import { admittedTicketIdsTx } from '@yayatoh/checkin';
import { type ParticipationFacts, refreshContactProfilesTx, replaceParticipationTx } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, createCtx } from '@yayatoh/kernel';
import { buyerFactsTx, orderRefTx } from '@yayatoh/orders';
import { catchUpSubscriber, defineSubscriber, type PublishedEvent, type Subscriber } from '@yayatoh/platform';
import { seatedAttendeeIdsTx } from '@yayatoh/seating';
import { orderTicketIdsTx, ticketFactsTx } from '@yayatoh/ticketing';
import { z } from 'zod';

/**
 * Events that can change who took part in an event and how (M3.6). Each names the event and the
 * people (or, for a floor-plan edit, the whole event); the projector recomputes those rows from
 * their sources, so handling one twice, or in any order, converges on the same rows.
 */
export const PARTICIPATION_EVENTS = [
  'order.paid@1',
  'order.refunded@1',
  'tickets.cancelled@1',
  'ticket.admitted@1',
  'ticket.admission_undone@1',
  'attendee.cancelled@1',
  'attendees.changed@1',
  'seating.assignments_changed@1',
] as const;

/**
 * Recompute `crm.event_participation` for these contacts at one event (or everyone at it, with
 * `contactIds: null`) from the attendee list, tickets, seat assignments, admissions and paid
 * orders, then their `contact_profile`. The rows mean what the legacy backfill (M2.2c T9) means:
 * - `registered`: an active attendee record (a ticket holder whose ticket is live, or a guest);
 * - `tickets`, `ticket_type_ids`: live tickets held; `has_seat`: one of them has a bought seat or
 *   the person was seated by the organizer; `checked_in`: any of their tickets was admitted;
 * - `orders`, `spend_minor`: paid orders as the buyer, spend net of refunds;
 * - `registered_at`: the earliest active record or paid order; `labels`: their attendee labels.
 */
export async function refreshParticipationTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  contactIds: readonly string[] | null,
): Promise<number> {
  const only = contactIds === null ? null : [...new Set(contactIds)];
  if (only !== null && only.length === 0) return 0;
  const event = await findEventTx(tx, eventId);
  if (!event) {
    // The event is gone (its rows went with it through the foreign key): nothing to project.
    return 0;
  }
  const records = await participationAttendeesTx(tx, eventId, only);
  const ticketIds = records.flatMap((r) => (r.ticketId ? [r.ticketId] : []));
  const tickets = new Map((await ticketFactsTx(tx, ticketIds)).map((t) => [t.id, t]));
  const liveRecords = records.filter(
    (r) => r.status === 'active' && (!r.ticketId || tickets.get(r.ticketId)?.status === 'active'),
  );
  const seated = await seatedAttendeeIdsTx(
    tx,
    eventId,
    liveRecords.map((r) => r.id),
  );
  const admitted = await admittedTicketIdsTx(tx, eventId, ticketIds);
  const buyers = new Map((await buyerFactsTx(tx, eventId, only)).map((b) => [b.contactId, b]));

  const people = new Set<string>([...records.map((r) => r.contactId), ...buyers.keys()]);
  const rows: ParticipationFacts[] = [];
  for (const contactId of people) {
    const mine = records.filter((r) => r.contactId === contactId);
    const live = liveRecords.filter((r) => r.contactId === contactId);
    const held = live.flatMap((r) => {
      const t = r.ticketId ? tickets.get(r.ticketId) : undefined;
      return t ? [t] : [];
    });
    const buyer = buyers.get(contactId);
    if (live.length === 0 && !buyer) continue;
    const since = [...live.map((r) => r.createdAt.getTime()), ...(buyer ? [buyer.firstAt.getTime()] : [])];
    rows.push({
      contactId,
      registered: live.length > 0,
      tickets: held.length,
      ticketTypeIds: held.map((t) => t.ticketTypeId),
      hasSeat: live.some((r) => seated.has(r.id)) || held.some((t) => t.seatLabel !== null),
      checkedIn: mine.some((r) => r.ticketId !== null && admitted.has(r.ticketId)),
      orders: buyer?.orders ?? 0,
      spendMinor: buyer?.spendMinor ?? 0,
      registeredAt: new Date(Math.min(...since)),
      labels: live.flatMap((r) => r.labels),
    });
  }
  const changed = await replaceParticipationTx(tx, ctx, {
    eventId,
    currency: event.currency,
    contactIds: only,
    rows,
  });
  await refreshContactProfilesTx(tx, ctx, [...new Set([...changed, ...(only ?? [])])]);
  return rows.length;
}

const EventRef = z.object({ eventId: z.uuid() });
const OrderRef = z.object({ orderId: z.uuid() });

/** Which event and which contacts one outbox event touches (`contactIds: null` = everyone there). */
export async function participationTargetTx(
  tx: TenantTx,
  event: Pick<PublishedEvent, 'type' | 'version' | 'payload'>,
): Promise<{ eventId: string; contactIds: string[] | null } | null> {
  const p = event.payload;
  switch (`${event.type}@${event.version}`) {
    case 'order.paid@1':
    case 'order.refunded@1': {
      const { orderId } = OrderRef.parse(p);
      const order = await orderRefTx(tx, orderId);
      if (!order) return null;
      const holders = await attendeeContactIdsTx(tx, { ticketIds: await orderTicketIdsTx(tx, orderId) });
      return {
        eventId: order.eventId,
        contactIds: [...(order.buyerContactId ? [order.buyerContactId] : []), ...holders],
      };
    }
    case 'tickets.cancelled@1': {
      const v = EventRef.extend({ ticketIds: z.array(z.uuid()) }).parse(p);
      return { eventId: v.eventId, contactIds: await attendeeContactIdsTx(tx, { ticketIds: v.ticketIds }) };
    }
    case 'ticket.admitted@1':
    case 'ticket.admission_undone@1': {
      const v = EventRef.extend({ ticketId: z.uuid() }).parse(p);
      return { eventId: v.eventId, contactIds: await attendeeContactIdsTx(tx, { ticketIds: [v.ticketId] }) };
    }
    case 'attendee.cancelled@1': {
      const v = EventRef.extend({ attendeeId: z.uuid() }).parse(p);
      return {
        eventId: v.eventId,
        contactIds: await attendeeContactIdsTx(tx, { attendeeIds: [v.attendeeId] }),
      };
    }
    case 'attendees.changed@1': {
      const v = EventRef.extend({ contactIds: z.array(z.uuid()) }).parse(p);
      return { eventId: v.eventId, contactIds: v.contactIds };
    }
    case 'seating.assignments_changed@1': {
      const v = EventRef.extend({ attendeeIds: z.array(z.uuid()).nullable() }).parse(p);
      return {
        eventId: v.eventId,
        contactIds:
          v.attendeeIds === null ? null : await attendeeContactIdsTx(tx, { attendeeIds: v.attendeeIds }),
      };
    }
    default:
      return null;
  }
}

/**
 * The `audiences.participation` projector (M3.6): keeps `crm.event_participation` and
 * `crm.contact_profile` current from the outbox. Exactly once per event (platform
 * `processed_events`), and idempotent besides (rows are recomputed from their sources). It takes
 * backfilled (`replayed`) legacy events too: history is projected the same way as live sales.
 */
export function participationProjector(): Subscriber {
  return defineSubscriber({
    name: 'audiences.participation',
    events: PARTICIPATION_EVENTS,
    acceptsReplayed: true,
    handle: async (tx, event) => {
      const target = await participationTargetTx(tx, event);
      if (!target) return;
      const ctx = createCtx({
        orgId: event.orgId,
        actor: { type: 'system', name: 'audiences.participation' },
      });
      await refreshParticipationTx(tx, ctx, target.eventId, target.contactIds);
    },
  });
}

/** Apply the org's outbox events the projector has not handled yet (seed, e2e, deploy catch-up). */
export function catchUpParticipation(orgId: string) {
  return catchUpSubscriber(participationProjector(), orgId);
}
