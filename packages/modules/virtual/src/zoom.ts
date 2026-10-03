import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { defineSubscriber, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { sessionsOf } from '@yayatoh/program';
import { eventHoldersTx } from '@yayatoh/ticketing';
import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { accessChoicesTx, eventOrThrowTx } from './commands.ts';
import { effectiveAccess, mayWatch } from './domain/access.ts';
import { ZoomSetupDto, ZoomSyncDto } from './dto.ts';
import { watchMinutes, zoomAttendance, zoomRegistrants, zoomWebinars } from './schema.ts';
import { zoomSegmentKey } from './zoom-keys.ts';

/**
 * M6.9b: sessions delivered as Zoom webinars. The organizer links a session to its webinar id;
 * every ticket holder with online access becomes a registrant row, which the Zoom connector
 * (`integrations`, through the `IntegrationAuth` port) registers at Zoom exactly once; after the
 * session the connector pulls the webinar's participant report into `zoom_attendance`, matched to
 * tickets by the registrant's email. CE credits (`ce`) count those minutes as watch time.
 * Entitlement `virtual`; reads `events:read`, changes `events:write`.
 */

/** Zoom keeps reports this long; older webinars are not pulled again. */
export const ZOOM_REPORT_DAYS = 30;

/** A Zoom webinar id as typed ("812 3456 7890" → "81234567890"); null when it is not one. */
export function normalizeWebinarId(raw: string): string | null {
  const s = raw.replace(/[\s-]/g, '');
  return /^[0-9]{9,12}$/.test(s) ? s : null;
}

/** "Ada King Lovelace" → first "Ada", last "King Lovelace" (Zoom asks for both). */
export function splitHolderName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = (parts[0] ?? 'Guest').slice(0, 64);
  return { firstName: first, lastName: parts.slice(1).join(' ').slice(0, 64) };
}

/**
 * Make the registrant rows of an event's linked webinars match its holders with online access:
 * a missing row is added, a changed holder name or email updates the row (so it is sent again).
 * Idempotent: a second run changes nothing.
 */
export async function reconcileZoomRegistrantsTx(
  tx: TenantTx,
  orgId: string,
  eventId: string,
  now: Date,
): Promise<{ added: number; updated: number }> {
  const links = await tx.select().from(zoomWebinars).where(eq(zoomWebinars.eventId, eventId));
  if (links.length === 0) return { added: 0, updated: 0 };
  const ev = await eventOrThrowTx(tx, eventId);
  const chosen = await accessChoicesTx(tx, eventId);
  const holders = (await eventHoldersTx(tx, eventId)).filter((h) =>
    mayWatch(effectiveAccess(ev.attendanceMode, chosen.get(h.ticketTypeId) ?? null)),
  );
  const existing = await tx
    .select()
    .from(zoomRegistrants)
    .where(
      inArray(
        zoomRegistrants.webinarLinkId,
        links.map((l) => l.id),
      ),
    );
  const have = new Map(existing.map((r) => [`${r.sessionId}:${r.ticketId}`, r]));
  // One registrant per webinar and email: Zoom keeps one per address, so a holder of two tickets
  // registers once (and their attendance lands on the first ticket registered).
  const emails = new Set(existing.map((r) => `${r.webinarLinkId}:${r.email}`));
  let added = 0;
  let updated = 0;
  for (const link of links)
    for (const h of holders) {
      const email = h.holderEmail.trim().toLowerCase().slice(0, 320);
      if (email.length < 3) continue;
      const names = splitHolderName(h.holderName);
      const row = have.get(`${link.sessionId}:${h.id}`);
      const key = `${link.id}:${email}`;
      if (row?.email !== email && emails.has(key)) continue;
      emails.add(key);
      if (!row) {
        const out = await tx
          .insert(zoomRegistrants)
          .values({
            orgId,
            eventId,
            sessionId: link.sessionId,
            webinarLinkId: link.id,
            ticketId: h.id,
            email,
            ...names,
          })
          .onConflictDoNothing()
          .returning({ id: zoomRegistrants.id });
        added += out.length;
      } else if (
        row.email !== email ||
        row.firstName !== names.firstName ||
        row.lastName !== names.lastName
      ) {
        await tx
          .update(zoomRegistrants)
          .set({ email, ...names, updatedAt: now })
          .where(eq(zoomRegistrants.id, row.id));
        updated += 1;
      }
    }
  return { added, updated };
}

