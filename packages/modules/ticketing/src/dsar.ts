import type { TenantTx } from '@yayatoh/db';
import { ERASED_EMAIL, ERASED_NAME } from '@yayatoh/platform';
import { asc, eq, inArray, or, sql } from 'drizzle-orm';
import { holderLinks, ticketClaims, tickets } from './schema.ts';

const holderIs = (emailNorm: string) => sql`lower(btrim(${tickets.holderEmail})) = ${emailNorm}`;

/**
 * A person's tickets (as holder, or bought in their orders), claim links sent to or claimed by
 * them, and holder magic links, allowlisted (M1.14c). No signing material, tokens or hashes.
 */
export async function ticketsDsarTx(tx: TenantTx, emailNorm: string, orderIds: readonly string[] = []) {
  const rows = await tx
    .select()
    .from(tickets)
    .where(or(holderIs(emailNorm), orderIds.length ? inArray(tickets.orderId, [...orderIds]) : undefined))
    .orderBy(asc(tickets.createdAt));
  const claims = await tx
    .select()
    .from(ticketClaims)
    .where(
      or(
        sql`lower(${ticketClaims.recipientEmail}) = ${emailNorm}`,
        sql`lower(${ticketClaims.claimedByEmail}) = ${emailNorm}`,
      ),
    );
  const links = await tx.select().from(holderLinks).where(eq(holderLinks.emailNorm, emailNorm));
  return {
    tickets: rows.map((t) => ({
      id: t.id,
      eventId: t.eventId,
      orderId: t.orderId,
      shortCode: t.shortCode,
      status: t.status,
      holderName: t.holderName,
      holderEmail: t.holderEmail,
      seatLabel: t.seatLabel,
      createdAt: t.createdAt,
    })),
    claims: claims.map((c) => ({
      ticketId: c.ticketId,
      recipientEmail: c.recipientEmail,
      claimedByEmail: c.claimedByEmail,
      createdAt: c.createdAt,
      claimedAt: c.claimedAt,
      revokedAt: c.revokedAt,
    })),
    holderLinks: links.map((l) => ({ eventId: l.eventId, createdAt: l.createdAt, expiresAt: l.expiresAt })),
  };
}

/**
 * Erase the person as a ticket holder: tickets stay valid (someone may still use them; the
 * organizer's counts stay right) but lose the name and email, and `updated_at` moves so door
 * devices sync the change. Claim links lose the address; open ones are revoked. Holder magic
 * links are deleted.
 */
export async function eraseTicketsDsarTx(tx: TenantTx, emailNorm: string, now: Date) {
  const erased = await tx
    .update(tickets)
    .set({ holderName: ERASED_NAME, holderEmail: ERASED_EMAIL, updatedAt: now })
    .where(holderIs(emailNorm))
    .returning({ id: tickets.id, status: tickets.status });
  const recipient = await tx
    .update(ticketClaims)
    .set({
      recipientEmail: null,
      revokedAt: sql`coalesce(${ticketClaims.revokedAt}, case when ${ticketClaims.claimedAt} is null then ${now} end)`,
      updatedAt: now,
    })
    .where(sql`lower(${ticketClaims.recipientEmail}) = ${emailNorm}`)
    .returning({ id: ticketClaims.id });
  const claimed = await tx
    .update(ticketClaims)
    .set({ claimedByEmail: null, updatedAt: now })
    .where(sql`lower(${ticketClaims.claimedByEmail}) = ${emailNorm}`)
    .returning({ id: ticketClaims.id });
  const links = await tx
    .delete(holderLinks)
    .where(eq(holderLinks.emailNorm, emailNorm))
    .returning({ id: holderLinks.id });
  return {
    erased: erased.length,
    activeKept: erased.filter((t) => t.status === 'active').length,
    claims: recipient.length + claimed.length,
    holderLinksDeleted: links.length,
  };
}
