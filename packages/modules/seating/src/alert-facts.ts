import { eventAttendeesTx } from '@yayatoh/attendees';
import type { TenantTx } from '@yayatoh/db';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { eventLayouts, eventSeats, seatAssignments } from './schema.ts';

/**
 * Alert engine (M3.2b): how many active people of an event have no seat on the event plan, by the
 * same rule as the assignment view (`seating.assignments`): seated means placed by the organizer
 * or holding a seat bought with their ticket. `null` when the event has no published plan (a
 * draft plan, or none, is not a seated event yet). Counts only; never names.
 */
export async function unseatedAttendeesTx(tx: TenantTx, eventId: string): Promise<number | null> {
  const [layout] = await tx
    .select({ status: eventLayouts.status })
    .from(eventLayouts)
    .where(and(eq(eventLayouts.eventId, eventId), isNull(eventLayouts.occurrenceId)));
  if (!layout || layout.status === 'draft') return null;
  const people = await eventAttendeesTx(tx, eventId);
  if (people.length === 0) return 0;
  const [assigned, sold] = await Promise.all([
    tx
      .select({ attendeeId: seatAssignments.attendeeId })
      .from(seatAssignments)
      .where(and(eq(seatAssignments.eventId, eventId), isNull(seatAssignments.occurrenceId))),
    tx
      .select({ ticketId: eventSeats.ticketId })
      .from(eventSeats)
      .where(
        and(
          eq(eventSeats.eventId, eventId),
          isNull(eventSeats.occurrenceId),
          eq(eventSeats.status, 'sold'),
          isNotNull(eventSeats.ticketId),
          ...(people.some((p) => p.ticketId)
            ? [
                inArray(
                  eventSeats.ticketId,
                  people.flatMap((p) => (p.ticketId ? [p.ticketId] : [])),
                ),
              ]
            : []),
        ),
      ),
  ]);
  const seatedIds = new Set(assigned.map((a) => a.attendeeId));
  const soldTickets = new Set(sold.map((s) => s.ticketId));
  return people.filter((p) => !seatedIds.has(p.id) && !(p.ticketId && soldTickets.has(p.ticketId))).length;
}
