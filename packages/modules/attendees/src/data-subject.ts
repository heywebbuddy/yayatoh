import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  DELETE,
  defineDataSubjectContributor,
  ERASED_EMAIL,
  ERASED_NAME,
  REDACT,
  refsOf,
  type SubjectErasure,
  type SubjectRefs,
} from '@yayatoh/platform';
import { asc, inArray, or, type SQL, sql } from 'drizzle-orm';
import { attendees, importRows } from './schema.ts';

/**
 * The person's attendee records: by address, their crm contacts, and the tickets they hold (the
 * attendee row of a ticket moves with its holder).
 */
async function attendeeRowsTx(tx: TenantTx, s: DataSubject) {
  const contacts = refsOf(s, 'contact');
  const held = refsOf(s, 'ticket');
  return tx
    .select()
    .from(attendees)
    .where(
      or(
        sql`lower(btrim(${attendees.email})) = ${s.email}`,
        contacts.length ? inArray(attendees.contactId, contacts) : undefined,
        held.length ? inArray(attendees.ticketId, held) : undefined,
      ) as SQL,
    )
    .orderBy(asc(attendees.createdAt));
}

/** Staged guest-list rows that are the person: imported as one of their attendees, or holding the address. */
const importRowsOf = (s: DataSubject, ids: readonly string[]) =>
  or(
    sql`exists (select 1 from unnest(${importRows.cells}) c where lower(btrim(c)) = ${s.email})`,
    ids.length ? inArray(importRows.attendeeId, [...ids]) : undefined,
  ) as SQL;

/**
 * attendees' part of a data-subject request (M6.1c). Attendee rows keep their event, status and
 * ticket link (counts and check-in history stay right) but lose name, email and labels; staged
 * guest-list import rows that are the person are deleted.
 */
export const attendeesDataSubjects = defineDataSubjectContributor({
  module: 'attendees',
  tables: {
    'attendees.attendees': REDACT,
    'attendees.import_rows': DELETE,
  },
  async resolve(tx, s): Promise<SubjectRefs> {
    const rows = await attendeeRowsTx(tx, s);
    return {
      attendee: rows.map((a) => a.id),
      name: [...new Set(rows.map((a) => a.name).filter((n) => n && n !== ERASED_NAME))],
    };
  },
  async export(tx, s) {
    const rows = await attendeeRowsTx(tx, s);
    return {
      sections: {
        attendees: rows.map((a) => ({
          id: a.id,
          eventId: a.eventId,
          ticketId: a.ticketId,
          name: a.name,
          email: a.email,
          status: a.status,
          source: a.source,
          labels: a.labels,
          createdAt: a.createdAt,
        })),
      },
    };
  },
  async erase(tx, s, ctx): Promise<SubjectErasure> {
    const ids = (await attendeeRowsTx(tx, s)).map((a) => a.id);
    // Import rows first: they are found by the address and by the attendee they became.
    const staged = await tx.delete(importRows).where(importRowsOf(s, ids)).returning({ id: importRows.id });
    const erased = ids.length
      ? await tx
          .update(attendees)
          .set({ name: ERASED_NAME, email: ERASED_EMAIL, labels: [], updatedAt: ctx.now })
          .where(inArray(attendees.id, ids))
          .returning({ id: attendees.id })
      : [];
    return {
      erased: { 'attendees.attendees': erased.length, 'attendees.import_rows': staged.length },
    };
  },
});
