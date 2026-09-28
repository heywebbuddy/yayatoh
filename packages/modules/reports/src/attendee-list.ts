import {
  AttendeeFilter,
  AttendeeListDto,
  ListAttendeesInput,
  listAttendeesTx,
  resolveAttendeeIdsTx,
  type TicketFilterExtension,
} from '@yayatoh/attendees';
import { admittedTicketIdsSql, eventDay } from '@yayatoh/checkin';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { DomainError } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { ticketIdsOfTypesSql } from '@yayatoh/ticketing';
import { z } from 'zod';

/** Checked in on the event's current day, on any day, or never (M1.8f). */
export const CHECKED_IN_FILTERS = ['today', 'any', 'never'] as const;
export type CheckedInFilter = (typeof CHECKED_IN_FILTERS)[number];

/**
 * The attendee list's filters (M1.8f): the attendees module's own (search, labels, source,
 * status) plus the ticket type and check-in state, which live in higher tiers. All of them
 * combine (AND); ticket types are any-of.
 */
export const AttendeeListFilter = AttendeeFilter.extend({
  ticketTypeIds: z.array(z.uuid()).max(50).default([]),
  checkedIn: z.enum(CHECKED_IN_FILTERS).optional(),
});
export type AttendeeListFilter = z.input<typeof AttendeeListFilter>;

/**
 * The ticket-type and check-in parts as subqueries over ticketing's and check-in's own tables.
 * "Today" is the event's calendar day in its time zone.
 */
export async function attendeeListExtensionTx(
  tx: TenantTx,
  eventId: string,
  f: { ticketTypeIds: readonly string[]; checkedIn?: CheckedInFilter | undefined },
  now: Date,
): Promise<TicketFilterExtension> {
  const ticketIn = f.ticketTypeIds.length ? [ticketIdsOfTypesSql(f.ticketTypeIds)] : [];
  if (!f.checkedIn) return { ticketIn };
  if (f.checkedIn === 'never') return { ticketIn, ticketNotIn: [admittedTicketIdsSql(eventId)] };
  if (f.checkedIn === 'any') return { ticketIn: [...ticketIn, admittedTicketIdsSql(eventId)] };
  const event = await findEventTx(tx, eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  return { ticketIn: [...ticketIn, admittedTicketIdsSql(eventId, eventDay(now, event.timezone))] };
}

/**
 * The organizer's attendee list with every filter, on the server (M1.8f). Same page shape and
 * serializer as `attendees.listAttendees`.
 */
export const attendeeListQuery = tenantQuery({
  name: 'reports.attendeeList',
  input: ListAttendeesInput.extend({
    ticketTypeIds: z.array(z.uuid()).max(50).default([]),
    checkedIn: z.enum(CHECKED_IN_FILTERS).optional(),
  }),
  output: AttendeeListDto,
  entitlement: 'attendees',
  permission: 'attendees:read',
  handler: async ({ input, ctx, tx }) =>
    listAttendeesTx(tx, input, await attendeeListExtensionTx(tx, input.eventId, input, ctx.now)),
});

/** A bulk selection by the full list filter ("everything matching", exports included). */
export async function resolveAttendeeListIdsTx(
  tx: TenantTx,
  sel: { eventId: string | null; ids?: readonly string[]; filter?: z.output<typeof AttendeeListFilter> },
): Promise<string[]> {
  if (!sel.eventId || !sel.filter) return resolveAttendeeIdsTx(tx, sel);
  return resolveAttendeeIdsTx(
    tx,
    sel,
    await attendeeListExtensionTx(tx, sel.eventId, sel.filter, new Date()),
  );
}

/** The ids everything matching the full list filter selects (for actions of lower tiers). */
export const matchingAttendeeIdsQuery = tenantQuery({
  name: 'reports.matchingAttendeeIds',
  input: z.object({ eventId: z.uuid(), filter: AttendeeListFilter }),
  output: z.array(z.uuid()),
  entitlement: 'attendees',
  permission: 'attendees:read',
  handler: ({ input, tx }) => resolveAttendeeListIdsTx(tx, { eventId: input.eventId, filter: input.filter }),
});
