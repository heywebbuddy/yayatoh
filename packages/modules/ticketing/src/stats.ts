import type { TenantTx } from '@yayatoh/db';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { ticketClaims, tickets, ticketTypes } from './schema.ts';

export interface TicketTypeStats {
  readonly ticketTypeId: string;
  readonly name: string;
  readonly currency: string;
  /** Places for sale (`quantity_total`); 0 for an archived type. */
  readonly capacity: number;
  /** Tickets issued and not void (refunded or lost-dispute tickets are void). */
  readonly valid: number;
  readonly archived: boolean;
}

/**
 * Per ticket type of one event: capacity and valid tickets (reports, M1.12). Archived types
 * appear only while they still hold valid tickets; their places no longer count as capacity.
 */
export async function ticketTypeStatsTx(tx: TenantTx, eventId: string): Promise<TicketTypeStats[]> {
  const rows = await tx
    .select({
      ticketTypeId: ticketTypes.id,
      name: ticketTypes.name,
      currency: ticketTypes.currency,
      quantityTotal: ticketTypes.quantityTotal,
      archived: sql<boolean>`${ticketTypes.archivedAt} is not null`,
      valid: sql<number>`count(${tickets.id}) filter (where ${tickets.status} = 'active')::int`,
    })
    .from(ticketTypes)
    .leftJoin(tickets, and(eq(tickets.ticketTypeId, ticketTypes.id), eq(tickets.orgId, ticketTypes.orgId)))
    .where(eq(ticketTypes.eventId, eventId))
    .groupBy(ticketTypes.id)
    .orderBy(asc(ticketTypes.sortOrder), asc(ticketTypes.createdAt));
  return rows
    .filter((r) => !r.archived || r.valid > 0)
    .map((r) => ({
      ticketTypeId: r.ticketTypeId,
      name: r.name,
      currency: r.currency,
      capacity: r.archived ? 0 : r.quantityTotal,
      valid: r.valid,
      archived: r.archived,
    }));
}

/**
 * Tickets handed on (M3.1 metrics): active tickets of one event that someone claimed through a
 * claim link. Counts only; no ticket or holder rows.
 */
export async function ticketsDistributedTx(tx: TenantTx, eventId: string): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(distinct ${tickets.id})::int` })
    .from(tickets)
    .innerJoin(
      ticketClaims,
      and(eq(ticketClaims.ticketId, tickets.id), eq(ticketClaims.orgId, tickets.orgId)),
    )
    .where(
      and(eq(tickets.eventId, eventId), eq(tickets.status, 'active'), isNotNull(ticketClaims.claimedAt)),
    );
  return r?.n ?? 0;
}

/** The orders holding a ticket with this printed short code at one event (booking search). */
export async function orderIdsByShortCodeTx(tx: TenantTx, eventId: string, code: string): Promise<string[]> {
  const c = code.trim().toUpperCase();
  if (!/^[2-9A-HJKMNP-TV-Z]{8}$/.test(c)) return [];
  const rows = await tx
    .selectDistinct({ orderId: tickets.orderId })
    .from(tickets)
    .where(and(eq(tickets.eventId, eventId), eq(tickets.shortCode, c)));
  return rows.map((r) => r.orderId);
}
