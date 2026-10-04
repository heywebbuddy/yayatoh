import type { TenantTx } from '@yayatoh/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { rooms, sessions } from './schema.ts';

/**
 * M5.10a: when each session (or its room) last changed, for the attendee's calendar feed: a
 * calendar refreshing the feed moves a session when its SEQUENCE grows. Read through program's
 * own function (registration never touches the `program` schema).
 */
export async function sessionStampsTx(
  tx: TenantTx,
  sessionIds: readonly string[],
): Promise<Map<string, Date>> {
  if (sessionIds.length === 0) return new Map();
  const rows = await tx
    .select({
      sessionId: sessions.id,
      updatedAt:
        sql<Date>`greatest(${sessions.updatedAt}, coalesce(${rooms.updatedAt}, ${sessions.updatedAt}))`.mapWith(
          (v: string | Date) => new Date(v),
        ),
    })
    .from(sessions)
    .leftJoin(rooms, and(eq(rooms.orgId, sessions.orgId), eq(rooms.id, sessions.roomId)))
    .where(inArray(sessions.id, [...sessionIds]));
  return new Map(rows.map((r) => [r.sessionId, r.updatedAt]));
}
