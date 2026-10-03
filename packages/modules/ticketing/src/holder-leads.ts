import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError } from '@yayatoh/kernel';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { holderLinks, tickets } from './schema.ts';

/**
 * M5.6b "who scanned me": the event and the tickets (any status: a lead outlives a void pass) of
 * a live holder link's email. An expired or unknown link is `not_found`.
 */
export async function holderLinkTicketsTx(
  tx: TenantTx,
  ctx: Ctx,
  linkId: string,
): Promise<{ eventId: string; email: string; ticketIds: string[] }> {
  const [l] = await tx.select().from(holderLinks).where(eq(holderLinks.id, linkId));
  if (!l || l.expiresAt <= ctx.now) throw new DomainError('not_found', 'This link has expired');
  const rows = await tx
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.eventId, l.eventId), eq(sql`lower(${tickets.holderEmail})`, l.emailNorm)));
  return { eventId: l.eventId, email: l.emailNorm, ticketIds: rows.map((r) => r.id) };
}

/** M5.6b: the holder of each ticket (name and email), for lead capture's allowlisted stamp. */
export async function ticketHoldersTx(
  tx: TenantTx,
  ticketIds: readonly string[],
): Promise<Map<string, { holderName: string; holderEmail: string }>> {
  if (ticketIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: tickets.id, holderName: tickets.holderName, holderEmail: tickets.holderEmail })
    .from(tickets)
    .where(inArray(tickets.id, [...ticketIds]));
  return new Map(rows.map((r) => [r.id, { holderName: r.holderName, holderEmail: r.holderEmail }]));
}
