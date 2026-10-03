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
  StreamDto,
  StreamingUsageDto,
  StreamKeyDto,
  TicketAccessDto,
  VirtualSetupDto,
} from './dto.ts';
import { currentVideoProvider, videoProvider } from './provider/registry.ts';
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
    return { ticketTypeId: t.id, name: t.name, access, effective: effectiveAccess(ev.attendanceMode, access) };
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
    const row = (await ticketAccessListTx(tx, input.eventId)).find((t) => t.ticketTypeId === input.ticketTypeId);
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
 * that streams (online or hybrid) and a configured provider. The provider call is keyed by the
 * session, so a retry after a failure reuses the provider's stream.
 */
export const createStreamCommand = tenantCommand({
  name: 'virtual.createStream',
  input: z.object(Ids),
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
    const provider = videoProvider();
    const orgId = requireOrg(ctx);
    const live = await provider.createLiveStream({ orgId, sessionId: input.sessionId, idempotencyKey: input.sessionId });
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
      })
      .onConflictDoNothing();
    const row = await streamOfTx(tx, input.sessionId);
    if (!row) throw new DomainError('internal');
    return { sessionId: input.sessionId, stream: toStream(row) };
  },
  audit: (input) => ({
    action: 'virtual.stream.create',
    targetType: 'session',
    targetId: input.sessionId,
    data: { eventId: input.eventId },
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
    const provider = videoProvider();
    if (provider.name !== s.provider)
      throw new DomainError('invalid_state', 'Streaming provider changed', { reason: 'provider_changed' });
    return { sessionId: s.sessionId, ingestUrl: s.ingestUrl, streamKey: await provider.streamKey(s.providerStreamId) };
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
    return { viewerMinutes: r?.viewerMinutes ?? 0, viewers: r?.viewers ?? 0 };
  },
});
