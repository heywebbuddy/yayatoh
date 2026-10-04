import type { TenantTx } from '@yayatoh/db';
import { eventDeliveryTx } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { sessionsOf } from '@yayatoh/program';
import { ticketTypeNamesTx } from '@yayatoh/ticketing';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ACCESS_MODES, type AccessMode, effectiveAccess } from './domain/access.ts';
import {
  INGESTS,
  StreamDto,
  StreamingUsageDto,
  StreamKeyDto,
  TicketAccessDto,
  VirtualSetupDto,
} from './dto.ts';
import { VIDEO_PROVIDERS, type VideoProvider } from './provider/port.ts';
import { currentVideoProvider, videoProvider, videoProviders } from './provider/registry.ts';
import { streams, ticketAccess, watchMinutes } from './schema.ts';

/**
 * Organizer side of M6.9a: access modes per ticket type, one live stream per program session,
 * the stream key on request, and watch time per session. Entitlement `virtual`; reads need
 * `events:read`, changes `events:write`. The delivery mode itself is the event's attendance mode
 * (`events.setEventDetails`).
 */
const Ids = { eventId: z.uuid(), sessionId: z.uuid() };

type StreamRow = typeof streams.$inferSelect;

export async function eventOrThrowTx(tx: TenantTx, eventId: string) {
  const ev = await eventDeliveryTx(tx, eventId);
  if (!ev) throw new DomainError('not_found', 'Event not found');
  return ev;
}

async function sessionOrThrowTx(tx: TenantTx, eventId: string, sessionId: string) {
  const s = (await sessionsOf(tx, eventId)).find((x) => x.id === sessionId && !x.draft);
  if (!s) throw new DomainError('not_found', 'Session not found', { field: 'sessionId' });
  return s;
}

export async function streamOfTx(tx: TenantTx, sessionId: string): Promise<StreamRow | null> {
  const [row] = await tx.select().from(streams).where(eq(streams.sessionId, sessionId));
  return row ?? null;
}

const toStream = (s: StreamRow): StreamDto => ({
  id: s.id,
  provider: s.provider as StreamDto['provider'],
  ingestUrl: s.ingestUrl,
  enabled: s.enabled,
  hasBackup: s.backupIngestUrl !== null,
  activeIngest: s.activeIngest === 'backup' ? 'backup' : 'primary',
});

/** Explicit access choices of an event's ticket types. */
export async function accessChoicesTx(tx: TenantTx, eventId: string): Promise<Map<string, AccessMode>> {
  const rows = await tx
    .select({ ticketTypeId: ticketAccess.ticketTypeId, access: ticketAccess.access })
    .from(ticketAccess)
    .where(eq(ticketAccess.eventId, eventId));
  return new Map(rows.map((r) => [r.ticketTypeId, r.access as AccessMode]));
}

async function ticketAccessListTx(tx: TenantTx, eventId: string): Promise<TicketAccessDto[]> {
  const ev = await eventOrThrowTx(tx, eventId);
  const chosen = await accessChoicesTx(tx, eventId);
  return (await ticketTypeNamesTx(tx, eventId)).map((t) => {
    const access = chosen.get(t.id) ?? null;
    return {
      ticketTypeId: t.id,
      name: t.name,
      access,
      effective: effectiveAccess(ev.attendanceMode, access),
    };
  });
}

/* --------------------------------------------------------------------------------- setup ---- */

