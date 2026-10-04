import type { TenantTx } from '@yayatoh/db';
import {
  DELETE,
  defineDataSubjectContributor,
  notSubject,
  REDACT,
  refsOf,
  type SubjectErasure,
} from '@yayatoh/platform';
import { asc, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import { watchMinutes, zoomAttendance, zoomRegistrants } from './schema.ts';

/** A person's watch time per session (their tickets), for the access document. */
async function watchTimeTx(tx: TenantTx, ticketIds: readonly string[]) {
  if (ticketIds.length === 0) return [];
  return tx
    .select({ sessionId: watchMinutes.sessionId, minutes: sql<number>`count(*)::int` })
    .from(watchMinutes)
    .where(inArray(watchMinutes.ticketId, [...ticketIds]))
    .groupBy(watchMinutes.sessionId);
}

/** M6.9b: Zoom rows about the person: by their address, or their tickets. */
const byPerson = (
  t: typeof zoomRegistrants | typeof zoomAttendance,
  s: { email: string; tickets: string[] },
): SQL =>
  (s.tickets.length ? or(eq(t.email, s.email), inArray(t.ticketId, s.tickets)) : eq(t.email, s.email)) as SQL;

/**
 * virtual's part of a data-subject request (M6.9a, M6.9b). Streams hold the provider's ids only
 * (the playback id reaches ticket holders in their player); viewings and watch minutes hold ticket
 * ids and times, kept as the streaming meter (D24) and pointing at no one once ticketing redacts
 * the ticket. Zoom registrant rows (address and name) are deleted; Zoom attendance segments keep
 * their times (the CE evidence of the session's totals) without the address or the ticket.
 * Exported: minutes watched per session, Zoom registrations and attendance segments.
 */
export const virtualDataSubjects = defineDataSubjectContributor({
  module: 'virtual',
  tables: {
    'virtual.streams': notSubject(
      "a session's live stream: provider ids and the playback id every viewer of the session shares; no person",
    ),
    'virtual.zoom_registrants': DELETE,
    'virtual.zoom_attendance': REDACT,
  },
  async export(tx: TenantTx, s) {
    const who = { email: s.email, tickets: refsOf(s, 'ticket') };
    const registrations = await tx
      .select({
        sessionId: zoomRegistrants.sessionId,
        email: zoomRegistrants.email,
        firstName: zoomRegistrants.firstName,
        lastName: zoomRegistrants.lastName,
        createdAt: zoomRegistrants.createdAt,
      })
      .from(zoomRegistrants)
      .where(byPerson(zoomRegistrants, who))
      .orderBy(asc(zoomRegistrants.createdAt));
    const attended = await tx
      .select({
        sessionId: zoomAttendance.sessionId,
        joinedAt: zoomAttendance.joinedAt,
        leftAt: zoomAttendance.leftAt,
      })
      .from(zoomAttendance)
      .where(byPerson(zoomAttendance, who))
      .orderBy(asc(zoomAttendance.joinedAt));
    return {
      sections: {
        watchTime: await watchTimeTx(tx, who.tickets),
        zoomRegistrations: registrations,
        zoomAttendance: attended,
      },
    };
  },
  async erase(tx, s, ctx): Promise<SubjectErasure> {
    const who = { email: s.email, tickets: refsOf(s, 'ticket') };
    const gone = await tx
      .delete(zoomRegistrants)
      .where(byPerson(zoomRegistrants, who))
      .returning({ id: zoomRegistrants.id });
    const redacted = await tx
      .update(zoomAttendance)
      .set({ email: null, ticketId: null, updatedAt: ctx.now })
      .where(byPerson(zoomAttendance, who))
      .returning({ id: zoomAttendance.id });
    return {
      erased: {
        ...(gone.length ? { 'virtual.zoom_registrants': gone.length } : {}),
        ...(redacted.length ? { 'virtual.zoom_attendance': redacted.length } : {}),
      },
    };
  },
});
