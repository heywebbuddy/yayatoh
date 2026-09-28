import { attendeesByTicketIdsTx } from '@yayatoh/attendees';
import type { TenantTx } from '@yayatoh/db';
import { FloorplanDoc } from '@yayatoh/floorplan';
import { tenantQuery } from '@yayatoh/platform';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type ChartKey, chartKeyTx } from './chart.ts';
import { eventLayouts, eventSeats, seatAssignments } from './schema.ts';

/** One attendee whose seat is wanted: their ticket and the date it is for (if any). */
export const SeatPerson = z.object({
  attendeeId: z.uuid(),
  ticketId: z.uuid().nullable(),
  occurrenceId: z.uuid().nullable(),
});
export type SeatPerson = z.infer<typeof SeatPerson>;

/** A seat as the organizer reads it: section, then "Row A · 5" / "Table 3 · 2" (M1.7g). */
export const seatLabelWithSection = (section: string | null | undefined, label: string) =>
  section ? `${section} · ${label}` : label;

/**
 * Each attendee's seat for their date (M1.7g): the seat bought with their ticket, else the seat
 * the organizer gave them on the chart their date uses (the event plan for people without a
 * date, or, when they have none there, a date's own chart). Labels carry the section when the
 * seat is in one. Attendees without a seat are left out.
 */
export async function attendeeSeatLabelsTx(
  tx: TenantTx,
  eventId: string,
  people: readonly SeatPerson[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (people.length === 0) return out;
  const layouts = await tx
    .select({ occurrenceId: eventLayouts.occurrenceId, doc: eventLayouts.doc })
    .from(eventLayouts)
    .where(eq(eventLayouts.eventId, eventId));
  if (layouts.length === 0) return out;
  const sectionOf = new Map<string, string>();
  for (const l of layouts) {
    const doc = FloorplanDoc.safeParse(l.doc).data;
    for (const sec of doc?.sections ?? []) sectionOf.set(`${l.occurrenceId ?? ''}:${sec.id}`, sec.label);
  }
  const labelOf = (s: { occurrenceId: string | null; sectionId: string | null; label: string }) =>
    seatLabelWithSection(
      s.sectionId ? sectionOf.get(`${s.occurrenceId ?? ''}:${s.sectionId}`) : null,
      s.label,
    );
  const ticketIds = people.flatMap((p) => (p.ticketId ? [p.ticketId] : []));
  const seatCols = {
    occurrenceId: eventSeats.occurrenceId,
    sectionId: eventSeats.sectionId,
    label: eventSeats.label,
  };
  const bought = ticketIds.length
    ? await tx
        .select({ ticketId: eventSeats.ticketId, ...seatCols })
        .from(eventSeats)
        .where(
          and(
            eq(eventSeats.eventId, eventId),
            eq(eventSeats.status, 'sold'),
            inArray(eventSeats.ticketId, ticketIds),
          ),
        )
    : [];
  const byTicket = new Map(bought.map((b) => [b.ticketId, b]));
  const assigned = await tx
    .select({ attendeeId: seatAssignments.attendeeId, ...seatCols })
    .from(seatAssignments)
    .innerJoin(
      eventSeats,
      and(
        eq(eventSeats.orgId, seatAssignments.orgId),
        eq(eventSeats.eventId, seatAssignments.eventId),
        eq(eventSeats.seatUuid, seatAssignments.seatUuid),
        // Seat ids repeat on a date's copy of the plan: the seat on the assignment's own chart.
        sql`${eventSeats.occurrenceId} is not distinct from ${seatAssignments.occurrenceId}`,
      ),
    )
    .where(
      and(
        eq(seatAssignments.eventId, eventId),
        inArray(
          seatAssignments.attendeeId,
          people.map((p) => p.attendeeId),
        ),
      ),
    );
  const charts = new Map<string, ChartKey>();
  for (const d of new Set(people.flatMap((p) => (p.occurrenceId ? [p.occurrenceId] : []))))
    charts.set(d, await chartKeyTx(tx, eventId, d));
  const assignedByPerson = new Map<string, typeof assigned>();
  for (const a of assigned)
    assignedByPerson.set(a.attendeeId, [...(assignedByPerson.get(a.attendeeId) ?? []), a]);
  for (const p of people) {
    const b = p.ticketId ? byTicket.get(p.ticketId) : undefined;
    if (b) {
      out.set(p.attendeeId, labelOf(b));
      continue;
    }
    const mine = assignedByPerson.get(p.attendeeId) ?? [];
    const key = p.occurrenceId ? (charts.get(p.occurrenceId) ?? null) : null;
    const seat = mine.find((a) => a.occurrenceId === key) ?? (p.occurrenceId ? undefined : mine[0]);
    if (seat) out.set(p.attendeeId, labelOf(seat));
  }
  return out;
}

/** The attendee list's Seat column (M1.7g): each attendee's seat label for their date. */
export const attendeeSeatLabelsQuery = tenantQuery({
  name: 'seating.attendeeSeatLabels',
  input: z.object({ eventId: z.uuid(), people: z.array(SeatPerson).max(1_000) }),
  output: z.array(z.object({ attendeeId: z.uuid(), seat: z.string() })),
  entitlement: 'seating',
  permission: 'attendees:read',
  handler: async ({ input, tx }) =>
    [...(await attendeeSeatLabelsTx(tx, input.eventId, input.people))].map(([attendeeId, seat]) => ({
      attendeeId,
      seat,
    })),
});

/**
 * The seat of each ticket for its date (M1.7g, the organizer's order page): the seat bought with
 * it, or the seat the organizer gave its holder.
 */
export const ticketSeatLabelsQuery = tenantQuery({
  name: 'seating.ticketSeatLabels',
  input: z.object({
    eventId: z.uuid(),
    tickets: z.array(z.object({ ticketId: z.uuid(), occurrenceId: z.uuid().nullable() })).max(500),
  }),
  output: z.array(z.object({ ticketId: z.uuid(), seat: z.string() })),
  entitlement: 'seating',
  permission: 'attendees:read',
  handler: async ({ input, tx }) => {
    const holders = await attendeesByTicketIdsTx(
      tx,
      input.tickets.map((t) => t.ticketId),
    );
    const holderOf = new Map(holders.map((h) => [h.ticketId, h.id]));
    const people = input.tickets.flatMap((t) => {
      const attendeeId = holderOf.get(t.ticketId);
      return attendeeId ? [{ attendeeId, ticketId: t.ticketId, occurrenceId: t.occurrenceId }] : [];
    });
    const labels = await attendeeSeatLabelsTx(tx, input.eventId, people);
    return people.flatMap((p) => {
      const seat = labels.get(p.attendeeId);
      return seat ? [{ ticketId: p.ticketId, seat }] : [];
    });
  },
});
