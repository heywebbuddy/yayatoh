import type { TenantTx } from '@yayatoh/db';
import { and, eq, inArray } from 'drizzle-orm';
import { registrants } from './schema.ts';

/**
 * M5.5c kiosk self-print: whether this address has a registration at the event that has no badge
 * yet because it is still waiting (an application not yet decided, an approval not yet paid for,
 * a reservation not yet confirmed). The kiosk sends such a person to the desk.
 */
export async function hasWaitingRegistrationTx(tx: TenantTx, eventId: string, email: string): Promise<boolean> {
  const [r] = await tx
    .select({ id: registrants.id })
    .from(registrants)
    .where(
      and(
        eq(registrants.eventId, eventId),
        eq(registrants.email, email.trim().toLowerCase()),
        inArray(registrants.status, ['pending', 'approved', 'reserved']),
      ),
    )
    .limit(1);
  return r !== undefined;
}