/** Everything the stream setup page shows: delivery, access per ticket type, streams, watch time. */
export const virtualSetupQuery = tenantQuery({
  name: 'virtual.setup',
  input: z.object({ eventId: z.uuid() }),
  output: VirtualSetupDto,
  entitlement: 'virtual',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const ev = await eventOrThrowTx(tx, input.eventId);
    const sessions = (await sessionsOf(tx, ev.id)).filter((s) => !s.draft);
    const rows = await tx.select().from(streams).where(eq(streams.eventId, ev.id));
    const byStream = new Map(rows.map((r) => [r.sessionId, r]));
    const watched = await tx
      .select({
        sessionId: watchMinutes.sessionId,
        viewers: sql<number>`count(distinct ${watchMinutes.ticketId})::int`,
        minutes: sql<number>`count(*)::int`,
      })
      .from(watchMinutes)
      .where(eq(watchMinutes.eventId, ev.id))
      .groupBy(watchMinutes.sessionId);
    const w = new Map(watched.map((r) => [r.sessionId, r]));
    return {
      eventId: ev.id,
      deliveryMode: ev.attendanceMode,
      provider: currentVideoProvider()?.name ?? null,
      providers: videoProviders().map((p) => ({ name: p.name, kind: p.kind, sandbox: p.sandbox })),
      ticketTypes: await ticketAccessListTx(tx, ev.id),
      sessions: sessions.map((s) => {
        const st = byStream.get(s.id);
        return {
          sessionId: s.id,
          title: s.title,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          stream: st ? toStream(st) : null,
          viewers: w.get(s.id)?.viewers ?? 0,
          minutes: w.get(s.id)?.minutes ?? 0,
        };
      }),
    };
  },
});

/* ---------------------------------------------------------------------------- access mode ---- */

export const SetTicketAccessInput = z.object({
  eventId: z.uuid(),
  ticketTypeId: z.uuid(),
  access: z.enum(ACCESS_MODES),
});

/** In person only, virtual only, or both, for one ticket type of the event. */
export const setTicketAccessCommand = tenantCommand({
  name: 'virtual.setTicketAccess',
  input: SetTicketAccessInput,
  output: TicketAccessDto,
  entitlement: 'virtual',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOrThrowTx(tx, input.eventId);
    const types = await ticketTypeNamesTx(tx, input.eventId);
    if (!types.some((t) => t.id === input.ticketTypeId))
      throw new DomainError('not_found', 'Ticket type not found', { field: 'ticketTypeId' });
    await tx
      .insert(ticketAccess)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        ticketTypeId: input.ticketTypeId,
        access: input.access,
      })
      .onConflictDoUpdate({
        target: [ticketAccess.orgId, ticketAccess.ticketTypeId],
        set: { access: input.access, updatedAt: ctx.now },
      });
    const row = (await ticketAccessListTx(tx, input.eventId)).find(
      (t) => t.ticketTypeId === input.ticketTypeId,
    );
    if (!row) throw new DomainError('internal');
    return row;
  },
  audit: (input) => ({
    action: 'virtual.access.set',
    targetType: 'ticket_type',
    targetId: input.ticketTypeId,
    data: { eventId: input.eventId, access: input.access },
  }),
});

/* -------------------------------------------------------------------------------- streams ---- */

/**
 * A live stream for a session (one per session; a second call returns the first). Needs an event
 * that streams (online or hybrid) and a configured provider: the one named (M6.10a), else the
 * default. The provider call is keyed by the session, so a retry after a failure reuses the
 * provider's stream.
 */
export const createStreamCommand = tenantCommand({
  name: 'virtual.createStream',
  input: z.object({ ...Ids, provider: z.enum(VIDEO_PROVIDERS).optional() }),
  output: z.object({ sessionId: z.uuid(), stream: StreamDto }),
  entitlement: 'virtual',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const ev = await eventOrThrowTx(tx, input.eventId);
    if (ev.attendanceMode === 'in_person')
      throw new DomainError('invalid_state', 'This event is in person only', { reason: 'in_person_event' });
    await sessionOrThrowTx(tx, ev.id, input.sessionId);
    const existing = await streamOfTx(tx, input.sessionId);
    if (existing) return { sessionId: input.sessionId, stream: toStream(existing) };
    const provider = videoProvider(input.provider);
    const orgId = requireOrg(ctx);
    const live = await liveStreamAt(provider, orgId, input.sessionId, input.sessionId);
    await tx
      .insert(streams)
      .values({
        orgId,
        eventId: ev.id,
        sessionId: input.sessionId,
        provider: provider.name,
        providerStreamId: live.providerStreamId,
        playbackId: live.playbackId,
        ingestUrl: live.ingestUrl,
        backupIngestUrl: live.backupIngestUrl,
      })
      .onConflictDoNothing();
    const row = await streamOfTx(tx, input.sessionId);
    if (!row) throw new DomainError('internal');
    return { sessionId: input.sessionId, stream: toStream(row) };
  },
  audit: (input, r) => ({
    action: 'virtual.stream.create',
    targetType: 'session',
    targetId: input.sessionId,
    data: { eventId: input.eventId, provider: r.stream.provider },
  }),
});

