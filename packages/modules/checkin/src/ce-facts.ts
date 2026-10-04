import type { TenantTx } from '@yayatoh/db';
import { asc, eq } from 'drizzle-orm';
import { sessionAttendance } from './schema.ts';

/**
 * M6.9b: an event's session door visits (scan in → scan out; out is null while still in the
 * room), every source (scan, override, self check-in), for CE credits. Ids and times only.
 */
export async function sessionVisitsTx(
  tx: TenantTx,
  eventId: string,
): Promise<{ sessionId: string; ticketId: string; inAt: Date; outAt: Date | null }[]> {
  return tx
    .select({
      sessionId: sessionAttendance.sessionId,
      ticketId: sessionAttendance.ticketId,
      inAt: sessionAttendance.inAt,
      outAt: sessionAttendance.outAt,
    })
    .from(sessionAttendance)
    .where(eq(sessionAttendance.eventId, eventId))
    .orderBy(asc(sessionAttendance.inAt), asc(sessionAttendance.id));
}
