import type { TenantTx } from '@yayatoh/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { rooms, sessionDetails, sessions } from './schema.ts';

/**
 * M5.6a: what a session door needs to know about its session, read through program's own
 * functions (checkin never touches the `program` schema): its times, its room and how many the
 * room holds, and whether the session needs an enrollment (optional with a capacity, P5-9).
 */
export interface SessionDoorFacts {
  readonly sessionId: string;
  readonly eventId: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly roomName: string | null;
  readonly roomCapacity: number | null;
  readonly enrollmentRequired: boolean;
}

/** Some sessions by id (any event of the org), in agenda order. */
export async function sessionDoorFactsTx(
  tx: TenantTx,
  sessionIds: readonly string[],
): Promise<SessionDoorFacts[]> {
  if (sessionIds.length === 0) return [];
  const rows = await tx
    .select({
      sessionId: sessions.id,
      eventId: sessions.eventId,
      title: sessions.title,
      startsAt: sessions.startsAt,
      endsAt: sessions.endsAt,
      roomName: rooms.name,
      roomCapacity: rooms.capacity,
      admission: sessionDetails.admission,
      capacity: sessionDetails.capacity,
    })
    .from(sessions)
    .leftJoin(
      sessionDetails,
      and(eq(sessionDetails.orgId, sessions.orgId), eq(sessionDetails.sessionId, sessions.id)),
    )
    .leftJoin(rooms, and(eq(rooms.orgId, sessions.orgId), eq(rooms.id, sessions.roomId)))
    .where(inArray(sessions.id, [...sessionIds]))
    .orderBy(asc(sessions.startsAt), asc(sessions.title));
  return rows.map(({ admission, capacity, ...r }) => ({
    ...r,
    enrollmentRequired: admission === 'optional' && capacity !== null,
  }));
}

/** An event's sessions for a session-door picker (id, title, times, room), in agenda order. */
export async function sessionDoorChoicesTx(tx: TenantTx, eventId: string): Promise<SessionDoorFacts[]> {
  const ids = await tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.eventId, eventId));
  return sessionDoorFactsTx(
    tx,
    ids.map((r) => r.id),
  );
}

/** All session ids of an event (registration's admission-level check needs the full list). */
export async function eventSessionIdsTx(tx: TenantTx, eventId: string): Promise<string[]> {
  return (await tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.eventId, eventId))).map(
    (r) => r.id,
  );
}
