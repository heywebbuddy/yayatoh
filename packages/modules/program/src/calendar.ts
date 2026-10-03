import type { TenantTx } from '@yayatoh/db';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { rooms, sessions } from './schema.ts';

/**
 * M6.5c: what calendar connectors (Google Calendar push, in `integrations`) read about sessions,
 * through program's own functions (integrations never touches the `program` schema). Drafts
 * (M5.3b: placeholder times) are never on a calendar. Ids, titles, times and the room's name only.
 */
export interface CalendarSession {
  readonly sessionId: string;
  readonly eventId: string;
  readonly title: string;
  readonly description: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly roomName: string | null;
  readonly updatedAt: Date;
}

const columns = {
  sessionId: sessions.id,
  eventId: sessions.eventId,
  title: sessions.title,
  description: sessions.description,
  startsAt: sessions.startsAt,
  endsAt: sessions.endsAt,
  roomName: rooms.name,
  updatedAt: sessions.updatedAt,
};

const base = (tx: TenantTx) =>
  tx
    .select(columns)
    .from(sessions)
    .leftJoin(rooms, and(eq(rooms.orgId, sessions.orgId), eq(rooms.id, sessions.roomId)));

/**
 * One keyset page of the org's placed sessions (by id, after `afterId`), of `eventIds` only when
 * given, ending after `endsAfter`. Fetches one more than `limit` so the caller knows if more follow.
 */
export async function calendarSessionsPageTx(
  tx: TenantTx,
  opts: {
    readonly afterId: string | null;
    readonly limit: number;
    readonly endsAfter: Date;
    readonly eventIds?: readonly string[] | null;
  },
): Promise<{ readonly sessions: CalendarSession[]; readonly hasMore: boolean }> {
  if (opts.eventIds && opts.eventIds.length === 0) return { sessions: [], hasMore: false };
  const rows = await base(tx)
    .where(
      and(
        eq(sessions.draft, false),
        gt(sessions.endsAt, opts.endsAfter),
        opts.afterId ? gt(sessions.id, opts.afterId) : undefined,
        opts.eventIds ? inArray(sessions.eventId, [...opts.eventIds]) : undefined,
      ),
    )
    .orderBy(asc(sessions.id))
    .limit(opts.limit + 1);
  return { sessions: rows.slice(0, opts.limit), hasMore: rows.length > opts.limit };
}

/** Placed sessions by id (gone and draft ones are left out). */
export async function calendarSessionsByIdTx(
  tx: TenantTx,
  ids: readonly string[],
): Promise<CalendarSession[]> {
  if (ids.length === 0) return [];
  return base(tx)
    .where(and(inArray(sessions.id, [...ids]), eq(sessions.draft, false)))
    .orderBy(asc(sessions.startsAt), asc(sessions.id));
}
