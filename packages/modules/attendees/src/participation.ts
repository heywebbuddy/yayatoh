import type { TenantTx } from '@yayatoh/db';
import { type Ctx, requireOrg } from '@yayatoh/kernel';
import { emitEvents } from '@yayatoh/platform';
import { and, eq, inArray } from 'drizzle-orm';
import { attendees } from './schema.ts';

/**
 * The attendee records behind the audiences projector (M3.6): every record (any status) of one
 * event, or of some contacts at it. Internal fields only; nothing here is serialized as is.
 */
export async function participationAttendeesTx(
  tx: TenantTx,
  eventId: string,
  contactIds: readonly string[] | null,
) {
  if (contactIds !== null && contactIds.length === 0) return [];
  return tx
    .select({
      id: attendees.id,
      contactId: attendees.contactId,
      ticketId: attendees.ticketId,
      status: attendees.status,
      labels: attendees.labels,
      createdAt: attendees.createdAt,
    })
    .from(attendees)
    .where(
      and(
        eq(attendees.eventId, eventId),
        contactIds === null ? undefined : inArray(attendees.contactId, [...contactIds]),
      ),
    );
}

/** Contacts of these attendee records, or of the records holding these tickets. */
export async function attendeeContactIdsTx(
  tx: TenantTx,
  by: { readonly attendeeIds?: readonly string[]; readonly ticketIds?: readonly string[] },
): Promise<string[]> {
  const ids = by.attendeeIds ?? [];
  const tickets = by.ticketIds ?? [];
  const out = new Set<string>();
  if (ids.length) {
    const rows = await tx
      .select({ contactId: attendees.contactId })
      .from(attendees)
      .where(inArray(attendees.id, [...ids]));
    for (const r of rows) out.add(r.contactId);
  }
  if (tickets.length) {
    const rows = await tx
      .select({ contactId: attendees.contactId })
      .from(attendees)
      .where(inArray(attendees.ticketId, [...tickets]));
    for (const r of rows) out.add(r.contactId);
  }
  return [...out];
}

/**
 * Tell the audiences projector (M3.6) that these people's records at these events changed
 * (added, cancelled, relabelled, handed over, removed). `attendees.changed@1` carries contact
 * ids, not attendee ids, so it still means something after a record is deleted (import undo).
 * Written to the outbox in the caller's transaction.
 */
export async function emitAttendeesChangedTx(
  tx: TenantTx,
  ctx: Ctx,
  rows: readonly { readonly eventId: string; readonly contactId: string }[],
): Promise<void> {
  const byEvent = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = byEvent.get(r.eventId) ?? new Set<string>();
    set.add(r.contactId);
    byEvent.set(r.eventId, set);
  }
  if (byEvent.size === 0) return;
  const orgId = requireOrg(ctx);
  await emitEvents(
    tx,
    ctx,
    [...byEvent].map(([eventId, ids]) => ({
      type: 'attendees.changed',
      version: 1,
      aggregateType: 'event',
      aggregateId: eventId,
      payload: { orgId, eventId, contactIds: [...ids].sort() },
    })),
  );
}

/** The (event, contact) pairs of these attendee records. */
export async function attendeePairsTx(tx: TenantTx, attendeeIds: readonly string[]) {
  if (attendeeIds.length === 0) return [];
  return tx
    .select({ eventId: attendees.eventId, contactId: attendees.contactId })
    .from(attendees)
    .where(inArray(attendees.id, [...attendeeIds]));
}
