/**
 * Realtime publishing (ADR 0009): live features push small, derived messages to channels.
 * Postgres stays the system of record; a lost message is repaired by the next snapshot.
 *
 * - `memoryRealtimeHub()` fans messages out inside one process. The web app's SSE endpoints
 *   subscribe to it (dev, CI, and the SSE fallback in production).
 * - `ablyRealtimePublisher()` publishes the same messages to Ably over its REST API when
 *   `REALTIME_PROVIDER=ably` and `ABLY_API_KEY` are set (owner account; token auth for browsers
 *   comes with it). Until then SSE is the transport everywhere.
 *
 * Channels are always scoped to an org (`org:{orgId}:…`), so a token or a stream for one org can
 * never name another org's channel.
 */
export interface RealtimeMessage {
  /** Monotonic within its channel (SSE `id`, used for Last-Event-ID resumption). */
  readonly id: string;
  /** The message type (SSE `event`). */
  readonly event: string;
  readonly data: unknown;
}

export interface RealtimePublisher {
  readonly name: string;
  publish(channel: string, message: RealtimeMessage): Promise<void>;
}

export type RealtimeListener = (message: RealtimeMessage) => void;

export interface RealtimeHub extends RealtimePublisher {
  /** Receive every message published to `channel` from now on; returns the unsubscribe. */
  subscribe(channel: string, listener: RealtimeListener): () => void;
  listenerCount(channel: string): number;
}

const ORG_CHANNEL = /^org:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):[a-z0-9:_-]+$/;

/** An org-scoped channel name: `org:{orgId}:{…parts}`. */
export function orgChannel(orgId: string, ...parts: string[]): string {
  const name = `org:${orgId}:${parts.join(':')}`;
  if (!ORG_CHANNEL.test(name)) throw new Error(`Invalid realtime channel: ${name}`);
  return name;
}

/** The org a channel belongs to, or null for a malformed name. */
export function channelOrg(channel: string): string | null {
  return ORG_CHANNEL.exec(channel)?.[1] ?? null;
}

/** In-process fan-out. A listener that throws is dropped from that delivery, never the others. */
export function memoryRealtimeHub(): RealtimeHub {
  const channels = new Map<string, Set<RealtimeListener>>();
  return {
    name: 'memory',
    async publish(channel, message) {
      for (const listener of [...(channels.get(channel) ?? [])]) {
        try {
          listener(message);
        } catch (err) {
          console.warn(`realtime listener on ${channel} failed: ${(err as Error).message}`);
        }
      }
    },
    subscribe(channel, listener) {
      if (!channelOrg(channel)) throw new Error(`Invalid realtime channel: ${channel}`);
      let set = channels.get(channel);
      if (!set) {
        set = new Set();
        channels.set(channel, set);
      }
      set.add(listener);
      return () => {
        const s = channels.get(channel);
        s?.delete(listener);
        if (s && s.size === 0) channels.delete(channel);
      };
    },
    listenerCount: (channel) => channels.get(channel)?.size ?? 0,
  };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Ably REST publisher (stub until the owner's Ably account exists): POST
 * `/channels/{channel}/messages` with basic auth. Failures are logged, never thrown — realtime is
 * derived, and clients resynchronise from a snapshot.
 */
export function ablyRealtimePublisher(opts: {
  apiKey: string;
  fetch?: Fetch;
  endpoint?: string;
}): RealtimePublisher {
  if (!/^[^:\s]+:[^\s]+$/.test(opts.apiKey))
    throw new Error('ABLY_API_KEY must look like "appId.keyId:secret"');
  const endpoint = opts.endpoint ?? 'https://rest.ably.io';
  const send = opts.fetch ?? ((url, init) => fetch(url, init));
  const auth = `Basic ${Buffer.from(opts.apiKey).toString('base64')}`;
  return {
    name: 'ably',
    async publish(channel, message) {
      if (!channelOrg(channel)) throw new Error(`Invalid realtime channel: ${channel}`);
      try {
        const res = await send(`${endpoint}/channels/${encodeURIComponent(channel)}/messages`, {
          method: 'POST',
          headers: { authorization: auth, 'content-type': 'application/json' },
          body: JSON.stringify({ id: message.id, name: message.event, data: JSON.stringify(message.data) }),
        });
        if (!res.ok) console.warn(`ably publish ${channel}: ${res.status}`);
      } catch (err) {
        console.warn(`ably publish ${channel}: ${(err as Error).message}`);
      }
    },
  };
}

/**
 * The capability an Ably token for one event's public seat availability may carry: subscribe to
 * that org's channel only (ADR 0009: a token never grants another org's channels).
 */
export function ablySubscribeCapability(channels: readonly string[]): Record<string, ['subscribe']> {
  return Object.fromEntries(
    channels.map((c) => {
      if (!channelOrg(c)) throw new Error(`Invalid realtime channel: ${c}`);
      return [c, ['subscribe'] as ['subscribe']];
    }),
  );
}

/** Publish to several transports (the in-process hub and Ably). */
export function teePublisher(...publishers: RealtimePublisher[]): RealtimePublisher {
  return {
    name: publishers.map((p) => p.name).join('+'),
    async publish(channel, message) {
      await Promise.all(publishers.map((p) => p.publish(channel, message)));
    },
  };
}

/**
 * What the app publishes through: always the in-process hub (the SSE endpoints read it), plus
 * Ably when `REALTIME_PROVIDER=ably` and its key are set. Ably without a key is refused in
 * production (a silent fallback would hide the misconfiguration) and ignored elsewhere.
 */
export function realtimePublisherFromEnv(
  hub: RealtimeHub,
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: Fetch,
): RealtimePublisher {
  const provider = env.REALTIME_PROVIDER ?? 'sse';
  if (provider === 'sse') return hub;
  if (provider !== 'ably') throw new Error(`Unknown REALTIME_PROVIDER: ${provider}`);
  if (!env.ABLY_API_KEY) {
    if (env.NODE_ENV === 'production' && env.VERCEL_ENV === 'production')
      throw new Error('REALTIME_PROVIDER=ably needs ABLY_API_KEY');
    console.warn('REALTIME_PROVIDER=ably without ABLY_API_KEY: publishing over SSE only');
    return hub;
  }
  return teePublisher(hub, ablyRealtimePublisher({ apiKey: env.ABLY_API_KEY, fetch: fetchImpl }));
}
