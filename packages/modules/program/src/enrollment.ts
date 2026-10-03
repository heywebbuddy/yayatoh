import type { TenantTx } from '@yayatoh/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Admission } from './domain/agenda.ts';
import { rooms, sessionDetails, sessionGroups, sessions } from './schema.ts';

/**
 * M5.2b: what the `registration` module's enrollment needs to know about sessions, read through
 * program's own functions (registration never touches the `program` schema). The capacity
 * counter itself still moves only through `claimSessionPlaceTx` / `releaseSessionPlaceTx`.
 */
export interface EnrollableSession {
  readonly sessionId: string;
  readonly eventId: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly roomName: string | null;
  readonly admission: Admission;
  readonly groupId: string | null;
  readonly groupName: string | null;
  readonly capacity: number | null;
  readonly enrolled: number;
  readonly enrollmentOpen: boolean;
}

const columns = {
  sessionId: sessions.id,
  eventId: sessions.eventId,
  title: sessions.title,
  startsAt: sessions.startsAt,
  endsAt: sessions.endsAt,
  roomName: rooms.name,
  admission: sessionDetails.admission,
  groupId: sessionDetails.groupId,
  groupName: sessionGroups.name,
  capacity: sessionDetails.capacity,
  enrolled: sessionDetails.enrolled,
  enrollmentOpen: sessionDetails.enrollmentOpen,
};

const base = (tx: TenantTx) =>
  tx
    .select(columns)
    .from(sessions)
    .innerJoin(
      sessionDetails,
      and(eq(sessionDetails.orgId, sessions.orgId), eq(sessionDetails.sessionId, sessions.id)),
    )
    .leftJoin(rooms, and(eq(rooms.orgId, sessions.orgId), eq(rooms.id, sessions.roomId)))
    .leftJoin(
      sessionGroups,
      and(eq(sessionGroups.orgId, sessionDetails.orgId), eq(sessionGroups.id, sessionDetails.groupId)),
    );

const toSession = (r: Omit<EnrollableSession, 'admission'> & { admission: string }): EnrollableSession => ({
  ...r,
  admission: r.admission === 'optional' ? 'optional' : 'included',
});

/** Every session of an event with its enrollment facts, in agenda order. */
export async function enrollableSessionsTx(tx: TenantTx, eventId: string): Promise<EnrollableSession[]> {
  const rows = await base(tx)
    .where(eq(sessions.eventId, eventId))
    .orderBy(asc(sessions.startsAt), asc(sessions.endsAt), asc(sessions.title));
  return rows.map(toSession);
}

/** Some sessions by id (any event of the org), in agenda order. */
export async function enrollableSessionsByIdTx(
  tx: TenantTx,
  sessionIds: readonly string[],
): Promise<EnrollableSession[]> {
  if (sessionIds.length === 0) return [];
  const rows = await base(tx)
    .where(inArray(sessions.id, [...sessionIds]))
    .orderBy(asc(sessions.startsAt), asc(sessions.endsAt), asc(sessions.title));
  return rows.map(toSession);
}

/**
 * Lock a session's counter row for an enrollment decision (enrol, join the line, promote): every
 * change to one session's places and line serializes on it, so "people are waiting" and "a place
 * is free" are read and acted on together. Returns the session's facts after the lock, or null.
 */
export async function lockEnrollableSessionTx(
  tx: TenantTx,
  sessionId: string,
): Promise<EnrollableSession | null> {
  const [locked] = await tx
    .select({ id: sessionDetails.id })
    .from(sessionDetails)
    .where(eq(sessionDetails.sessionId, sessionId))
    .for('update');
  if (!locked) return null;
  const [row] = await base(tx).where(eq(sessions.id, sessionId));
  return row ? toSession(row) : null;
}
