import type { TenantTx } from '@yayatoh/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { ticketTypes } from './schema.ts';

/** M6.9a: an event's live ticket types (id and name), in their order, for access modes. */
export async function ticketTypeNamesTx(
  tx: TenantTx,
  eventId: string,
): Promise<{ readonly id: string; readonly name: string }[]> {
  return tx
    .select({ id: ticketTypes.id, name: ticketTypes.name })
    .from(ticketTypes)
    .where(and(eq(ticketTypes.eventId, eventId), isNull(ticketTypes.archivedAt)))
    .orderBy(asc(ticketTypes.sortOrder), asc(ticketTypes.createdAt));
}
