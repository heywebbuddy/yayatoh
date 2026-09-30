import { AttendeeFilter, resolveAttendeeIdsTx } from '@yayatoh/attendees';
import { DomainError } from '@yayatoh/kernel';
import { bulkCommands, defineBulkAction } from '@yayatoh/platform';
import { releaseAttendeeSeatsTx, voidSeatTx } from '@yayatoh/seating';
import { attendeeTicketsTx, voidTicketsTx } from '@yayatoh/ticketing';
import { z } from 'zod';

/**
 * Cancel tickets without a refund (M1.8f): the selected attendees' tickets, or those of everyone
 * matching the filters, are voided (reason `cancelled`) — scanners reject them from the next
 * manifest, their attendees leave the list, their places and seats return to sale, and a guest
 * seat given by the organizer is freed. No money moves: refunds stay per order (M1.6), so the
 * orders keep their status and payments. Each chunk emits `tickets.cancelled@1`; the ticketing
 * mailer tells each holder once. Not undoable (a voided code never scans again), so the console
 * asks for a confirmation that names the count; audited as `bulk.start`. Money and destructive
 * powers: owners, admins and finance (`orders:refund`), never while impersonating (M1.2e).
 */
export const ticketCancelAction = defineBulkAction({
  key: 'orders.cancelTickets',
  entitlement: 'ticketing',
  permission: 'orders:refund',
  params: z.object({}),
  filter: AttendeeFilter,
  chunkSize: 100,
  category: 'delete',
  resolve: resolveAttendeeIdsTx,
  run: async (tx, ctx, ids, _params, meta) => {
    if (!meta.eventId) throw new DomainError('validation_failed', 'An event is required');
    const rows = await attendeeTicketsTx(tx, meta.eventId, ids);
    const byOrder = new Map<string, string[]>();
    for (const r of rows)
      if (r.ok) byOrder.set(r.ticket.orderId, [...(byOrder.get(r.ticket.orderId) ?? []), r.ticket.id]);
    const voided = new Set<string>();
    const cancelledAttendees: string[] = [];
    for (const [orderId, ticketIds] of byOrder) {
      const done = await voidTicketsTx(tx, ctx, { orderId, ticketIds, reason: 'cancelled' });
      for (const t of done) {
        voided.add(t.id);
        await voidSeatTx(tx, ctx, t.id);
        if (t.attendeeId) cancelledAttendees.push(t.attendeeId);
      }
    }
    // A guest seat the organizer gave a ticket holder goes back too.
    await releaseAttendeeSeatsTx(tx, ctx, cancelledAttendees);
    if (voided.size)
      meta.emit({
        type: 'tickets.cancelled',
        version: 1,
        aggregateType: 'bulk_operation',
        aggregateId: meta.operationId,
        payload: {
          orgId: ctx.orgId,
          operationId: meta.operationId,
          eventId: meta.eventId,
          ticketIds: [...voided],
        },
      });
    return {
      results: rows.map((r) =>
        r.ok
          ? voided.has(r.ticket.id)
            ? { id: r.attendeeId, ok: true }
            : { id: r.attendeeId, ok: false, code: 'ticket_void' }
          : { id: r.attendeeId, ok: false, code: r.code },
      ),
    };
  },
});

export const ticketCancelBulk = bulkCommands(ticketCancelAction);
