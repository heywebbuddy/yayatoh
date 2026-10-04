import type { TenantTx } from '@yayatoh/db';
import { and, eq, or } from 'drizzle-orm';
import { ticketBarcodes, tickets } from './schema.ts';

/**
 * M5.5c kiosk self-print: the active ticket of this event that a scanned or typed code belongs to
 * (its active barcode payload, or its short code), or null. Possession of the code is what lets a
 * kiosk show a ticket's details: never a ticket id alone.
 */
export async function activeTicketIdForCodeTx(
  tx: TenantTx,
  eventId: string,
  code: string,
): Promise<string | null> {
  const c = code.trim();
  if (c.length < 4 || c.length > 2000) return null;
  const [byShort] = await tx
    .select({ id: tickets.id })
    .from(tickets)
    .where(
      and(eq(tickets.eventId, eventId), eq(tickets.status, 'active'), eq(tickets.shortCode, c.toUpperCase())),
    );
  if (byShort) return byShort.id;
  const [byPayload] = await tx
    .select({ id: tickets.id })
    .from(ticketBarcodes)
    .innerJoin(tickets, eq(tickets.id, ticketBarcodes.ticketId))
    .where(
      and(
        eq(ticketBarcodes.payload, c),
        eq(ticketBarcodes.active, true),
        eq(tickets.eventId, eventId),
        eq(tickets.status, 'active'),
      ),
    );
  return byPayload?.id ?? null;
}

/**
 * M5.5c: the active tickets of an event held by this address (the holder's own tickets, never the
 * other guests a buyer registered), and the short code each checks in with.
 */
export async function activeTicketsHeldByTx(
  tx: TenantTx,
  eventId: string,
  email: string,
): Promise<{ id: string; shortCode: string }[]> {
  const e = email.trim().toLowerCase();
  return tx
    .select({ id: tickets.id, shortCode: tickets.shortCode })
    .from(tickets)
    .where(
      and(
        eq(tickets.eventId, eventId),
        eq(tickets.status, 'active'),
        or(eq(tickets.holderEmail, e), eq(tickets.holderEmail, email.trim())),
      ),
    );
}

/** M5.5c: an active ticket's short code (the kiosk checks an emailed-code attendee in with it). */
export async function activeTicketShortCodeTx(
  tx: TenantTx,
  eventId: string,
  ticketId: string,
): Promise<string | null> {
  const [t] = await tx
    .select({ shortCode: tickets.shortCode })
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.eventId, eventId), eq(tickets.status, 'active')));
  return t?.shortCode ?? null;
}