/** The provider's stream for a session; `VideoUnavailableError` (a stub adapter) becomes a refusal. */
async function liveStreamAt(provider: VideoProvider, orgId: string, sessionId: string, key: string) {
  try {
    return await provider.createLiveStream({ orgId, sessionId, idempotencyKey: key });
  } catch (err) {
    if (err instanceof Error && err.name === 'VideoUnavailableError')
      throw new DomainError('invalid_state', 'This streaming provider is not available', {
        reason: 'provider_unavailable',
      });
    throw err;
  }
}

/**
 * M6.10a: move a session's stream to another provider. The stream row stays the same (its id,
 * on/off state, viewings and watch minutes, so every ticket's grant and watch-time history carry
 * over); only the provider's ids and ingest change, and the ingest goes back to primary. Players
 * holding a token of the old provider are told `provider_changed` on their next heartbeat and
 * start a new viewing at the new one. The provider call is keyed by session and provider, so
 * switching back reuses that provider's stream.
 */
export const switchStreamProviderCommand = tenantCommand({
  name: 'virtual.switchStreamProvider',
  input: z.object({ ...Ids, provider: z.enum(VIDEO_PROVIDERS) }),
  output: z.object({ sessionId: z.uuid(), stream: StreamDto, switched: z.boolean() }),
  entitlement: 'virtual',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const ev = await eventOrThrowTx(tx, input.eventId);
    if (ev.attendanceMode === 'in_person')
      throw new DomainError('invalid_state', 'This event is in person only', { reason: 'in_person_event' });
    const [s] = await tx.select().from(streams).where(eq(streams.sessionId, input.sessionId)).for('update');
    if (!s || s.eventId !== ev.id) throw new DomainError('not_found', 'Stream not found');
    if (s.provider === input.provider)
      return { sessionId: s.sessionId, stream: toStream(s), switched: false };
    const provider = videoProvider(input.provider);
    const live = await liveStreamAt(
      provider,
      requireOrg(ctx),
      s.sessionId,
      `${s.sessionId}:${provider.name}`,
    );
    const [row] = await tx
      .update(streams)
      .set({
        provider: provider.name,
        providerStreamId: live.providerStreamId,
        playbackId: live.playbackId,
        ingestUrl: live.ingestUrl,
        backupIngestUrl: live.backupIngestUrl,
        activeIngest: 'primary',
        updatedAt: ctx.now,
      })
      .where(eq(streams.id, s.id))
      .returning();
    if (!row) throw new DomainError('internal');
    return { sessionId: row.sessionId, stream: toStream(row), switched: true };
  },
  audit: (input, r) => ({
    action: 'virtual.stream.switch_provider',
    targetType: 'session',
    targetId: input.sessionId,
    data: { eventId: input.eventId, provider: input.provider, switched: r.switched },
  }),
});

/**
 * M6.10a RTMP overflow: point the encoder at the provider's backup ingest (or back to primary).
 * Playback is unchanged (same stream, same playback id): viewers keep watching. Refused
 * (`no_backup_ingest`) when the provider offers none.
 */
export const setActiveIngestCommand = tenantCommand({
  name: 'virtual.setActiveIngest',
  input: z.object({ ...Ids, ingest: z.enum(INGESTS) }),
  output: StreamDto,
  entitlement: 'virtual',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const s = await streamOfTx(tx, input.sessionId);
    if (!s || s.eventId !== input.eventId) throw new DomainError('not_found', 'Stream not found');
    if (input.ingest === 'backup' && !s.backupIngestUrl)
      throw new DomainError('invalid_state', 'This provider has no backup ingest', {
        reason: 'no_backup_ingest',
      });
    const [row] = await tx
      .update(streams)
      .set({ activeIngest: input.ingest, updatedAt: ctx.now })
      .where(eq(streams.id, s.id))
      .returning();
    if (!row) throw new DomainError('internal');
    return toStream(row);
  },
  audit: (input) => ({
    action: 'virtual.stream.ingest',
    targetType: 'session',
    targetId: input.sessionId,
    data: { eventId: input.eventId, ingest: input.ingest },
  }),
});

