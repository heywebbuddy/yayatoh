import 'server-only';
import { createHash } from 'node:crypto';
import { withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import {
  hitRateLimitTx,
  memoryRealtimeHub,
  type RealtimeHub,
  type RealtimeMessage,
  realtimePublisherFromEnv,
} from '@yayatoh/platform';
import { createSeatFeed, listenForSeatChanges, type SeatFeed, type SeatStreamKind } from '@yayatoh/seating';

/**
 * Live seat availability over Server-Sent Events (M1.7f). One seat feed per server process
 * listens to Postgres (`seating_seats` notifications), and every open stream subscribes to its
 * event's org-scoped channel on the in-process hub. The org and event always come from the route
 * (the slug's event, or the console's org and event after a membership check), never from the
 * client: a stream can only ever carry its own event's channel.
 */
interface Live {
  readonly hub: RealtimeHub;
  readonly feed: SeatFeed;
  readonly ready: Promise<void>;
  /** Close functions of the open streams (limits, and the dev "drop connections" switch). */
  readonly open: Set<() => void>;
}

/** Open streams per server process; past it, clients retry later (they keep the page as is). */
const MAX_STREAMS = 2_000;
/** Stream (re)connections per device (or signed-in user) and event per minute. */
export const STREAM_RATE_LIMIT = { limit: 30, windowMs: 60_000 } as const;
const PING_MS = 20_000;
/** How long a browser waits before reconnecting a dropped stream. */
const RETRY_MS = 2_000;

const g = globalThis as { __yySeatLive?: Live };

export function seatLive(): Live {
  if (!g.__yySeatLive) {
    const hub = memoryRealtimeHub();
    const feed = createSeatFeed({ publisher: realtimePublisherFromEnv(hub), pollMs: 15_000 });
    const ready = listenForSeatChanges(feed).then(
      () => undefined,
      (err: Error) => {
        // No LISTEN (e.g. a transaction pooler): fall back to re-reading watched events.
        console.warn(`seat feed: LISTEN unavailable (${err.message}); polling every 2 s`);
        (setInterval(() => feed.resync(), 2_000) as { unref?: () => void }).unref?.();
      },
    );
    g.__yySeatLive = { hub, feed, ready, open: new Set() };
  }
  return g.__yySeatLive;
}

/** A rate-limit key that never stores the raw cookie or user id. */
export const streamKey = (who: string | null | undefined) =>
  createHash('sha256')
    .update(who ?? 'anonymous')
    .digest('hex')
    .slice(0, 40);

const HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  // no-transform: proxies and the compression middleware must not buffer the stream.
  'cache-control': 'no-cache, no-store, no-transform',
  'x-accel-buffering': 'no',
} as const;

/**
 * Open a seat stream for an event the caller was already allowed to see. Public streams need the
 * map on sale; a reconnecting client sends `Last-Event-ID` (header, or `lastEventId` in the query
 * when it reconnects by itself) and gets what it missed, otherwise a full snapshot.
 */
export async function seatStreamResponse(
  req: Request,
  opts: { orgId: string; eventId: string; kind: SeatStreamKind; who: string | null },
): Promise<Response> {
  const live = seatLive();
  if (live.open.size >= MAX_STREAMS)
    return new Response(null, { status: 503, headers: { 'retry-after': '15' } });
  const ctx = createCtx({ orgId: opts.orgId, actor: { type: 'system', name: 'seating.stream' } });
  const rate = await withTenant(ctx, (tx) =>
    hitRateLimitTx(tx, ctx, {
      bucket: `seat-stream:${opts.eventId}:${streamKey(opts.who)}`,
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
  await live.ready;
  // The date (M1.7g, `?date=`): the chart that date uses, within the route's own event.
  const date = new URL(req.url).searchParams.get('date');
  const watch = await live.feed.watch(
    opts.orgId,
    opts.eventId,
    date && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(date) ? date : null,
  );
  if (!watch || (opts.kind === 'public' && !watch.isPublic)) {
    watch?.release();
    return new Response(null, { status: 404 });
  }
  const lastEventId =
    req.headers.get('last-event-id') ?? new URL(req.url).searchParams.get('lastEventId') ?? null;
  const encoder = new TextEncoder();
  let release: (closeStream: boolean) => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let finished = false;
      const write = (text: string) => {
        if (finished) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          release(true);
        }
      };
      const send = (m: RealtimeMessage) =>
        write(`id: ${m.id}\nevent: ${m.event}\ndata: ${JSON.stringify(m.data)}\n\n`);
      const channel = opts.kind === 'public' ? watch.channels.public : watch.channels.staff;
      const unsubscribe = live.hub.subscribe(channel, send);
      const ping = setInterval(() => write(': ping\n\n'), PING_MS);
      // A server-side close (the dev switch, a failed write) ends the stream; a client that left
      // only needs its subscription released (the server cancels the stream itself).
      const close = () => release(true);
      release = (closeStream) => {
        if (finished) return;
        finished = true;
        clearInterval(ping);
        unsubscribe();
        watch.release();
        live.open.delete(close);
        if (closeStream)
          try {
            controller.close();
          } catch {
            // Already closed.
          }
      };
      live.open.add(close);
      req.signal.addEventListener('abort', () => release(false));
      write(`retry: ${RETRY_MS}\n\n`);
      for (const m of watch.catchUp(opts.kind, lastEventId)) send(m);
    },
    cancel() {
      release(false);
    },
  });
  return new Response(stream, { headers: HEADERS });
}

/** Dev/CI only: end every open stream now (browsers reconnect with their Last-Event-ID). */
export function dropSeatStreams(): number {
  const live = seatLive();
  const all = [...live.open];
  for (const close of all) close();
  return all.length;
}
