import 'server-only';
import { createHash } from 'node:crypto';
import { checkinFactsTx, deviceContext } from '@yayatoh/checkin';
import { type TenantTx, withTenant } from '@yayatoh/db';
import { findEventTx, isPublicEvent } from '@yayatoh/events';
import { createCtx } from '@yayatoh/kernel';
import {
  ablyRealtimePublisher,
  CORE_REALTIME_CHANNELS,
  createRealtimeFanout,
  createRealtimeRegistry,
  decideRealtimeAccess,
  hitRateLimitTx,
  lastEventIdOf,
  latestRealtimeIdTx,
  listenForRealtime,
  memoryRealtimeHub,
  type RealtimeChannelDef,
  type RealtimeFanout,
  type RealtimeHub,
  type RealtimeMessage,
  type ResolvedChannel,
  realtimeCatchUpTx,
  realtimePayload,
  realtimeProvider,
  realtimePublisherFromEnv,
  SSE_HEADERS,
  type SseSource,
  StreamLimits,
  sseStream,
} from '@yayatoh/platform';
import {
  createSeatFeed,
  listenForSeatChanges,
  SEAT_STATES_CHANNEL,
  SEATS_CHANNEL,
  type SeatFeed,
  type SeatStreamKind,
} from '@yayatoh/seating';
import { memberRole } from '@yayatoh/tenancy';
import { ports } from './ports.ts';
import { getSession } from './session.ts';

/**
 * Realtime for the web app (M3.1b): one registry of channels, one in-process hub, one Postgres
 * listener per process for the message log (plus the seat feed's), and one SSE implementation
 * behind every stream URL:
 *
 * - `/api/realtime/{channel}` on any host (on a tenant host only that host's org's channels);
 * - `{tenant host}/realtime/{channel}` (the proxy rewrites it to `/[locale]/t/[org]/realtime/…`);
 * - the seat-map URLs from M1.7f, kept as aliases of the seat channels.
 *
 * The org always comes from the channel name, and a caller is checked against *that* org: its
 * session's membership and role, its device token's org, or the channel's public rule. Headers
 * never choose the tenant (the Host can only narrow it: a tenant host serves its own org only).
 */
export const REALTIME_CHANNELS = createRealtimeRegistry([
  ...CORE_REALTIME_CHANNELS,
  SEATS_CHANNEL,
  SEAT_STATES_CHANNEL,
]);

/** Stream (re)connections per caller and channel per minute. */
export const STREAM_RATE_LIMIT = { limit: 30, windowMs: 60_000 } as const;
/** Open streams per server process, and per org within it (one busy org can't take them all). */
const MAX_STREAMS = 2_000;
const maxPerOrg = () => Math.max(1, Number(process.env.REALTIME_MAX_STREAMS_PER_ORG) || 500);

interface Live {
  readonly hub: RealtimeHub;
  readonly fanout: RealtimeFanout;
  readonly limits: StreamLimits;
  readonly seatFeed: SeatFeed;
  readonly seatReady: Promise<void>;
  readonly logReady: Promise<void>;
}

const g = globalThis as { __yyRealtime?: Live };

function realtimeLive(): Live {
  if (!g.__yyRealtime) {
    const hub = memoryRealtimeHub();
    const seatFeed = createSeatFeed({ publisher: realtimePublisherFromEnv(hub), pollMs: 15_000 });
    const seatReady = listenForSeatChanges(seatFeed).then(
      () => undefined,
      (err: Error) => {
        // No LISTEN (e.g. a transaction pooler): fall back to re-reading watched events.
        console.warn(`seat feed: LISTEN unavailable (${err.message}); polling every 2 s`);
        (setInterval(() => seatFeed.resync(), 2_000) as { unref?: () => void }).unref?.();
      },
    );
    const ablyKey = realtimeProvider() === 'ably' ? process.env.ABLY_API_KEY : undefined;
    const fanout = createRealtimeFanout({
      hub,
      // With Ably configured every process publishes what it sees; Ably drops repeats by id.
      publisher: ablyKey ? ablyRealtimePublisher({ apiKey: ablyKey }) : null,
    });
    const logReady = listenForRealtime(fanout).then(
      () => undefined,
      (err: Error) => {
        console.warn(`realtime: LISTEN unavailable (${err.message}); replaying every 2 s`);
        (setInterval(() => fanout.resync(), 2_000) as { unref?: () => void }).unref?.();
      },
    );
    g.__yyRealtime = {
      hub,
      fanout,
      limits: new StreamLimits({ perProcess: MAX_STREAMS, perOrg: maxPerOrg() }),
      seatFeed,
      seatReady,
      logReady,
    };
  }
  return g.__yyRealtime;
}

/** A rate-limit key that never stores the raw cookie, user or device id. */
export const streamKey = (who: string | null | undefined) =>
  createHash('sha256')
    .update(who ?? 'anonymous')
    .digest('hex')
    .slice(0, 40);

const systemCtx = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: 'realtime.stream' } });

