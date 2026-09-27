import { contactAttendancesTx } from '@yayatoh/attendees';
import { admissionsForTicketsTx } from '@yayatoh/checkin';
import { findEventTx } from '@yayatoh/events';
import { ordersForContactTx } from '@yayatoh/orders';
import { tenantQuery } from '@yayatoh/platform';
import { z } from 'zod';

export const TIMELINE_KINDS = [
  'ticket',
  'guest',
  'import',
  'registration',
  'comp',
  'order',
  'checked_in',
  'removed',
] as const;

export const ContactTimelineDto = z.object({
  items: z.array(
    z.object({
      at: z.date(),
      kind: z.enum(TIMELINE_KINDS),
      eventId: z.uuid(),
      eventName: z.string(),
      /** Orders: the total in minor units and its currency. */
      amountMinor: z.int().nullable(),
      currency: z.string().nullable(),
      /** Orders: their status. */
      status: z.string().nullable(),
    }),
  ),
  /** How many of this org's events the person was on the list for. */
  events: z.int(),
});

/**
 * Contact timeline v1 (roadmap M1.8): one person across this org's events: when they joined each
 * list (ticket, guest list, import…), what they ordered, when they checked in. Newest first.
 */
export const contactTimelineQuery = tenantQuery({
  name: 'reports.contactTimeline',
  input: z.object({ attendeeId: z.uuid() }),
  output: ContactTimelineDto,
  entitlement: 'attendees',
  permission: 'contacts:read',
  handler: async ({ input, tx }) => {
    const { contactId, attendances } = await contactAttendancesTx(tx, input.attendeeId);
    const orders = await ordersForContactTx(tx, contactId);
    const checkins = await admissionsForTicketsTx(
      tx,
      attendances.flatMap((a) => (a.ticketId ? [a.ticketId] : [])),
    );
    const names = new Map<string, string>();
    for (const id of new Set([...attendances, ...orders, ...checkins].map((x) => x.eventId)))
      names.set(id, (await findEventTx(tx, id))?.name ?? '');
    const base = { amountMinor: null, currency: null, status: null };
    const items = [
      ...attendances.map((a) => ({
        ...base,
        at: a.createdAt,
        kind: a.source as (typeof TIMELINE_KINDS)[number],
        eventId: a.eventId,
      })),
      ...attendances
        .filter((a) => a.status === 'cancelled')
        .map((a) => ({ ...base, at: a.updatedAt, kind: 'removed' as const, eventId: a.eventId })),
      ...orders.map((o) => ({
        at: o.createdAt,
        kind: 'order' as const,
        eventId: o.eventId,
        amountMinor: o.totalMinor,
        currency: o.currency,
        status: o.status,
      })),
      ...checkins.map((c) => ({
        ...base,
        at: c.admittedAt,
        kind: 'checked_in' as const,
        eventId: c.eventId,
      })),
    ]
      .map((i) => ({ ...i, eventName: names.get(i.eventId) ?? '' }))
      .sort((x, y) => y.at.getTime() - x.at.getTime())
      .slice(0, 200);
    return { items, events: new Set(attendances.map((a) => a.eventId)).size };
  },
});
