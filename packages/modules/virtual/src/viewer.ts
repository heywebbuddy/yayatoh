import type { TenantTx } from '@yayatoh/db';
import { type DomainEvent, DomainError, requireOrg } from '@yayatoh/kernel';
import { signLinkToken, tenantCommand, tenantQuery, verifyLinkToken } from '@yayatoh/platform';
import { sessionsOf } from '@yayatoh/program';
import { ticketForScanTx } from '@yayatoh/ticketing';
import { and, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { accessChoicesTx, eventOrThrowTx, streamOfTx } from './commands.ts';
import { type AccessMode, effectiveAccess, mayWatch } from './domain/access.ts';
import { beatVerdict, MAX_SEQ, minuteOf, PLAYBACK_TTL_MS } from './domain/watch.ts';
import { HeartbeatDto, PlaybackDto, ViewerDto } from './dto.ts';
import { MAX_TOKEN_LENGTH } from './provider/jwt.ts';
import { videoProvider } from './provider/registry.ts';
import { streams, views, watchMinutes } from './schema.ts';

/**
 * The ticket holder's side of M6.9a (`public:virtual`). A holder reaches their watch page through
 * the ticket's own signed link (`virtual.ticket`), shown on their order and ticket pages; it
 * proves they hold that ticket, like the assistance help link. A playback token is issued per
 * viewing (one ticket, one session, ten minutes) and only to a ticket whose type includes virtual
 * access; heartbeats name the viewing through that token, so watch time lands on that attendee
 * and that session only.
 */
export const TICKET_PURPOSE = 'virtual.ticket';

/** The ticket's watch link token (`<ticketId>~<hmac>`). */
export const virtualTicketToken = (ticketId: string) => signLinkToken(TICKET_PURPOSE, ticketId);

/** Viewings one ticket may start per session per hour (a player renews about 6 times an hour). */
export const VIEWS_PER_HOUR = 60;

/** Events whose holders may watch: published or postponed (not drafts, cancelled or ended ones). */
const WATCHABLE = new Set(['published', 'postponed']);

const Token = z.string().min(10).max(200);

interface Holder {
  readonly ticketId: string;
  readonly holderName: string;
  readonly access: AccessMode;
}

/** The holder behind a watch link for this event, or `not_found` (forged, void, other event). */
async function holderTx(tx: TenantTx, eventId: string, token: string): Promise<Holder> {
  const ticketId = token.length > 200 ? null : verifyLinkToken(TICKET_PURPOSE, token);
  if (!ticketId) throw new DomainError('not_found');
  const ev = await eventOrThrowTx(tx, eventId);
  const t = await ticketForScanTx(tx, { id: ticketId });
  if (!t || t.eventId !== eventId || t.status !== 'active' || !WATCHABLE.has(ev.status))
    throw new DomainError('not_found');
  const chosen = (await accessChoicesTx(tx, eventId)).get(t.ticketTypeId) ?? null;
  return { ticketId: t.id, holderName: t.holderName, access: effectiveAccess(ev.attendanceMode, chosen) };
}

async function ticketMinutesTx(tx: TenantTx, ticketId: string, sessionId?: string) {
  const rows = await tx
    .select({ sessionId: watchMinutes.sessionId, minutes: sql<number>`count(*)::int` })
    .from(watchMinutes)
    .where(
      sessionId
        ? and(eq(watchMinutes.ticketId, ticketId), eq(watchMinutes.sessionId, sessionId))
        : eq(watchMinutes.ticketId, ticketId),
    )
    .groupBy(watchMinutes.sessionId);
  return new Map(rows.map((r) => [r.sessionId, r.minutes]));
}

/** The watch page: the sessions this ticket may watch (none for an in-person-only ticket). */
export const viewerQuery = tenantQuery({
  name: 'virtual.viewer',
  input: z.object({ eventId: z.uuid(), ticketToken: Token }),
  output: ViewerDto,
  entitlement: 'virtual',
  permission: 'public:virtual',
  handler: async ({ input, tx }) => {
    const h = await holderTx(tx, input.eventId, input.ticketToken);
    const ev = await eventOrThrowTx(tx, input.eventId);
    if (!mayWatch(h.access))
      return { eventName: ev.name, timezone: ev.timezone, holderName: h.holderName, access: h.access, sessions: [] };
    const on = await tx
      .select({ sessionId: streams.sessionId })
      .from(streams)
      .where(and(eq(streams.eventId, ev.id), eq(streams.enabled, true)));
    const live = new Set(on.map((r) => r.sessionId));
    const minutes = await ticketMinutesTx(tx, h.ticketId);
    return {
      eventName: ev.name,
      timezone: ev.timezone,
      holderName: h.holderName,
      access: h.access,
      sessions: (await sessionsOf(tx, ev.id))
        .filter((s) => !s.draft && live.has(s.id))
        .map((s) => ({
          sessionId: s.id,
          title: s.title,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          minutes: minutes.get(s.id) ?? 0,
        })),
    };
  },
});

/**
 * A playback token for one session: a new viewing for this ticket, valid ten minutes. Refused
 * (`forbidden`, `in_person_only`) for a ticket without virtual access, `not_found` for a session
 * without a live stream, `rate_limited` beyond `VIEWS_PER_HOUR`.
 */
export const startPlaybackCommand = tenantCommand({
  name: 'virtual.startPlayback',
  input: z.object({ eventId: z.uuid(), sessionId: z.uuid(), ticketToken: Token }),
  output: PlaybackDto,
  entitlement: 'virtual',
  permission: 'public:virtual',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const h = await holderTx(tx, input.eventId, input.ticketToken);
    if (!mayWatch(h.access))
      throw new DomainError('forbidden', 'This ticket is for in-person attendance', { reason: 'in_person_only' });
    const s = await streamOfTx(tx, input.sessionId);
    if (!s || s.eventId !== input.eventId || !s.enabled) throw new DomainError('not_found');
    const provider = videoProvider();
    if (provider.name !== s.provider)
      throw new DomainError('invalid_state', 'Streaming provider changed', { reason: 'provider_changed' });
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(views)
      .where(
        and(
          eq(views.ticketId, h.ticketId),
          eq(views.sessionId, s.sessionId),
          gte(views.createdAt, new Date(ctx.now.getTime() - 3_600_000)),
        ),
      );
    if ((recent?.n ?? 0) >= VIEWS_PER_HOUR)
      throw new DomainError('rate_limited', 'Too many playback requests', { reason: 'views_per_hour' });
    const expiresAt = new Date(ctx.now.getTime() + PLAYBACK_TTL_MS);
    const [view] = await tx
      .insert(views)
      .values({
        orgId,
        eventId: s.eventId,
        sessionId: s.sessionId,
        streamId: s.id,
        ticketId: h.ticketId,
        expiresAt,
      })
      .returning();
    if (!view) throw new DomainError('internal');
    const token = provider.signPlayback({ playbackId: s.playbackId, orgId, viewId: view.id, expiresAt });
    return {
      sessionId: s.sessionId,
      token,
      playbackUrl: provider.playbackUrl(s.playbackId, token),
      expiresAt,
      provider: provider.name,
    };
  },
});

