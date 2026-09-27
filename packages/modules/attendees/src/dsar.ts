import type { TenantTx } from '@yayatoh/db';
import { ERASED_EMAIL, ERASED_NAME } from '@yayatoh/platform';
import { asc, inArray, or, sql } from 'drizzle-orm';
import { attendees, importRows } from './schema.ts';

const matches = (emailNorm: string, contactIds: readonly string[]) =>
  or(
    sql`lower(btrim(${attendees.email})) = ${emailNorm}`,
    contactIds.length ? inArray(attendees.contactId, [...contactIds]) : undefined,
  );

/** A person's attendee records across the org's events, allowlisted (M1.14c). */
export async function attendeesDsarTx(tx: TenantTx, emailNorm: string, contactIds: readonly string[] = []) {
  const rows = await tx
    .select()
    .from(attendees)
    .where(matches(emailNorm, contactIds))
    .orderBy(asc(attendees.createdAt));
  return rows.map((a) => ({
    id: a.id,
    eventId: a.eventId,
    name: a.name,
    email: a.email,
    status: a.status,
    source: a.source,
    labels: a.labels,
    createdAt: a.createdAt,
  }));
}

/**
 * Erase: attendee rows keep their event, status and ticket link (counts and check-in history
 * stay correct) but lose name, email and labels. Staged import rows that contain the address
 * are deleted.
 */
export async function eraseAttendeesDsarTx(
  tx: TenantTx,
  emailNorm: string,
  contactIds: readonly string[],
  now: Date,
) {
  const erased = await tx
    .update(attendees)
    .set({ name: ERASED_NAME, email: ERASED_EMAIL, labels: [], updatedAt: now })
    .where(matches(emailNorm, contactIds))
    .returning({ id: attendees.id });
  const rows = await tx
    .delete(importRows)
    .where(sql`exists (select 1 from unnest(${importRows.cells}) c where lower(btrim(c)) = ${emailNorm})`)
    .returning({ id: importRows.id });
  return { erased: erased.length, importRowsDeleted: rows.length };
}
