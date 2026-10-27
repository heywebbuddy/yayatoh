import { DomainError } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { moveSoldSeatTx } from '@yayatoh/seating';
import { assignTicketSeatsTx, ticketsByIdsTx, ticketsForOrderTx } from '@yayatoh/ticketing';
import { z } from 'zod';

/**
 * Move a ticket to another seat (organizer, `seating:write`): works for seats the buyer chose at
 * checkout, which the guest-seating tools can't touch. The target is a free seat, or a seat sold
 * to another ticket, and then the two tickets swap. Tickets stay valid (same code, same status);
 * the seat label printed on each ticket is updated and scanners pick the new label up with the
 * next manifest. Audited with both seats.
 */
export const moveTicketSeatCommand = tenantCommand({
  name: 'orders.moveTicketSeat',
  input: z.object({ ticketId: z.uuid(), toSeatUuid: z.uuid() }),
  output: z.object({
    swapped: z.boolean(),
    priceCategoryChanged: z.boolean(),
    moved: z.array(z.object({ ticketId: z.uuid(), fromLabel: z.string(), toLabel: z.string() })),
  }),
  entitlement: 'seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const [head] = await ticketsByIdsTx(tx, [input.ticketId]);
    if (!head) throw new DomainError('not_found', 'Ticket not found');
    if (head.status !== 'active')
      throw new DomainError('invalid_state', 'Only a valid ticket can change seat', {
        reason: 'ticket_void',
      });
    const ticket = (await ticketsForOrderTx(tx, head.orderId)).find((t) => t.id === head.id);
    if (!ticket) throw new DomainError('not_found', 'Ticket not found');
    const r = await moveSoldSeatTx(tx, ctx, {
      eventId: head.eventId,
      occurrenceId: ticket.occurrenceId ?? null,
      ticketId: ticket.id,
      toSeatUuid: input.toSeatUuid,
    });
    await assignTicketSeatsTx(
      tx,
      ctx,
      r.moved.map((m) => ({ ticketId: m.ticketId, seatLabel: m.toLabel })),
    );
    return r;
  },
  audit: (input, r) => ({
    action: 'ticket.seat_moved',
    targetType: 'ticket',
    targetId: input.ticketId,
    data: {
      toSeatUuid: input.toSeatUuid,
      swapped: r?.swapped,
      priceCategoryChanged: r?.priceCategoryChanged,
      moved: r?.moved,
    },
  }),
});
