import type { TenantTx } from '@yayatoh/db';
import { and, eq } from 'drizzle-orm';
import { unseal } from './guests.ts';
import { partyAddressesTx } from './invite-delivery.ts';
import { guests, parties, partyInvites } from './schema.ts';

/**
 * M4.8e pledge collection, the guests side: where a paddle holder's pledge summary, invoice and
 * reminders go (P4-12). A guest's own email first, then their party's (the primary guest's, then
 * the others'); the party's invitation language. Runs in the caller's transaction (donations, a
 * higher tier); the address goes only into that donor's own messages.
 */
export async function paddleHolderContactTx(
  tx: TenantTx,
  orgId: string,
  holder: { readonly guestId: string | null; readonly partyId: string | null },
): Promise<{ partyId: string | null; email: string | null; locale: string }> {
  let partyId = holder.partyId;
  let email: string | null = null;
  if (holder.guestId) {
    const [g] = await tx
      .select({ partyId: guests.partyId, privateCiphertext: guests.privateCiphertext })
      .from(guests)
      .where(eq(guests.id, holder.guestId));
    if (g) {
      partyId = g.partyId;
      email = (await unseal(orgId, g.privateCiphertext)).email ?? null;
    }
  }
  if (!partyId) return { partyId: null, email, locale: 'en' };
  const [p] = await tx.select({ id: parties.id }).from(parties).where(and(eq(parties.id, partyId)));
  if (!p) return { partyId: null, email, locale: 'en' };
  email ??= (await partyAddressesTx(tx, orgId, partyId)).email;
  const [invite] = await tx
    .select({ locale: partyInvites.locale })
    .from(partyInvites)
    .where(eq(partyInvites.partyId, partyId));
  return { partyId, email, locale: invite?.locale ?? 'en' };
}
