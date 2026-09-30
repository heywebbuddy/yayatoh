import type { RealtimeMessage } from './realtime.ts';

/**
 * The Server-Sent Events core every realtime stream shares (M3.1b): resume, heartbeat,
 * backpressure, and per-org connection limits. Transport only: who may attach, and which
 * messages exist, is decided before a stream is opened.
 */
export const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  // no-transform: proxies and the compression middleware must not buffer the stream.
  'cache-control': 'no-cache, no-store, no-transform',
  'x-accel-buffering': 'no',
} as const;

export interface SseSource {
  /** Live messages from now on; returns the unsubscribe. Subscribed before `catchUp` runs. */
  subscribe(listener: (message: RealtimeMessage) => void): () => void;
  /** What a (re)connecting client gets first: what it missed after `lastEventId`, or a snapshot. */
  catchUp(lastEventId: string | null): Promise<readonly RealtimeMessage[]> | readonly RealtimeMessage[];
  /** The stream ended (client left, server closed it, backpressure). */
  release?(): void;
}

export interface SseOptions {
  readonly source: SseSource;
  readonly lastEventId: string | null;
  /** The request's signal: the client went away. */
  readonly signal?: AbortSignal;
  /** Last chance to allowlist (or drop, with null) each message before it is written. */
  readonly serialize?: (message: RealtimeMessage) => RealtimeMessage | null;
  readonly pingMs?: number;
  /** How long a browser waits before reconnecting a dropped stream. */
  readonly retryMs?: number;
  /** A client this far behind (bytes queued, unread) is disconnected; it resumes by id. */
  readonly maxBufferedBytes?: number;
  readonly onClose?: () => void;
}

export interface SseStream {
  readonly stream: ReadableStream<Uint8Array>;
  /** End the stream from the server side (limits, the dev "drop connections" switch). */
  close(): void;
}

const HIGH_WATER = 64 * 1024;

/** One SSE frame. Data is JSON on one line, so it can never inject another field. */
export function formatSse(m: RealtimeMessage): string {
  const clean = (s: string) => s.replace(/[\r\n]/g, '');
  return `id: ${clean(m.id)}\nevent: ${clean(m.event)}\ndata: ${JSON.stringify(m.data)}\n\n`;
}

/** The Last-Event-ID of a request: the header (browser reconnects) or `lastEventId` (our own). */
export function lastEventIdOf(req: Request): string | null {
  const v = req.headers.get('last-event-id') ?? new URL(req.url).searchParams.get('lastEventId');
  return v && v.length <= 80 ? v : null;
}

export function sseStream(opts: SseOptions): SseStream {
  const encoder = new TextEncoder();
  const pingMs = opts.pingMs ?? 20_000;
  const maxBuffered = opts.maxBufferedBytes ?? 1024 * 1024;
  let finish: (closeStream: boolean) => void = () => {};
  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        let finished = false;
        /** Ids already written (catch-up and live may overlap; concurrent ids may interleave). */
        const sent = new Set<string>();
        /** Live messages that arrive while the catch-up is still being read. */
        let pending: RealtimeMessage[] | null = [];
        const write = (text: string) => {
          if (finished) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            finish(true);
            return;
          }
          // A client that doesn't read (or reads too slowly) is let go: it reconnects with its
          // last id and catches up from the log or a snapshot, instead of us buffering for it.
          if ((controller.desiredSize ?? 0) < -maxBuffered) finish(true);
        };
        const send = (m: RealtimeMessage) => {
          if (sent.has(m.id)) return;
          const out = opts.serialize ? opts.serialize(m) : m;
          if (!out) return;
          sent.add(m.id);
          if (sent.size > 2_000) sent.delete(sent.values().next().value ?? '');
          write(formatSse(out));
        };
        const unsubscribe = opts.source.subscribe((m) => {
          if (pending) pending.push(m);
          else send(m);
        });
        const ping = setInterval(() => write(': ping\n\n'), pingMs);
        (ping as { unref?: () => void }).unref?.();
        finish = (closeStream) => {
          if (finished) return;
          finished = true;
          clearInterval(ping);
          unsubscribe();
          opts.source.release?.();
          opts.onClose?.();
          if (closeStream)
            try {
              controller.close();
            } catch {
              // Already closed or errored.
            }
        };
        opts.signal?.addEventListener('abort', () => finish(false));
        if (opts.signal?.aborted) {
          finish(false);
          return;
        }
        write(`retry: ${opts.retryMs ?? 2_000}\n\n`);
        return Promise.resolve(opts.source.catchUp(opts.lastEventId)).then(
          (first) => {
            for (const m of first) send(m);
            const queued = pending ?? [];
            pending = null;
            for (const m of queued) send(m);
          },
          (err: Error) => {
            console.warn(`realtime stream catch-up failed: ${err.message}`);
            finish(true);
          },
        );
      },
      cancel() {
        finish(false);
      },
    },
    { highWaterMark: HIGH_WATER, size: (chunk) => chunk.byteLength },
  );
  return { stream, close: () => finish(true) };
}

/**
 * Open-stream accounting for one server process: a ceiling per process and per org (one busy
 * org cannot take every connection). Each open stream registers its close function, so the dev
 * switch (and a shutdown) can end them all; clients reconnect by themselves.
 */
export class StreamLimits {
  readonly #perProcess: number;
  readonly #perOrg: number;
  readonly #open = new Map<string, Set<() => void>>();
  #total = 0;

  constructor(limits: { perProcess: number; perOrg: number }) {
    this.#perProcess = limits.perProcess;
    this.#perOrg = limits.perOrg;
  }

  /** Why a new stream for this org would be refused now, or null. */
  refusal(orgId: string): 'process' | 'org' | null {
    if (this.#total >= this.#perProcess) return 'process';
    if ((this.#open.get(orgId)?.size ?? 0) >= this.#perOrg) return 'org';
    return null;
  }

  /** Register an open stream; returns its release (idempotent), or null when over a limit. */
  open(orgId: string, close: () => void): (() => void) | null {
    if (this.refusal(orgId)) return null;
    let set = this.#open.get(orgId);
    if (!set) {
      set = new Set();
      this.#open.set(orgId, set);
    }
    set.add(close);
    this.#total += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const s = this.#open.get(orgId);
      if (s?.delete(close)) this.#total -= 1;
      if (s && s.size === 0) this.#open.delete(orgId);
    };
  }

  count(orgId?: string): number {
    return orgId ? (this.#open.get(orgId)?.size ?? 0) : this.#total;
  }

  /** End every open stream (dev/CI "network blip"); returns how many. */
  closeAll(): number {
    const all = [...this.#open.values()].flatMap((s) => [...s]);
    for (const close of all) close();
    return all.length;
  }
}
