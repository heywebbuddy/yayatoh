import { reassignAttendeeTx } from '@yayatoh/attendees';
import { upsertContactTx } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError } from '@yayatoh/kernel';
import { eq } from 'drizzle-orm';
import { tickets } from './schema.ts';

/**
 * Name the holder of a freshly issued ticket (M5.1c group registration: each registrant of the
 * payer's order gets their own ticket). The code stays as issued (nobody else held it yet): to hand
 * a ticket on to someone else, use `reissueTicketTx`, which voids the old code.
 */
export async function nameTicketHolderTx(
  tx: TenantTx,
  ctx: Ctx,
  ticketId: string,
  holder: { name: string; email: string },
): Promise<void> {
  const [t] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for('update');
  if (!t) throw new DomainError('not_found', 'Ticket not found');
  if (t.status !== 'active') throw new DomainError('invalid_state', 'This ticket is no longer valid');
  if (t.holderName === holder.name && t.holderEmail === holder.email) return;
  await tx
    .update(tickets)
    .set({ holderName: holder.name, holderEmail: holder.email, updatedAt: ctx.now })
    .where(eq(tickets.id, t.id));
  const contact = await upsertContactTx(tx, ctx, {
    email: holder.email,
    name: holder.name,
    source: 'ticket',
  });
  if (t.attendeeId)
    await reassignAttendeeTx(tx, ctx, t.attendeeId, {
      contactId: contact.id,
      name: holder.name,
      email: holder.email,
    });
}
