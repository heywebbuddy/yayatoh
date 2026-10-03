import type { TenantTx } from '@yayatoh/db';
import { livePortalAccountsTx } from '@yayatoh/events';
import { and, asc, count, countDistinct, eq, inArray, lte } from 'drizzle-orm';
import { exhibitors, rooms, sessionDetails, sessions, sponsors, sponsorTiers } from './schema.ts';
import { portalTaskAssignees, portalTasks } from './schema-portal.ts';

/**
 * M5.9a conference Command Center pack: the program's counts the alert rules and the Command
 * Center widgets read (counts and titles only, inside the caller's tenant transaction). Nothing
 * here writes, and nothing here names a person.
 */

/** One session's places: its own capacity and enrolled count, and the room it is in. */
export interface SessionFill {
  readonly sessionId: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly roomName: string | null;
  readonly roomCapacity: number | null;
  /** The session's capacity (null = no limit). */
  readonly capacity: number | null;
  /** Places held (enrolled and offered, M5.2b's counter). */
  readonly enrolled: number;
}

/** Every session of an event with its places, in agenda order. */
export async function sessionFillTx(tx: TenantTx, eventId: string): Promise<SessionFill[]> {
  const rows = await tx
    .select({
      sessionId: sessions.id,
      title: sessions.title,
      startsAt: sessions.startsAt,
      endsAt: sessions.endsAt,
      roomName: rooms.name,
      roomCapacity: rooms.capacity,
      capacity: sessionDetails.capacity,
      enrolled: sessionDetails.enrolled,
    })
    .from(sessions)
    .leftJoin(
      sessionDetails,
      and(eq(sessionDetails.orgId, sessions.orgId), eq(sessionDetails.sessionId, sessions.id)),
    )
    .leftJoin(rooms, and(eq(rooms.orgId, sessions.orgId), eq(rooms.id, sessions.roomId)))
    .where(eq(sessions.eventId, eventId))
    .orderBy(asc(sessions.startsAt), asc(sessions.title));
  return rows.map((r) => ({ ...r, enrolled: r.enrolled ?? 0 }));
}

/** One exhibitor and how many people it has (live portal accounts: invited or signed in). */
export interface ExhibitorStaffing {
  readonly exhibitorId: string;
  readonly name: string;
  readonly people: number;
}

/** The event's exhibitors with their live people (admins and staff), by name. */
export async function exhibitorStaffingTx(
  tx: TenantTx,
  eventId: string,
  now: Date,
): Promise<ExhibitorStaffing[]> {
  const list = await tx
    .select({ id: exhibitors.id, name: exhibitors.name })
    .from(exhibitors)
    .where(eq(exhibitors.eventId, eventId))
    .orderBy(asc(exhibitors.name), asc(exhibitors.id));
  if (list.length === 0) return [];
  const people = new Map<string, number>();
  for (const a of await livePortalAccountsTx(
    tx,
    eventId,
    'exhibitor',
    list.map((e) => e.id),
    now,
  ))
    people.set(a.subjectId, (people.get(a.subjectId) ?? 0) + 1);
  return list.map((e) => ({ exhibitorId: e.id, name: e.name, people: people.get(e.id) ?? 0 }));
}

/** Speaker tasks still open past their due time: how many assignments, and how many speakers. */
export async function overdueSpeakerTasksTx(
  tx: TenantTx,
  eventId: string,
  now: Date,
): Promise<{ assignments: number; speakers: number }> {
  const [r] = await tx
    .select({ n: count(), speakers: countDistinct(portalTaskAssignees.subjectId) })
    .from(portalTaskAssignees)
    .innerJoin(
      portalTasks,
      and(eq(portalTasks.orgId, portalTaskAssignees.orgId), eq(portalTasks.id, portalTaskAssignees.taskId)),
    )
    .where(
      and(
        eq(portalTaskAssignees.eventId, eventId),
        eq(portalTasks.subjectKind, 'speaker'),
        eq(portalTaskAssignees.status, 'open'),
        lte(portalTasks.dueAt, now),
      ),
    );
  return { assignments: Number(r?.n ?? 0), speakers: Number(r?.speakers ?? 0) };
}

/** The event's sponsors per tier (tier order), for the sponsor activity tile. */
export async function sponsorTierCountsTx(
  tx: TenantTx,
  eventId: string,
): Promise<{ tier: string; sponsors: number }[]> {
  const tiers = await tx
    .select({ id: sponsorTiers.id, name: sponsorTiers.name })
    .from(sponsorTiers)
    .where(eq(sponsorTiers.eventId, eventId))
    .orderBy(asc(sponsorTiers.position), asc(sponsorTiers.name));
  if (tiers.length === 0) return [];
  const counts = new Map(
    (
      await tx
        .select({ tierId: sponsors.tierId, n: count() })
        .from(sponsors)
        .where(
          and(
            eq(sponsors.eventId, eventId),
            inArray(
              sponsors.tierId,
              tiers.map((t) => t.id),
            ),
          ),
        )
        .groupBy(sponsors.tierId)
    ).map((r) => [r.tierId, Number(r.n)] as const),
  );
  return tiers.map((t) => ({ tier: t.name, sponsors: counts.get(t.id) ?? 0 }));
}
