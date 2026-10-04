import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { type EnrollableSession, enrollableSessionsTx, sessionStampsTx } from '@yayatoh/program';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  favoriteDecision,
  MAX_FAVORITES,
  type ScheduleItem,
  scheduleConflicts,
  verifyFeedToken,
} from './domain/hub.ts';
import {
  availableTx,
  liveEntriesTx,
  orderRegistrantsTx,
  positionOf,
  type Registrant,
  registrantByIdTx,
  registrantOfLinkTx,
  stateOf,
} from './enrollment.ts';
import {
  CalendarFeedDto,
  ConferenceHubDto,
  calendarFeedSerializer,
  conferenceHubSerializer,
  FavoriteChoiceSchema,
  FavoriteResultDto,
  type HubSessionDto,
} from './hub-dto.ts';
import { calendarFeeds, sessionFavorites } from './schema.ts';

/**
 * M5.10a — the attendee conference hub: favorites (a star, no place held), the personal schedule
 * (enrolled and offered places plus favorites) with its conflicts, and the signed calendar feed.
 * The credential is the order's manage link (as for M5.2b's "My schedule"); the feed is a signed
 * link of its own that can be replaced.
 */

const HOLDING = ['enrolled', 'offered'] as const;

/** The sessions a registrant's items give, in agenda order (M5.2b's availability). */
async function availableSessionsTx(tx: TenantTx, r: Registrant): Promise<EnrollableSession[]> {
  const all = await enrollableSessionsTx(tx, r.eventId);
  const ok = await availableTx(
    tx,
    r,
    all.map((s) => s.sessionId),
  );
  return all.filter((s) => ok.has(s.sessionId));
}

async function favoriteIdsTx(tx: TenantTx, registrantId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ sessionId: sessionFavorites.sessionId })
    .from(sessionFavorites)
    .where(eq(sessionFavorites.registrantId, registrantId));
  return new Set(rows.map((r) => r.sessionId));
}

/** The personal schedule: places held (enrolled or offered) and favorites, among `sessions`. */
async function scheduleItemsTx(
  tx: TenantTx,
  registrantId: string,
  sessions: readonly EnrollableSession[],
): Promise<ScheduleItem[]> {
  const favs = await favoriteIdsTx(tx, registrantId);
  const held = new Set(
    (await liveEntriesTx(tx, registrantId))
      .filter((e) => (HOLDING as readonly string[]).includes(e.status))
      .map((e) => e.sessionId),
  );
  return sessions.flatMap((s) => {
    const base = { sessionId: s.sessionId, title: s.title, startsAt: s.startsAt, endsAt: s.endsAt };
    return [
      ...(held.has(s.sessionId) ? [{ ...base, kind: 'enrolled' as const }] : []),
      ...(favs.has(s.sessionId) ? [{ ...base, kind: 'favorite' as const }] : []),
    ];
  });
}

/* ------------------------------------------------------------------- favorites ---- */

const LinkInput = z.object({
  token: z.string().min(40).max(60),
  registrantId: z.uuid(),
  sessionId: z.uuid(),
});

export const FavoriteInput = LinkInput.extend({
  favorite: z.boolean(),
  choice: FavoriteChoiceSchema.default('refuse'),
});

/**
 * Star or un-star a session in the hub (P5-9: favorites without enrolling). Only sessions the
 * registrant's items give. Starring one that overlaps the personal schedule asks first
 * (`conflict` with the sessions in the way); "keep both" stars it anyway, "replace" un-stars the
 * overlapping favorites (never an enrollment). Idempotent both ways.
 */
