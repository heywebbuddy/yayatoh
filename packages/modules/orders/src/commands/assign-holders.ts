import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { nameTicketHolderTx, startTransferTx, ticketsForOrderTx } from '@yayatoh/ticketing';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { orders } from '../schema.ts';
import { hashManageToken } from './checkout.ts';

const TOKEN = /^[A-Za-z0-9_-]{40,60}$/;
const SENDABLE = ['paid', 'partially_refunded'];

export const HolderAssignment = z.object({
  ticketId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  email: z.email().max(254),
  /** Optional E.164 number: the person is also texted their ticket link. */
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/)
    .optional(),
});

/**
 * "Name all holders at once" (buyer, from the order page): the buyer gives each ticket's holder a
 * name and email in one go. A ticket for the buyer's own address only gets the name on it; a
 * ticket for anyone else is offered to them through the ticket-transfer flow (a claim link the
 * recipient gets by email, which the buyer can also copy or share on WhatsApp): the recipient
 * claims it and the code is reissued to them, so each person ends up with their own ticket. The
 * ticket type's transfer rules apply; one refusal undoes the whole batch (the error names the
 * ticket). A pending offer is replaced by a new one for the same ticket.
 */
export const assignHoldersCommand = tenantCommand({
  name: 'orders.assignHolders',
  category: 'money',
  input: z.object({
    manageToken: z.string().regex(TOKEN),
    holders: z.array(HolderAssignment).min(1).max(100),
  }),
  output: z.object({
    named: z.int(),
    offered: z.array(
      z.object({ ticketId: z.uuid(), toName: z.string(), toEmail: z.string(), claimToken: z.string() }),
    ),
  }),
  entitlement: 'ticketing',
  permission: 'public:assign_holders',
  handler: async ({ input, ctx, tx, emit }) => {
    requireOrg(ctx);
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.manageTokenHash, hashManageToken(input.manageToken)))
      .for('update');
    if (!order) throw new DomainError('not_found');
    if (!SENDABLE.includes(order.status))
      throw new DomainError('invalid_state', 'Tickets can be sent once the order is paid', {
        reason: 'order_not_paid',
      });
    const buyer = order.buyerEmail.trim().toLowerCase();
    const mine = new Map(
      (await ticketsForOrderTx(tx, order.id))
        .filter((t) => t.status === 'active' && t.holderEmail.trim().toLowerCase() === buyer)
        .map((t) => [t.id, t]),
    );
    const seen = new Set<string>();
    let named = 0;
    const offered: { ticketId: string; toName: string; toEmail: string; claimToken: string }[] = [];
    for (const h of input.holders) {
      if (!mine.has(h.ticketId) || seen.has(h.ticketId))
        throw new DomainError('validation_failed', 'Unknown ticket for this order', {
          field: 'holders',
          ticketId: h.ticketId,
        });
      seen.add(h.ticketId);
      const email = h.email.trim().toLowerCase();
      try {
        if (email === buyer) {
          await nameTicketHolderTx(tx, ctx, h.ticketId, { name: h.name, email: order.buyerEmail });
          named += 1;
        } else {
          const r = await startTransferTx(tx, ctx, emit, {
            ticketId: h.ticketId,
            toName: h.name,
            toEmail: email,
            toPhone: h.phone ?? null,
            by: 'holder',
            orderId: order.id,
          });
          offered.push({ ticketId: h.ticketId, toName: h.name, toEmail: email, claimToken: r.token });
        }
      } catch (err) {
        // Name the ticket the batch stopped at, so the page can point at it.
        if (err instanceof DomainError)
          throw new DomainError(err.code, err.message, { ...(err.details ?? {}), ticketId: h.ticketId });
        throw err;
      }
    }
    return { named, offered };
  },
  audit: (input, r) => ({
    action: 'order.holders_assigned',
    targetType: 'ticket',
    targetId: input.holders[0]?.ticketId ?? null,
    data: { tickets: input.holders.length, named: r?.named, offered: r?.offered.length },
  }),
});