async function zoomSetupTx(tx: TenantTx, eventId: string): Promise<ZoomSetupDto> {
  const sessions = (await sessionsOf(tx, eventId)).filter((s) => !s.draft);
  const links = await tx.select().from(zoomWebinars).where(eq(zoomWebinars.eventId, eventId));
  const byLink = new Map(links.map((l) => [l.sessionId, l]));
  const regs = await tx
    .select({ sessionId: zoomRegistrants.sessionId, n: sql<number>`count(*)::int` })
    .from(zoomRegistrants)
    .where(eq(zoomRegistrants.eventId, eventId))
    .groupBy(zoomRegistrants.sessionId);
  const att = await tx
    .select({
      sessionId: zoomAttendance.sessionId,
      n: sql<number>`count(distinct ${zoomAttendance.ticketId})::int`,
    })
    .from(zoomAttendance)
    .where(eq(zoomAttendance.eventId, eventId))
    .groupBy(zoomAttendance.sessionId);
  const r = new Map(regs.map((x) => [x.sessionId, x.n]));
  const a = new Map(att.map((x) => [x.sessionId, x.n]));
  return {
    eventId,
    sessions: sessions.map((s) => ({
      sessionId: s.id,
      title: s.title,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      webinarId: byLink.get(s.id)?.webinarId ?? null,
      created: byLink.get(s.id)?.origin === 'created',
      registrants: r.get(s.id) ?? 0,
      attendees: a.get(s.id) ?? 0,
    })),
  };
}

/** The stream setup page's Zoom section: each session's webinar, registrants and attendees. */
export const zoomSetupQuery = tenantQuery({
  name: 'virtual.zoomSetup',
  input: z.object({ eventId: z.uuid() }),
  output: ZoomSetupDto,
  entitlement: 'virtual',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    await eventOrThrowTx(tx, input.eventId);
    return zoomSetupTx(tx, input.eventId);
  },
});

/**
 * Deliver a session as a Zoom webinar (its id from Zoom). A webinar serves one session of the
 * org. Linking another id to the session moves its registrants to the new webinar (they are sent
 * again); the holders with online access become registrants at once. `origin` (M6.10a): `created`
 * when Yayatoh created the webinar through the org's Zoom connection (only that path passes it),
 * else `linked`.
 */
export async function linkZoomWebinarTx(
  tx: TenantTx,
  ctx: Ctx,
  input: { eventId: string; sessionId: string; webinarId: string; origin?: 'linked' | 'created' },
): Promise<ZoomSyncDto> {
  const orgId = requireOrg(ctx);
  const origin = input.origin ?? 'linked';
  const webinarId = normalizeWebinarId(input.webinarId);
  if (!webinarId)
    throw new DomainError('validation_failed', 'Not a Zoom webinar id', {
      field: 'webinarId',
      reason: 'webinar_id',
    });
  const ev = await eventOrThrowTx(tx, input.eventId);
  if (ev.attendanceMode === 'in_person')
    throw new DomainError('invalid_state', 'This event is in person only', { reason: 'in_person_event' });
  const s = (await sessionsOf(tx, ev.id)).find((x) => x.id === input.sessionId && !x.draft);
  if (!s) throw new DomainError('not_found', 'Session not found', { field: 'sessionId' });
  const [taken] = await tx.select().from(zoomWebinars).where(eq(zoomWebinars.webinarId, webinarId));
  if (taken && taken.sessionId !== s.id)
    throw new DomainError('conflict', 'This webinar is linked to another session', {
      field: 'webinarId',
      reason: 'webinar_taken',
    });
  const [link] = await tx.select().from(zoomWebinars).where(eq(zoomWebinars.sessionId, s.id));
  if (!link)
    await tx.insert(zoomWebinars).values({ orgId, eventId: ev.id, sessionId: s.id, webinarId, origin });
  else if (link.webinarId !== webinarId) {
    await tx
      .update(zoomWebinars)
      .set({ webinarId, origin, updatedAt: ctx.now })
      .where(eq(zoomWebinars.id, link.id));
    // Registered at the old webinar: send them to the new one.
    await tx
      .update(zoomRegistrants)
      .set({ updatedAt: ctx.now })
      .where(eq(zoomRegistrants.webinarLinkId, link.id));
  } else if (origin === 'created' && link.origin !== 'created')
    await tx.update(zoomWebinars).set({ origin, updatedAt: ctx.now }).where(eq(zoomWebinars.id, link.id));
  return { ...(await reconcileZoomRegistrantsTx(tx, orgId, ev.id, ctx.now)), webinarId };
}

/** The organizer types a webinar's id (M6.9b). */
export const linkZoomWebinarCommand = tenantCommand({
  name: 'virtual.linkZoomWebinar',
  input: z.object({ eventId: z.uuid(), sessionId: z.uuid(), webinarId: z.string().max(40) }),
  output: ZoomSyncDto,
  entitlement: 'virtual',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => linkZoomWebinarTx(tx, ctx, { ...input, origin: 'linked' }),
  audit: (input) => ({
    action: 'virtual.zoom.link',
    targetType: 'session',
    targetId: input.sessionId,
    data: { eventId: input.eventId },
  }),
});