/** The org a playback token was issued in (authentic and unexpired), so a heartbeat finds it. */
export function playbackOrg(token: string, now: Date): string | null {
  if (token.length > MAX_TOKEN_LENGTH) return null;
  try {
    return videoProvider().verifyPlayback(token, now)?.orgId ?? null;
  } catch {
    return null;
  }
}

/** `virtual.attended@1`: the ticket's first counted minute of a session (the virtual checkpoint). */
export const virtualAttended = (p: {
  orgId: string;
  eventId: string;
  sessionId: string;
  ticketId: string;
  at: string;
}): DomainEvent => ({
  type: 'virtual.attended',
  version: 1,
  aggregateType: 'event',
  aggregateId: p.eventId,
  payload: p,
});

const forbidden = (reason: string) => new DomainError('forbidden', 'Playback not allowed', { reason });

/**
 * A player heartbeat. Counts the server's current minute for the viewing's ticket and session,
 * once: the unique key on (session, ticket, minute) ignores a second heartbeat in the same minute
 * (another tab, a retry), and a sequence not above the viewing's last one is a replay and counts
 * nothing. The first minute of a session emits `virtual.attended@1`. A forged, expired or other
 * org's token, a void ticket or a ticket that lost virtual access are `forbidden`.
 */
export const heartbeatCommand = tenantCommand({
  name: 'virtual.heartbeat',
  input: z.object({ token: z.string().min(20).max(MAX_TOKEN_LENGTH), seq: z.int().min(1).max(MAX_SEQ) }),
  output: HeartbeatDto,
  entitlement: 'virtual',
  permission: 'public:virtual',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const claims = videoProvider().verifyPlayback(input.token, ctx.now);
    if (!claims || claims.orgId !== orgId) throw forbidden('invalid_token');
    const [view] = await tx.select().from(views).where(eq(views.id, claims.viewId)).for('update');
    if (!view) throw forbidden('invalid_token');
    const [stream] = await tx.select().from(streams).where(eq(streams.id, view.streamId));
    if (!stream || stream.playbackId !== claims.playbackId) throw forbidden('invalid_token');
    if (!stream.enabled) throw new DomainError('invalid_state', 'The stream is off', { reason: 'stream_off' });
    await assertStillWatchingTx(tx, view.eventId, view.ticketId);
    const minutesNow = async () => (await ticketMinutesTx(tx, view.ticketId, view.sessionId)).get(view.sessionId) ?? 0;
    const verdict = beatVerdict(view, input.seq, ctx.now);
    if (verdict !== 'count') return { counted: false, reason: verdict, minutes: await minutesNow() };
    await tx
      .update(views)
      .set({ beatSeq: input.seq, lastBeatAt: ctx.now, updatedAt: ctx.now })
      .where(eq(views.id, view.id));
    const minute = minuteOf(ctx.now);
    const added = await tx
      .insert(watchMinutes)
      .values({
        orgId,
        eventId: view.eventId,
        sessionId: view.sessionId,
        ticketId: view.ticketId,
        viewId: view.id,
        minute,
      })
      .onConflictDoNothing()
      .returning({ id: watchMinutes.id });
    const minutes = await minutesNow();
    if (added.length === 0) return { counted: false, reason: 'same_minute', minutes };
    if (minutes === 1)
      emit(
        virtualAttended({
          orgId,
          eventId: view.eventId,
          sessionId: view.sessionId,
          ticketId: view.ticketId,
          at: minute.toISOString(),
        }),
      );
    return { counted: true, reason: 'counted', minutes };
  },
});

/** The ticket is still active and still has virtual access (the organizer may change either). */
async function assertStillWatchingTx(tx: TenantTx, eventId: string, ticketId: string) {
  const ev = await eventOrThrowTx(tx, eventId);
  const t = await ticketForScanTx(tx, { id: ticketId });
  if (!t || t.status !== 'active') throw forbidden('ticket_void');
  const chosen = (await accessChoicesTx(tx, eventId)).get(t.ticketTypeId) ?? null;
  if (!mayWatch(effectiveAccess(ev.attendanceMode, chosen))) throw forbidden('in_person_only');
}
