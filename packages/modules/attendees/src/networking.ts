import type { TenantTx } from '@yayatoh/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { attendees } from './schema.ts';

/**
 * Lookups for networking (M5.8a, engagement): who a verified address is at an event, and which
 * people still hold an active place there. Internal fields only; nothing here is serialized as is.
 */

/** The person behind an address at an event: their contact and first active record's name. */
export async function activeAttendeeByEmailTx(
  tx: TenantTx,
  eventId: string,
  email: string,
): Promise<{ contactId: string; name: string } | null> {
  const [row] = await tx
    .select({ contactId: attendees.contactId, name: attendees.name })
    .from(attendees)
    .where(
      and(
        eq(attendees.eventId, eventId),
        eq(attendees.status, 'active'),
        sql`lower(${attendees.email}) = ${email.trim().toLowerCase()}`,
      ),
    )
    .orderBy(asc(attendees.createdAt))
    .limit(1);
  return row ?? null;
}

/** Of these contacts, the ones with an active record at the event. */
export async function activeEventContactsTx(
  tx: TenantTx,
  eventId: string,
  contactIds: readonly string[],
): Promise<Set<string>> {
  if (contactIds.length === 0) return new Set();
  const rows = await tx
    .selectDistinct({ contactId: attendees.contactId })
    .from(attendees)
    .where(
      and(
        eq(attendees.eventId, eventId),
        eq(attendees.status, 'active'),
        inArray(attendees.contactId, [...contactIds]),
      ),
    );
  return new Set(rows.map((r) => r.contactId));
}
