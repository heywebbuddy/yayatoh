import type { TenantTx } from '@yayatoh/db';
import { type Ctx, requireOrg } from '@yayatoh/kernel';
import { emitEvents } from '@yayatoh/platform';
import { and, eq, inArray } from 'drizzle-orm';
import { seatAssignments } from './schema.ts';

/** Which of these attendees an organizer seated at this event (M1.7d assignments; M3.6 audiences). */
export async function seatedAttendeeIdsTx(
  tx: TenantTx,
  eventId: string,
  attendeeIds: readonly string[],
): Promise<Set<string>> {
  if (attendeeIds.length === 0) return new Set();
  const rows = await tx
    .select({ attendeeId: seatAssignments.attendeeId })
    .from(seatAssignments)
    .where(and(eq(seatAssignments.eventId, eventId), inArray(seatAssignments.attendeeId, [...attendeeIds])));
  return new Set(rows.map((r) => r.attendeeId));
}

/**
 * Tell the audiences projector (M3.6) who was seated or unseated: `seating.assignments_changed@1`
 * with the attendees, or `attendeeIds: null` when a plan edit may have moved anyone at the event.
 * Written to the outbox in the caller's transaction; never names seats or people.
 */
export async function emitAssignmentsChangedTx(
  tx: TenantTx,
  ctx: Ctx,
  rows: readonly { readonly eventId: string; readonly attendeeId: string | null }[],
): Promise<void> {
  const byEvent = new Map<string, Set<string> | null>();
  for (const r of rows) {
    if (r.attendeeId === null || byEvent.get(r.eventId) === null) {
      byEvent.set(r.eventId, null);
      continue;
    }
    const set = byEvent.get(r.eventId) ?? new Set<string>();
    set.add(r.attendeeId);
    byEvent.set(r.eventId, set);
  }
  if (byEvent.size === 0) return;
  const orgId = requireOrg(ctx);
  await emitEvents(
    tx,
    ctx,
    [...byEvent].map(([eventId, ids]) => ({
      type: 'seating.assignments_changed',
      version: 1,
      aggregateType: 'event',
      aggregateId: eventId,
      payload: { orgId, eventId, attendeeIds: ids === null ? null : [...ids].sort() },
    })),
  );
}