// --- Snapshots and public rules per channel ---------------------------------------------------

/** What a client that can't be caught up by id gets: the channel's current state (allowlisted). */
const SNAPSHOTS: Record<string, (tx: TenantTx, channel: ResolvedChannel) => Promise<unknown>> = {
  'event.checkins': async (tx, c) => {
    const f = await checkinFactsTx(tx, { eventId: c.eventId ?? undefined });
    return { admitted: f.admissions, tickets: f.tickets };
  },
};

function logSource(channel: ResolvedChannel): SseSource {
  const live = realtimeLive();
  return {
    subscribe: (listener) => live.hub.subscribe(channel.name, listener),
    catchUp: (lastEventId) =>
      withTenant(systemCtx(channel.orgId), async (tx): Promise<RealtimeMessage[]> => {
        const missed = await realtimeCatchUpTx(tx, channel.name, lastEventId);
        // Without LISTEN (or after it reconnects) the fan-out replays this channel from here.
        if (missed) {
          live.fanout.baseline(channel.name, missed.at(-1)?.id ?? lastEventId ?? '0');
          return missed;
        }
        const id = (await latestRealtimeIdTx(tx, channel.name)) ?? '0';
        live.fanout.baseline(channel.name, id);
        const snapshot = SNAPSHOTS[channel.def.key];
        return [{ id, event: 'snapshot', data: snapshot ? await snapshot(tx, channel) : {} }];
      }),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function seatSource(
  orgId: string,
  eventId: string,
  kind: SeatStreamKind,
  /** The date (M1.7g, `?date=`): the chart that date uses, within the channel's own event. */
  date: string | null,
): Promise<SseSource | null> {
  const live = realtimeLive();
  await live.seatReady;
  const watch = await live.seatFeed.watch(orgId, eventId, date && UUID.test(date) ? date : null);
  if (!watch || (kind === 'public' && !watch.isPublic)) {
    watch?.release();
    return null;
  }
  const name = kind === 'public' ? watch.channels.public : watch.channels.staff;
  return {
    subscribe: (listener) => live.hub.subscribe(name, listener),
    catchUp: (lastEventId) => watch.catchUp(kind, lastEventId),
    release: () => watch.release(),
  };
}

// --- Authorization ------------------------------------------------------------------------------

export type RealtimeAttach =
  | {
      readonly ok: true;
      readonly channel: ResolvedChannel;
      /** How the caller got in. */
      readonly as: 'member' | 'device' | 'public';
      /** Who, for rate limits and Ably client ids (hashed before storing). */
      readonly who: string;
    }
  | { readonly ok: false; readonly status: 401 | 403 | 404 };

const BEARER = /^Bearer (yyd_[A-Za-z0-9_-]{43})$/;

/** A path segment as a channel name (Next may or may not have decoded it). */
export function channelParam(raw: string): string {
  try {
    return raw.includes('%') ? decodeURIComponent(raw) : raw;
  } catch {
    return '';
  }
}

/**
 * May this request attach to `name`? `hostOrgId` is set on a tenant host (the site's org): any
 * other org's channel is then refused whatever the caller holds.
 */
export async function authorizeRealtime(
  req: Request,
  name: string,
  opts: { hostOrgId?: string | null; publicWho?: string | null } = {},
): Promise<RealtimeAttach> {
  const channel = REALTIME_CHANNELS.resolve(name);
  if (!channel) return { ok: false, status: 404 };
  if (opts.hostOrgId !== undefined && opts.hostOrgId !== channel.orgId) return { ok: false, status: 403 };
  const def = channel.def;
  const bearer = BEARER.exec(req.headers.get('authorization') ?? '');
  let identified = false;
  let decision: Awaited<ReturnType<typeof decideRealtimeAccess>>;
  let who = `public:${opts.publicWho ?? 'anonymous'}`;
  let as: 'member' | 'device' = 'member';
  let ctx = null as ReturnType<typeof createCtx> | null;
  if (req.headers.get('authorization')) {
    // A presented credential must be a live device token; it is never ignored in favour of a cookie.
    const dc = bearer?.[1] ? await deviceContext(bearer[1]) : null;
    if (!dc) return { ok: false, status: 401 };
    identified = true;
    as = 'device';
    ctx = dc.ctx;
    who = `device:${dc.ctx.actor.type === 'system' ? dc.ctx.actor.name : ''}`;
    decision = await decideRealtimeAccess(channel, { deviceOrgId: dc.ctx.orgId });
  } else {
    const session = await getSession();
    if (session) {
      identified = true;
      who = `user:${session.userId}`;
      const userCtx = createCtx({ orgId: channel.orgId, actor: { type: 'user', userId: session.userId } });
      const member = (await memberRole(userCtx)) !== null;
      ctx = userCtx;
      decision = await decideRealtimeAccess(channel, {
        memberOrgId: member ? channel.orgId : null,
        can: (permission) =>
          ports.authorizer.can(userCtx, permission, channel.eventId ? { eventId: channel.eventId } : {}),
      });
    } else decision = await decideRealtimeAccess(channel, {});
  }
  if (decision === 'deny') return { ok: false, status: identified ? 403 : 401 };
  if (decision === 'public') {
    const open = channel.eventId ? await isPublicEvent(channel.orgId, channel.eventId) : false;
    if (!open) return { ok: false, status: 404 };
    return { ok: true, channel, as: 'public', who };
  }
  // Allowed by role or device: the module must be on, and the event must be this org's.
  if (def.entitlement && ctx && !(await ports.entitlements.has(ctx, def.entitlement)))
    return { ok: false, status: 404 };
  if (channel.eventId) {
    const eventId = channel.eventId;
    const exists = await withTenant(systemCtx(channel.orgId), (tx) => findEventTx(tx, eventId));
    if (!exists) return { ok: false, status: 404 };
  }
  return { ok: true, channel, as, who };
}

// --- Streams -----------------------------------------------------------------------------------

const serializerFor = (def: RealtimeChannelDef) => (m: RealtimeMessage) => {
  try {
    return { ...m, data: realtimePayload(def, m.event, m.data) };
  } catch (err) {
    console.warn(`realtime ${def.key}: dropped a "${m.event}" message (${(err as Error).message})`);
    return null;
  }
};

const busy = () => new Response(null, { status: 503, headers: { 'retry-after': '15' } });

/**
 * Open an SSE stream for a channel the caller was already allowed to attach to: rate limit,
 * connection limits, then resume from Last-Event-ID (or a snapshot), live messages, heartbeats.
 */
export async function realtimeStreamResponse(
  req: Request,
  attach: Extract<RealtimeAttach, { ok: true }>,
  opts: { rateBucket?: string } = {},
): Promise<Response> {
  const { channel } = attach;
  const live = realtimeLive();
  if (live.limits.refusal(channel.orgId)) return busy();
  const ctx = systemCtx(channel.orgId);
  const rate = await withTenant(ctx, (tx) =>
    hitRateLimitTx(tx, ctx, {
      bucket:
        opts.rateBucket ?? `realtime:${channel.def.key}:${channel.eventId ?? 'org'}:${streamKey(attach.who)}`,
      ...STREAM_RATE_LIMIT,
    }),
  );
  if (!rate.allowed)
    return new Response(null, {
      status: 429,
      headers: {
        'retry-after': String(Math.max(1, Math.ceil((rate.resetAt.getTime() - Date.now()) / 1000))),
      },
    });
  let source: SseSource | null;
  if (channel.def.source === 'feed') {
    const kind: SeatStreamKind = channel.def.key === SEATS_CHANNEL.key ? 'public' : 'staff';
    source = channel.eventId
      ? await seatSource(channel.orgId, channel.eventId, kind, new URL(req.url).searchParams.get('date'))
      : null;
    if (!source) return new Response(null, { status: 404 });
  } else {
    await live.logReady;
    source = logSource(channel);
  }
  let close: () => void = () => {};
  const release = live.limits.open(channel.orgId, () => close());
  if (!release) {
    source.release?.();
    return busy();
  }
  const sse = sseStream({
    source,
    lastEventId: lastEventIdOf(req),
    signal: req.signal,
    serialize: serializerFor(channel.def),
    onClose: release,
  });
  close = sse.close;
  return new Response(sse.stream, { headers: SSE_HEADERS });
}

/** The whole attach-and-stream path of a stream URL. */
export async function realtimeRoute(
  req: Request,
  name: string,
  opts: { hostOrgId?: string | null; publicWho?: string | null } = {},
): Promise<Response> {
  const attach = await authorizeRealtime(req, name, opts);
  if (!attach.ok) return new Response(null, { status: attach.status });
  return realtimeStreamResponse(req, attach);
}

/**
 * The M1.7f seat-stream URLs: the route already established the org and event (the slug's
 * public event, or the console's org after a membership check); same stream, same limits.
 */
export async function seatStreamResponse(
  req: Request,
  opts: { orgId: string; eventId: string; kind: SeatStreamKind; who: string | null },
): Promise<Response> {
  const def = opts.kind === 'public' ? SEATS_CHANNEL : SEAT_STATES_CHANNEL;
  const channel = REALTIME_CHANNELS.resolve(
    `org:${opts.orgId}:event:${opts.eventId}:${def.topic}`,
  ) as ResolvedChannel;
  return realtimeStreamResponse(
    req,
    { ok: true, channel, as: opts.kind === 'public' ? 'public' : 'member', who: opts.who ?? 'anonymous' },
    { rateBucket: `seat-stream:${opts.eventId}:${streamKey(opts.who)}` },
  );
}

/** Dev/CI only: end every open stream now (browsers reconnect with their Last-Event-ID). */
export function dropRealtimeStreams(): number {
  return realtimeLive().limits.closeAll();
}

/** Open streams of this process (for an org, or all). */
export function openRealtimeStreams(orgId?: string): number {
  return realtimeLive().limits.count(orgId);
}
