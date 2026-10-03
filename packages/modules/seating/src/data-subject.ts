import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  DELETE,
  defineDataSubjectContributor,
  type SubjectErasure,
} from '@yayatoh/platform';
import { and, asc, eq, or, type SQL, sql } from 'drizzle-orm';
import { finderCodes } from './schema.ts';
import { emailHash } from './seat-finder.ts';

/**
 * Seat-finder codes requested for the person: by address, and by the per-event keyed hash (codes
 * asked for an address that matched no attendee keep only the hash).
 */
async function finderCodesOf(tx: TenantTx, s: DataSubject): Promise<SQL> {
  const events = await tx.selectDistinct({ eventId: finderCodes.eventId }).from(finderCodes);
  let hashed: SQL[] = [];
  try {
    hashed = events.map((e) =>
      and(eq(finderCodes.eventId, e.eventId), eq(finderCodes.emailHash, emailHash(e.eventId, s.email))),
    ) as SQL[];
  } catch {
    // No app secret in this process: the stored address still finds the codes that kept one.
  }
  return or(sql`lower(btrim(${finderCodes.email})) = ${s.email}`, ...hashed) as SQL;
}

/**
 * seating's part of a data-subject request (M6.1c): the person's seat-finder codes (ten-minute,
 * single-use sign-in codes) are deleted. Seat assignments hold ticket ids only and stay with the
 * ticket, which ticketing redacts.
 */
export const seatingDataSubjects = defineDataSubjectContributor({
  module: 'seating',
  tables: { 'seating.finder_codes': DELETE },
  async export(tx, s) {
    const rows = await tx
      .select({
        eventId: finderCodes.eventId,
        email: finderCodes.email,
        requestedAt: finderCodes.createdAt,
        usedAt: finderCodes.usedAt,
      })
      .from(finderCodes)
      .where(await finderCodesOf(tx, s))
      .orderBy(asc(finderCodes.createdAt));
    return { sections: { seatFinderCodes: rows } };
  },
  async erase(tx, s): Promise<SubjectErasure> {
    const gone = await tx
      .delete(finderCodes)
      .where(await finderCodesOf(tx, s))
      .returning({ id: finderCodes.id });
    return { erased: { 'seating.finder_codes': gone.length } };
  },
});