/** Bring the registrant rows up to date now (new holders, changed names); the next sync sends them. */
export const syncZoomRegistrantsCommand = tenantCommand({
  name: 'virtual.syncZoomRegistrants',
  input: z.object({ eventId: z.uuid() }),
  output: ZoomSyncDto,
  entitlement: 'virtual',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOrThrowTx(tx, input.eventId);
    return {
      ...(await reconcileZoomRegistrantsTx(tx, requireOrg(ctx), input.eventId, ctx.now)),
      webinarId: null,
    };
  },
  audit: (input, r) => ({
    action: 'virtual.zoom.sync_registrants',
    targetType: 'event',
    targetId: input.eventId,
    data: { added: r.added, updated: r.updated },
  }),
});

const PaidPayload = z.object({ orgId: z.uuid(), orderId: z.uuid() });

/**
 * New holders become registrants: a paid order (`order.paid@1`) reconciles every event of the org
 * with a webinar still to come. Idempotent (one row per session and ticket).
 */
export function zoomRegistrantsSubscriber() {
  return defineSubscriber({
    name: 'virtual.zoom-registrants',
    events: ['order.paid@1'],
    handle: async (tx, event) => {
      const p = PaidPayload.parse(event.payload);
      const now = new Date();
      const events = await tx
        .selectDistinct({ eventId: zoomWebinars.eventId })
        .from(zoomWebinars)
        .orderBy(asc(zoomWebinars.eventId));
      for (const { eventId } of events) {
        const sessions = await sessionsOf(tx, eventId);
        if (sessions.some((s) => s.endsAt > now)) await reconcileZoomRegistrantsTx(tx, p.orgId, eventId, now);
      }
    },
  });
}

/* --------------------------------------------------------- for the Zoom connector ---- */

export interface ZoomRegistrantRecord {
  readonly id: string;
  readonly updatedAt: Date;
  readonly fields: {
    readonly webinar_id: string;
    readonly email: string;
    readonly first_name: string;
    readonly last_name: string;
  };
}

const registrantSelect = {
  id: zoomRegistrants.id,
  updatedAt: zoomRegistrants.updatedAt,
  email: zoomRegistrants.email,
  firstName: zoomRegistrants.firstName,
  lastName: zoomRegistrants.lastName,
  webinarId: zoomWebinars.webinarId,
};

const toRecord = (r: {
  id: string;
  updatedAt: Date;
  email: string;
  firstName: string;
  lastName: string;
  webinarId: string;
}): ZoomRegistrantRecord => ({
  id: r.id,
  updatedAt: r.updatedAt,
  fields: { webinar_id: r.webinarId, email: r.email, first_name: r.firstName, last_name: r.lastName },
});

/** Registrant rows changed after `cursor` (`<iso time>|<id>`), oldest first, with its next cursor. */
export async function zoomRegistrantChangesTx(
  tx: TenantTx,
  cursor: string | null,
  limit: number,
): Promise<{ records: ZoomRegistrantRecord[]; cursor: string | null }> {
  const m = cursor ? /^(.+)\|([0-9a-f-]{36})$/.exec(cursor) : null;
  const after = m?.[1] ? new Date(m[1]) : null;
  const where =
    after && m?.[2] && !Number.isNaN(after.getTime())
      ? or(
          gt(zoomRegistrants.updatedAt, after),
          and(eq(zoomRegistrants.updatedAt, after), gt(zoomRegistrants.id, m[2])),
        )
      : undefined;
  const rows = await tx
    .select(registrantSelect)
    .from(zoomRegistrants)
    .innerJoin(zoomWebinars, eq(zoomWebinars.id, zoomRegistrants.webinarLinkId))
    .where(where)
    .orderBy(asc(zoomRegistrants.updatedAt), asc(zoomRegistrants.id))
    .limit(limit);
  const last = rows.at(-1);
  return {
    records: rows.map(toRecord),
    cursor: last ? `${last.updatedAt.toISOString()}|${last.id}` : null,
  };
}

/** One registrant row (the connector's retries); null when it is gone. */
export async function zoomRegistrantTx(tx: TenantTx, id: string): Promise<ZoomRegistrantRecord | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await tx
    .select(registrantSelect)
    .from(zoomRegistrants)
    .innerJoin(zoomWebinars, eq(zoomWebinars.id, zoomRegistrants.webinarLinkId))
    .where(eq(zoomRegistrants.id, id));
  return row ? toRecord(row) : null;
}