/** Switch a stream on or off. Off: no new playback tokens, and heartbeats stop counting. */
export const setStreamEnabledCommand = tenantCommand({
  name: 'virtual.setStreamEnabled',
  input: z.object({ ...Ids, enabled: z.boolean() }),
  output: StreamDto,
  entitlement: 'virtual',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const s = await streamOfTx(tx, input.sessionId);
    if (!s || s.eventId !== input.eventId) throw new DomainError('not_found', 'Stream not found');
    const [row] = await tx
      .update(streams)
      .set({ enabled: input.enabled, updatedAt: ctx.now })
      .where(eq(streams.id, s.id))
      .returning();
    if (!row) throw new DomainError('internal');
    return toStream(row);
  },
  audit: (input) => ({
    action: input.enabled ? 'virtual.stream.enable' : 'virtual.stream.disable',
    targetType: 'session',
    targetId: input.sessionId,
    data: { eventId: input.eventId },
  }),
});

/**
 * The stream key for the organizer's encoder, from the provider (never stored). A write
 * permission: whoever holds the key can broadcast as the event. Audited.
 */
export const revealStreamKeyCommand = tenantCommand({
  name: 'virtual.revealStreamKey',
  input: z.object(Ids),
  output: StreamKeyDto,
  entitlement: 'virtual',
  permission: 'events:write',
  handler: async ({ input, tx }) => {
    const s = await streamOfTx(tx, input.sessionId);
    if (!s || s.eventId !== input.eventId) throw new DomainError('not_found', 'Stream not found');
    const provider = videoProvider(s.provider);
    const backup = s.activeIngest === 'backup' && s.backupIngestUrl !== null;
    return {
      sessionId: s.sessionId,
      ingestUrl: backup ? (s.backupIngestUrl as string) : s.ingestUrl,
      streamKey: await provider.streamKey(s.providerStreamId),
      activeIngest: backup ? 'backup' : 'primary',
      backupIngestUrl: s.backupIngestUrl,
    };
  },
  audit: (input) => ({
    action: 'virtual.stream.key_revealed',
    targetType: 'session',
    targetId: input.sessionId,
    data: { eventId: input.eventId },
  }),
});

/* ---------------------------------------------------------------------------------- meter ---- */

/**
 * The streaming meter (D24): viewer-minutes counted in [from, to). Billing's meters (M6.6b) read
 * it per period; until then the org's usage is visible here and on the setup page.
 */
export const streamingUsageQuery = tenantQuery({
  name: 'virtual.streamingUsage',
  input: z.object({ from: z.date(), to: z.date() }).refine((v) => v.to > v.from, { path: ['to'] }),
  output: StreamingUsageDto,
  entitlement: 'virtual',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const [r] = await tx
      .select({
        viewerMinutes: sql<number>`count(*)::int`,
        viewers: sql<number>`count(distinct ${watchMinutes.ticketId})::int`,
      })
      .from(watchMinutes)
      .where(and(gte(watchMinutes.minute, input.from), lt(watchMinutes.minute, input.to)));
    const per = await tx
      .select({
        provider: sql<string>`coalesce(${watchMinutes.provider}, 'unknown')`,
        viewerMinutes: sql<number>`count(*)::int`,
      })
      .from(watchMinutes)
      .where(and(gte(watchMinutes.minute, input.from), lt(watchMinutes.minute, input.to)))
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    return {
      viewerMinutes: r?.viewerMinutes ?? 0,
      viewers: r?.viewers ?? 0,
      byProvider: per.map((p) => ({
        provider: p.provider as StreamingUsageDto['byProvider'][number]['provider'],
        viewerMinutes: p.viewerMinutes,
      })),
    };
  },
});
