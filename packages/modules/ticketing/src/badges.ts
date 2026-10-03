import type { TenantTx } from '@yayatoh/db';
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';
import { ticketBarcodes, tickets, ticketTypes } from './schema.ts';

/** An active ticket as a badge prints it (M5.5a). No email: badges never show it. */
export interface BadgeTicket {
  readonly id: string;
  readonly ticketTypeId: string;
  readonly typeName: string;
  readonly orderId: string;
  readonly serial: number;
  readonly holderName: string;
  /** The active signed yy1 code (ADR 0011), exactly as the ticket carries it. */
  readonly code: string;
  /** M5.1d: its invoice still has a balance (printing needs an audited staff override). */
  readonly paymentDue: boolean;
}

/**
 * Active tickets of one event with their active yy1 code, for badges: every ticket (optionally
 * of some ticket types), or exactly `ticketIds` (in serial order; callers re-order).
 */
export async function badgeTicketsTx(
  tx: TenantTx,
  sel: {
    readonly eventId: string;
    readonly ticketTypeIds?: readonly string[];
    readonly ticketIds?: readonly string[];
  },
): Promise<BadgeTicket[]> {
  const where: SQL[] = [eq(tickets.eventId, sel.eventId), eq(tickets.status, 'active')];
  if (sel.ticketTypeIds?.length) where.push(inArray(tickets.ticketTypeId, [...sel.ticketTypeIds]));
  if (sel.ticketIds) {
    if (sel.ticketIds.length === 0) return [];
    where.push(inArray(tickets.id, [...sel.ticketIds]));
  }
  return tx
    .select({
      id: tickets.id,
      ticketTypeId: tickets.ticketTypeId,
      typeName: ticketTypes.name,
      orderId: tickets.orderId,
      serial: tickets.serial,
      holderName: tickets.holderName,
      code: ticketBarcodes.payload,
      paymentDue: tickets.paymentDue,
    })
    .from(tickets)
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .innerJoin(
      ticketBarcodes,
      and(
        eq(ticketBarcodes.ticketId, tickets.id),
        eq(ticketBarcodes.format, 'yy1'),
        eq(ticketBarcodes.active, true),
        eq(ticketBarcodes.rev, tickets.rev),
      ),
    )
    .where(and(...where))
    .orderBy(asc(tickets.serial));
}

/** An event's ticket types (id and name, archived ones too: their tickets still print). */
export async function badgeTicketTypesTx(
  tx: TenantTx,
  eventId: string,
): Promise<{ id: string; name: string; archived: boolean }[]> {
  const rows = await tx
    .select({ id: ticketTypes.id, name: ticketTypes.name, archivedAt: ticketTypes.archivedAt })
    .from(ticketTypes)
    .where(eq(ticketTypes.eventId, eventId))
    .orderBy(asc(ticketTypes.sortOrder), asc(ticketTypes.createdAt));
  return rows.map((r) => ({ id: r.id, name: r.name, archived: r.archivedAt !== null }));
}