/** Webinars whose session has ended in the last `ZOOM_REPORT_DAYS` days (reports to pull), by id. */
export async function zoomReportWebinarsTx(tx: TenantTx, now: Date): Promise<string[]> {
  const links = await tx.select().from(zoomWebinars).orderBy(asc(zoomWebinars.webinarId));
  const out: string[] = [];
  const since = now.getTime() - ZOOM_REPORT_DAYS * 86_400_000;
  const ends = new Map<string, Map<string, Date>>();
  for (const l of links) {
    let byEvent = ends.get(l.eventId);
    if (!byEvent) {
      byEvent = new Map((await sessionsOf(tx, l.eventId)).map((s) => [s.id, s.endsAt]));
      ends.set(l.eventId, byEvent);
    }
    const end = byEvent.get(l.sessionId)?.getTime();
    if (end !== undefined && end <= now.getTime() && end >= since) out.push(l.webinarId);
  }
  return out;
}

/**
 * Record one participant segment from a webinar's report (the connector's pull, inside the sync
 * engine's command): matched to the ticket registered with that email. `localId` is the row this
 * segment wrote last time (a report pulled again updates it, never adds a second).
 */
export async function recordZoomAttendanceTx(
  tx: TenantTx,
  ctx: Ctx,
  v: { webinarId: string; email: string | null; joinedAt: Date; leftAt: Date },
  localId: string | null,
): Promise<string> {
  const orgId = requireOrg(ctx);
  const [link] = await tx.select().from(zoomWebinars).where(eq(zoomWebinars.webinarId, v.webinarId));
  if (!link) throw new DomainError('not_found', 'Webinar not linked', { reason: 'webinar_not_linked' });
  if (Number.isNaN(v.joinedAt.getTime()) || Number.isNaN(v.leftAt.getTime()) || v.leftAt < v.joinedAt)
    throw new DomainError('validation_failed', 'Bad attendance times', { field: 'left_at' });
  const email = v.email ? v.email.trim().toLowerCase().slice(0, 320) : null;
  const [reg] = email
    ? await tx
        .select({ ticketId: zoomRegistrants.ticketId })
        .from(zoomRegistrants)
        .where(and(eq(zoomRegistrants.webinarLinkId, link.id), eq(zoomRegistrants.email, email)))
        .limit(1)
    : [];
  // M6.10a: the same stay from a join/leave webhook and from this report has the same key, so it
  // is one row (the report's times win: Zoom's own record of the whole stay).
  const segmentKey = email ? zoomSegmentKey(email, v.joinedAt) : null;
  const values = {
    eventId: link.eventId,
    sessionId: link.sessionId,
    webinarLinkId: link.id,
    ticketId: reg?.ticketId ?? null,
    email,
    joinedAt: v.joinedAt,
    leftAt: v.leftAt,
    segmentKey,
  };
  if (localId) {
    const [row] = await tx
      .update(zoomAttendance)
      .set({ ...values, updatedAt: ctx.now })
      .where(eq(zoomAttendance.id, localId))
      .returning({ id: zoomAttendance.id });
    if (row) return row.id;
  }
  const [row] = await tx
    .insert(zoomAttendance)
    .values({ orgId, ...values })
    .onConflictDoUpdate({
      target: [zoomAttendance.orgId, zoomAttendance.webinarLinkId, zoomAttendance.segmentKey],
      set: { ...values, updatedAt: ctx.now },
    })
    .returning({ id: zoomAttendance.id });
  if (!row) throw new DomainError('internal');
  return row.id;
}

/* ---------------------------------------------------------------- for CE credits ---- */

/** An event's online attendance per ticket and session: watched minutes and Zoom segments. */
export async function onlineAttendanceTx(tx: TenantTx, eventId: string) {
  const watched = await tx
    .select({
      sessionId: watchMinutes.sessionId,
      ticketId: watchMinutes.ticketId,
      minute: watchMinutes.minute,
    })
    .from(watchMinutes)
    .where(eq(watchMinutes.eventId, eventId))
    .orderBy(asc(watchMinutes.minute));
  const zoom = await tx
    .select({
      sessionId: zoomAttendance.sessionId,
      ticketId: zoomAttendance.ticketId,
      joinedAt: zoomAttendance.joinedAt,
      leftAt: zoomAttendance.leftAt,
    })
    .from(zoomAttendance)
    .where(and(eq(zoomAttendance.eventId, eventId), sql`${zoomAttendance.ticketId} is not null`))
    .orderBy(asc(zoomAttendance.joinedAt));
  return {
    watched,
    zoom: zoom.map((z) => ({ ...z, ticketId: z.ticketId as string })),
  };
}
