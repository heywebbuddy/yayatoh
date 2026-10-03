import type { TenantTx } from '@yayatoh/db';
import { eq } from 'drizzle-orm';
import { guests } from './schema.ts';

/**
 * First and last names of an event's guests (M4.4b), for the day of: the A–Z board sorts by last
 * name, and check-in confirms a guest belongs to the event. Names only; never a private answer.
 */
export async function guestNamesTx(
  tx: TenantTx,
  eventId: string,
): Promise<Map<string, { readonly firstName: string | null; readonly lastName: string | null }>> {
  const rows = await tx
    .select({ id: guests.id, firstName: guests.firstName, lastName: guests.lastName })
    .from(guests)
    .where(eq(guests.eventId, eventId));
  return new Map(rows.map((r) => [r.id, { firstName: r.firstName, lastName: r.lastName }]));
}
