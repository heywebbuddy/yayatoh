import { attendeesByTicketTx } from '@yayatoh/attendees';
import { recordTimelineTx } from '@yayatoh/crm';
import { createCtx } from '@yayatoh/kernel';
import { defineSubscriber, type Subscriber } from '@yayatoh/platform';
import { z } from 'zod';

const Admitted = z.object({
  eventId: z.uuid(),
  ticketId: z.uuid(),
  admissionId: z.uuid(),
  admittedAt: z.iso.datetime({ offset: true }).optional(),
});

/**
 * The person timeline's check-ins (M6.1a): each admission of a ticket, on its holder's timeline
 * (the attendee record is the subject, so a merge undo takes it back with the record). Exactly
 * once per admission.
 */
export function checkinTimeline(): Subscriber {
  return defineSubscriber({
    name: 'checkin.timeline',
    events: ['ticket.admitted@1'],
    acceptsReplayed: true,
    handle: async (tx, event) => {
      const p = Admitted.parse(event.payload);
      const [holder] = await attendeesByTicketTx(tx, [p.ticketId]);
      if (!holder) return;
      const ctx = createCtx({ orgId: event.orgId, actor: { type: 'system', name: 'checkin.timeline' } });
      await recordTimelineTx(tx, ctx, [
        {
          contactId: holder.contactId,
          kind: 'checked_in',
          occurredAt: new Date(p.admittedAt ?? event.occurredAt ?? Date.now()),
          eventId: p.eventId,
          sourceRef: p.admissionId,
          subject: { table: 'attendees.attendees', id: holder.id },
        },
      ]);
    },
  });
}