export const favoriteSessionCommand = tenantCommand({
  name: 'registration.favoriteSession',
  input: FavoriteInput,
  output: FavoriteResultDto,
  entitlement: 'registration',
  permission: 'public:enrollment',
  handler: async ({ input, ctx, tx }) => {
    const r = await registrantOfLinkTx(tx, input.token, input.registrantId);
    // One decision per registrant at a time (the conflict check spans sessions).
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`registration.favorite:${r.id}`}, 0))`,
    );
    const sessions = await availableSessionsTx(tx, r);
    const target = sessions.find((s) => s.sessionId === input.sessionId);
    if (!target) throw new DomainError('not_found');
    if (!input.favorite) {
      await tx
        .delete(sessionFavorites)
        .where(
          and(eq(sessionFavorites.registrantId, r.id), eq(sessionFavorites.sessionId, target.sessionId)),
        );
      return { favorite: false, removed: [] };
    }
    const mine = await scheduleItemsTx(tx, r.id, sessions);
    const d = favoriteDecision({
      target,
      mine,
      choice: input.choice,
      favorites: mine.filter((m) => m.kind === 'favorite').length,
    });
    if (d.kind === 'noop') return { favorite: true, removed: [] };
    if (d.kind === 'refuse') {
      if (d.reason === 'too_many')
        throw new DomainError('invalid_state', 'Too many favorites', {
          reason: 'too_many',
          max: MAX_FAVORITES,
        });
      const enrolledInWay = d.conflicts.some((c) => c.kind === 'enrolled');
      throw new DomainError('conflict', 'Overlaps the personal schedule', {
        reason: 'overlap',
        conflicts: [...new Map(d.conflicts.map((c) => [c.sessionId, c])).values()].map((c) => ({
          sessionId: c.sessionId,
          title: c.title,
          kind: d.conflicts.some((x) => x.sessionId === c.sessionId && x.kind === 'enrolled')
            ? 'enrolled'
            : 'favorite',
        })),
        // "Replace" un-stars favorites only, so it is offered only when no enrollment is in the way.
        replace: !enrolledInWay,
      });
    }
    if (d.remove.length > 0)
      await tx
        .delete(sessionFavorites)
        .where(
          and(eq(sessionFavorites.registrantId, r.id), inArray(sessionFavorites.sessionId, [...d.remove])),
        );
    await tx
      .insert(sessionFavorites)
      .values({ orgId: requireOrg(ctx), eventId: r.eventId, sessionId: target.sessionId, registrantId: r.id })
      .onConflictDoNothing();
    return { favorite: true, removed: [...d.remove] };
  },
  audit: (input, res) => ({
    action: input.favorite ? 'registration.session.favorite' : 'registration.session.unfavorite',
    targetType: 'session',
    targetId: input.sessionId,
    data: { registrantId: input.registrantId, removed: res.removed.length },
  }),
});

/* ------------------------------------------------------------------- the hub page ---- */

/**
 * The conference hub (the order's manage link): the order's registrants and, for the chosen one,
 * every session their items give with M5.2b's state, whether it is starred or on their schedule,
 * and what it overlaps there; the event basics and the calendar feed version. Allowlisted: no
 * counts, no other people.
 */
export const conferenceHubQuery = tenantQuery({
  name: 'registration.conferenceHub',
  input: z.object({ token: z.string().min(40).max(60), registrantId: z.uuid().nullable().default(null) }),
  output: ConferenceHubDto,
  entitlement: 'registration',
  permission: 'public:enrollment',
  handler: async ({ input, ctx, tx }) => {
    const { order, registrants } = await orderRegistrantsTx(tx, input.token);
    const ev = await findEventTx(tx, order.eventId);
    if (!ev) throw new DomainError('not_found');
    const r = registrants.find((x) => x.id === input.registrantId) ?? registrants[0] ?? null;
    const sessions: HubSessionDto[] = [];
    let feedVersion = 1;
    if (r) {
      const list = await availableSessionsTx(tx, r);
      const live = await liveEntriesTx(tx, r.id);
      const items = await scheduleItemsTx(tx, r.id, list);
      const conflicts = scheduleConflicts(items);
      const favs = new Set(items.filter((i) => i.kind === 'favorite').map((i) => i.sessionId));
      for (const s of list) {
        const entry = live.find((e) => e.sessionId === s.sessionId);
        const onSchedule = conflicts.has(s.sessionId);
        sessions.push({
          sessionId: s.sessionId,
          title: s.title,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          roomName: s.roomName,
          groupName: s.groupName,
          admission: s.admission,
          state: stateOf(s, entry, ctx.now),
          position: entry?.status === 'waiting' ? await positionOf(tx, entry) : null,
          offerExpiresAt: entry?.status === 'offered' ? entry.offerExpiresAt : null,
          favorite: favs.has(s.sessionId),
          onSchedule,
          conflicts: onSchedule ? (conflicts.get(s.sessionId) ?? []) : [],
        });
      }
      feedVersion = await feedVersionTx(tx, r.id);
    }
    return conferenceHubSerializer.serialize({
      eventId: ev.id,
      eventSlug: ev.slug,
      eventName: ev.name,
      timezone: ev.timezone,
      startsAt: ev.startsAt,
      endsAt: ev.endsAt,
      venueName: ev.venueName,
      registrants: registrants.map((x) => ({ id: x.id, name: x.name })),
      registrantId: r?.id ?? null,
      sessions,
      feedVersion,
    });
  },
});

/* --------------------------------------------------------------- the calendar feed ---- */

async function feedVersionTx(tx: TenantTx, registrantId: string): Promise<number> {
  const [row] = await tx
    .select({ version: calendarFeeds.version })
    .from(calendarFeeds)
    .where(eq(calendarFeeds.registrantId, registrantId));
  return row?.version ?? 1;
}

/**
 * "Replace the link": the registrant's calendar feed gets a new version, so every earlier link
 * (shared, leaked, or on an old phone) stops working at once.
 */
export const rotateCalendarFeedCommand = tenantCommand({
  name: 'registration.rotateCalendarFeed',
  input: z.object({ token: z.string().min(40).max(60), registrantId: z.uuid() }),
  output: z.object({ version: z.int() }),
  entitlement: 'registration',
  permission: 'public:enrollment',
  handler: async ({ input, ctx, tx }) => {
    const r = await registrantOfLinkTx(tx, input.token, input.registrantId);
    const [row] = await tx
      .insert(calendarFeeds)
      .values({ orgId: requireOrg(ctx), eventId: r.eventId, registrantId: r.id, version: 2 })
      .onConflictDoUpdate({
        target: [calendarFeeds.orgId, calendarFeeds.registrantId],
        set: { version: sql`${calendarFeeds.version} + 1`, updatedAt: ctx.now },
      })
      .returning({ version: calendarFeeds.version });
    if (!row) throw new DomainError('internal');
    return { version: row.version };
  },
  audit: (input, res) => ({
    action: 'registration.calendar_feed.rotate',
    targetType: 'registrant',
    targetId: input.registrantId,
    data: { version: res.version },
  }),
});

/**
 * Who a feed link belongs to, or null: a forged token, a replaced link (the version moved on), a
 * ticket no longer active, or an org that is not live. The org comes from the signed token;
 * `registration.calendar_feed_target` (SECURITY DEFINER) answers the event id and version only.
 */
export async function calendarFeedTarget(
  token: string,
  secret: string,
): Promise<{ orgId: string; registrantId: string; version: number } | null> {
  const claim = verifyFeedToken(token, secret);
  if (!claim) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ event_id: string; feed_version: number }>(
      sql`select event_id, feed_version from registration.calendar_feed_target(${claim.orgId}::uuid, ${claim.registrantId}::uuid)`,
    ),
  );
  const r = rows[0];
  if (!r || Number(r.feed_version) !== claim.version) return null;
  return claim;
}

/**
 * The calendar feed of a verified link (`calendarFeedTarget`): the registrant's enrolled sessions
 * (CONFIRMED), offered places and favorites (TENTATIVE), each with when it last changed. The
 * version is checked again under the org's RLS; anything off is `not_found`.
 */
export const calendarFeedQuery = tenantQuery({
  name: 'registration.calendarFeed',
  input: z.object({ registrantId: z.uuid(), version: z.int().min(1) }),
  output: CalendarFeedDto,
  entitlement: 'registration',
  permission: 'public:enrollment',
  handler: async ({ input, tx }) => calendarFeedTx(tx, input.registrantId, input.version),
});

async function calendarFeedTx(tx: TenantTx, registrantId: string, version: number): Promise<CalendarFeedDto> {
  if ((await feedVersionTx(tx, registrantId)) !== version) throw new DomainError('not_found');
  const r = await registrantByIdTx(tx, registrantId);
  if (!r) throw new DomainError('not_found');
  const ev = await findEventTx(tx, r.eventId);
  if (!ev) throw new DomainError('not_found');
  const list = await availableSessionsTx(tx, r);
  const items = await scheduleItemsTx(tx, r.id, list);
  const enrolled = new Set(
    (await liveEntriesTx(tx, r.id)).filter((e) => e.status === 'enrolled').map((e) => e.sessionId),
  );
  const ids = new Set(items.map((i) => i.sessionId));
  const stamps = await sessionStampsTx(tx, [...ids]);
  return calendarFeedSerializer.serialize({
    eventName: ev.name,
    timezone: ev.timezone,
    sessions: list
      .filter((s) => ids.has(s.sessionId))
      .map((s) => ({
        sessionId: s.sessionId,
        title: s.title,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        roomName: s.roomName,
        updatedAt: stamps.get(s.sessionId) ?? s.startsAt,
        confirmed: enrolled.has(s.sessionId),
      })),
  });
}
