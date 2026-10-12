import type { TenantTx } from '@yayatoh/db';
import { livePortalAccountsTx } from '@yayatoh/events';
import { and, asc, count, countDistinct, eq, inArray, lte, sql } from 'drizzle-orm';
import { exhibitors, rooms, sessionDetails, sessions, sponsors, sponsorTiers } from './schema.ts';
import { portalTaskAssignees, portalTasks } from './schema-portal.ts';
import { sponsorDeliverables, sponsoredSessions, sponsorGrants } from './schema-sponsors.ts';

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

/** Sponsorship at a glance (agreement §6, dashboard phase 2: sponsor metrics). Counts and sums only. */
export interface SponsorMetrics {
  /** Packages in force, and reserved or bought but not yet paid or activated. */
  readonly packages: { readonly active: number; readonly pending: number };
  /** What active packages bring in, per currency (minor units; organizer grants at their price). */
  readonly revenue: readonly { readonly currency: string; readonly minor: number }[];
  /** Package deliverables: done of all, and those past due and still open. */
  readonly deliverables: { readonly done: number; readonly total: number; readonly overdue: number };
  /** Sessions a sponsor presents (their ids, for attendance). */
  readonly sponsoredSessionIds: readonly string[];
}

export async function sponsorMetricsTx(tx: TenantTx, eventId: string, now: Date): Promise<SponsorMetrics> {
  const grants = await tx
    .select({
      status: sponsorGrants.status,
      currency: sponsorGrants.currency,
      n: count(),
      minor: sql<string>`coalesce(sum(${sponsorGrants.priceMinor}), 0)`,
    })
    .from(sponsorGrants)
    .where(eq(sponsorGrants.eventId, eventId))
    .groupBy(sponsorGrants.status, sponsorGrants.currency);
  const [d] = await tx
    .select({
      total: count(),
      done: sql<number>`count(*) filter (where ${sponsorDeliverables.status} = 'done')::int`,
      overdue: sql<number>`count(*) filter (where ${sponsorDeliverables.status} = 'open' and ${sponsorDeliverables.dueAt} <= ${now.toISOString()}::timestamptz)::int`,
    })
    .from(sponsorDeliverables)
    .where(eq(sponsorDeliverables.eventId, eventId));
  const sessionRows = await tx
    .selectDistinct({ sessionId: sponsoredSessions.sessionId })
    .from(sponsoredSessions)
    .where(eq(sponsoredSessions.eventId, eventId));
  const by = (status: string) => grants.filter((g) => g.status === status);
  return {
    packages: {
      active: by('active').reduce((a, g) => a + Number(g.n), 0),
      pending: by('pending').reduce((a, g) => a + Number(g.n), 0),
    },
    revenue: by('active')
      .map((g) => ({ currency: g.currency, minor: Number(g.minor) }))
      .filter((r) => r.minor > 0)
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    deliverables: {
      done: Number(d?.done ?? 0),
      total: Number(d?.total ?? 0),
      overdue: Number(d?.overdue ?? 0),
    },
    sponsoredSessionIds: sessionRows.map((r) => r.sessionId),
  };
}
