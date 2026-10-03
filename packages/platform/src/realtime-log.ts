import { type Listener, listenChannel, type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { defineSubscriber, type PublishedEvent, type Subscriber } from './outbox/outbox.ts';
import type { RealtimeHub, RealtimeMessage } from './realtime.ts';
import {
  parseRealtimeChannel,
  type RealtimeChannelDef,
  realtimeChannelName,
  realtimePayload,
} from './realtime-channels.ts';
import { realtimeMessages } from './schema.ts';

/**
 * Publishing and fan-out of `log` channels (M3.1b; see `realtimeMessages` in schema.ts).
 *
 * Ordering: ids are the log's `seq`, increasing in insertion order. Two transactions publishing
 * to one channel at the same moment may commit out of order; live delivery still carries both,
 * and a client resuming exactly between them could miss the earlier one until its next snapshot.
 * Realtime is derived data (ADR 0009): screens re-read on a snapshot, never trust a stream alone.
 */
export const REALTIME_NOTIFY_CHANNEL = 'realtime_messages';
/** How many messages a resuming client may be replayed; further behind gets a snapshot. */
export const REALTIME_REPLAY_LIMIT = 500;

export interface RealtimePublish {
  /** Required for event and session channels. */
  readonly eventId?: string | null;
  /** Required for session channels (M5.7a). */
  readonly sessionId?: string | null;
  readonly event: string;
  readonly data: unknown;
}

/**
 * Publish to a `log` channel inside the caller's tenant transaction (a command handler or an
 * outbox subscriber). The payload goes through the channel's allowlist; nothing is delivered
 * unless the transaction commits. Returns the message id.
 */
export async function publishRealtimeTx(
  tx: TenantTx,
  orgId: string,
  def: RealtimeChannelDef,
  message: RealtimePublish,
): Promise<string> {
  if (def.source !== 'log') throw new Error(`Realtime channel ${def.key} is not published through the log`);
  const channel = realtimeChannelName(def, orgId, message.eventId, message.sessionId);
  const data = realtimePayload(def, message.event, message.data);
  const [row] = await tx
    .insert(realtimeMessages)
    .values({ orgId, channel, event: message.event, data: data as object })
    .returning({ seq: realtimeMessages.seq });
  return String(row?.seq ?? '');
}

/** A Last-Event-ID from the log, or null for anything else (another feed's id, garbage). */
export function parseRealtimeId(id: string | null | undefined): number | null {
  if (!id || !/^[1-9]\d{0,14}$/.test(id)) return null;
  return Number(id);
}

const toMessage = (r: { seq: number; event: string; data: unknown }): RealtimeMessage => ({
  id: String(r.seq),
  event: r.event,
  data: r.data,
});

/**
 * What a client resuming at `lastId` missed on `channel`, oldest first — or null when that can't
 * be known (no or foreign id, the message was pruned, or more than the replay limit): the stream
 * then sends a snapshot instead.
 */
export async function realtimeCatchUpTx(
  tx: TenantTx,
  channel: string,
  lastId: string | null,
  limit = REALTIME_REPLAY_LIMIT,
): Promise<RealtimeMessage[] | null> {
  const last = parseRealtimeId(lastId);
  if (last === null) return null;
  // The client's last message must still be in the log for this channel: otherwise messages
  // between it and the oldest kept one may have been pruned.
  const [anchor] = await tx
    .select({ seq: realtimeMessages.seq })
    .from(realtimeMessages)
    .where(and(eq(realtimeMessages.channel, channel), eq(realtimeMessages.seq, last)));
  if (!anchor) return null;
  const rows = await tx
    .select({ seq: realtimeMessages.seq, event: realtimeMessages.event, data: realtimeMessages.data })
    .from(realtimeMessages)
    .where(and(eq(realtimeMessages.channel, channel), gt(realtimeMessages.seq, last)))
    .orderBy(asc(realtimeMessages.seq))
    .limit(limit + 1);
  if (rows.length > limit) return null;
  return rows.map(toMessage);
}

/** The latest message id on a channel (the id a snapshot stands for), or null. */
export async function latestRealtimeIdTx(tx: TenantTx, channel: string): Promise<string | null> {
  const [r] = await tx
    .select({ seq: sql<number>`max(${realtimeMessages.seq})` })
    .from(realtimeMessages)
    .where(eq(realtimeMessages.channel, channel));
  return r?.seq ? String(r.seq) : null;
}

export interface LoggedMessage {
  readonly channel: string;
  readonly message: RealtimeMessage;
}

/** Read logged messages by id (the fan-out's fetch), under the org's RLS. */
export async function realtimeMessagesByIdTx(
  tx: TenantTx,
  seqs: readonly number[],
): Promise<LoggedMessage[]> {
  if (seqs.length === 0) return [];
  const rows = await tx
    .select({
      seq: realtimeMessages.seq,
      channel: realtimeMessages.channel,
      event: realtimeMessages.event,
      data: realtimeMessages.data,
    })
    .from(realtimeMessages)
    .where(inArray(realtimeMessages.seq, [...seqs]))
    .orderBy(asc(realtimeMessages.seq));
  return rows.map((r) => ({ channel: r.channel, message: toMessage(r) }));
}

/** Delete log rows older than an hour (retention job; returns how many). */
export async function purgeRealtimeMessages(): Promise<number> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ n: number }>(sql`select platform.purge_realtime_messages() as n`),
  );
  return rows[0]?.n ?? 0;
}

/**
 * An outbox subscriber that turns domain events into realtime messages (for publishers that
 * don't run in the command's transaction). The handler runs in the subscriber's tenant
 * transaction, so each event publishes once (consumers are exactly-once).
 */
export function realtimeSubscriber(opts: {
  readonly name: string;
  readonly events: readonly string[];
  readonly map: (
    event: PublishedEvent,
  ) => readonly (RealtimePublish & { readonly channel: RealtimeChannelDef })[];
}): Subscriber {
  return defineSubscriber({
    name: opts.name,
    events: opts.events,
    handle: async (tx, event) => {
      for (const m of opts.map(event)) await publishRealtimeTx(tx, event.orgId, m.channel, m);
    },
  });
}

// --- Fan-out ----------------------------------------------------------------------------------

export interface RealtimeFanout {
  /** A `realtime_messages` notification ("{seq} {channel}"). */
  notify(payload: string): void;
  /** After the LISTEN connection (re)connects: replay what listeners may have missed. */
  resync(): void;
  /**
   * A stream just caught a client up to `id` on `channel`: a later resync replays from there
   * (unless messages past it were already delivered here).
   */
  baseline(channel: string, id: string): void;
  /** Resolves when every notification received so far has been delivered (tests). */
  idle(): Promise<void>;
  close(): void;
}

export interface RealtimeFanoutOptions {
  /** Delivered messages go here (the in-process hub the SSE streams subscribe to). */
  readonly hub: RealtimeHub;
  /** Also publish to (Ably), or nothing. */
  readonly publisher?: { publish(channel: string, message: RealtimeMessage): Promise<void> } | null;
  /** Fetch messages by id for one org (default: the log, under that org's RLS). */
  readonly load?: (orgId: string, seqs: readonly number[]) => Promise<LoggedMessage[]>;
  /** Replay a channel after an id (default: the log). */
  readonly replay?: (orgId: string, channel: string, afterSeq: number) => Promise<RealtimeMessage[]>;
  /**
   * Whether this process wants a channel's messages (default: a local subscriber exists, or an
   * extra publisher is configured). Notifications for other channels are never fetched.
   */
  readonly interested?: (channel: string) => boolean;
  /** Collect notifications this long before fetching them in one query per org. */
  readonly batchMs?: number;
}

/** Ids remembered per channel to drop duplicates (a resync overlapping live delivery). */
const RECENT_IDS = 1_000;
/** Channels remembered before those without local followers are forgotten. */
const MAX_CHANNELS = 2_000;
const NOTIFY_PAYLOAD = /^([1-9]\d{0,14}) (org:[0-9a-f-]{36}:[a-z0-9:_-]{1,120})$/;

const systemCtx = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: 'realtime.fanout' } });

const defaultLoad = (orgId: string, seqs: readonly number[]) =>
  withTenant(systemCtx(orgId), (tx) => realtimeMessagesByIdTx(tx, seqs));

const defaultReplay = (orgId: string, channel: string, afterSeq: number) =>
  withTenant(systemCtx(orgId), async (tx) => {
    const rows = await tx
      .select({ seq: realtimeMessages.seq, event: realtimeMessages.event, data: realtimeMessages.data })
      .from(realtimeMessages)
      .where(and(eq(realtimeMessages.channel, channel), gt(realtimeMessages.seq, afterSeq)))
      .orderBy(asc(realtimeMessages.seq))
      .limit(REALTIME_REPLAY_LIMIT);
    return rows.map(toMessage);
  });

/**
 * Fan logged messages out to this process's subscribers. Notifications are batched per org and
 * delivered one batch after another, in id order within a batch; a message already delivered on
 * its channel is never delivered again (so a resync overlapping live delivery never duplicates).
 */
export function createRealtimeFanout(opts: RealtimeFanoutOptions): RealtimeFanout {
  const load = opts.load ?? defaultLoad;
  const replay = opts.replay ?? defaultReplay;
  const interested =
    opts.interested ?? ((c: string) => Boolean(opts.publisher) || opts.hub.listenerCount(c) > 0);
  const batchMs = opts.batchMs ?? 5;
  /** org → seqs waiting to be fetched. */
  let pending = new Map<string, Set<number>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  /** Per channel: the highest id delivered (resync point) and the recent ids (never twice). */
  const delivered = new Map<string, { max: number; recent: Set<number> }>();
  let closed = false;

  async function deliver(channel: string, m: RealtimeMessage): Promise<void> {
    const seq = Number(m.id);
    let d = delivered.get(channel);
    if (!d) {
      forget();
      d = { max: 0, recent: new Set() };
      delivered.set(channel, d);
    }
    // Concurrent publishers can commit out of id order, so a lower id may still be new here.
    if (d.recent.has(seq)) return;
    d.recent.add(seq);
    if (d.recent.size > RECENT_IDS) {
      const oldest = d.recent.values().next().value;
      if (oldest !== undefined) d.recent.delete(oldest);
    }
    d.max = Math.max(d.max, seq);
    await opts.hub.publish(channel, m);
    if (opts.publisher) await opts.publisher.publish(channel, m);
  }

  /** Keep the per-channel memory bounded: drop channels nobody here follows any more. */
  function forget(): void {
    if (delivered.size < MAX_CHANNELS) return;
    for (const c of delivered.keys()) if (!interested(c)) delivered.delete(c);
  }

  function run(task: () => Promise<void>): void {
    chain = chain.then(task).catch((err: Error) => console.warn(`realtime fan-out: ${err.message}`));
  }

  function flush(): void {
    timer = null;
    const batch = pending;
    pending = new Map();
    run(async () => {
      for (const [orgId, seqs] of batch) {
        const rows = await load(
          orgId,
          [...seqs].sort((x, y) => x - y),
        );
        for (const r of rows)
          if (parseRealtimeChannel(r.channel)?.orgId === orgId) await deliver(r.channel, r.message);
      }
    });
  }

  return {
    notify(payload) {
      if (closed) return;
      const m = NOTIFY_PAYLOAD.exec(payload);
      const orgId = m ? parseRealtimeChannel(m[2] ?? '')?.orgId : null;
      if (!m || !orgId || !interested(m[2] ?? '')) return;
      let set = pending.get(orgId);
      if (!set) {
        set = new Set();
        pending.set(orgId, set);
      }
      set.add(Number(m[1]));
      if (!timer) {
        timer = setTimeout(flush, batchMs);
        (timer as { unref?: () => void }).unref?.();
      }
    },
    resync() {
      if (closed) return;
      // Channels nobody here follows any more are forgotten (the map stays bounded).
      for (const c of delivered.keys()) if (!interested(c)) delivered.delete(c);
      const channels = [...delivered.keys()];
      run(async () => {
        for (const channel of channels) {
          const orgId = parseRealtimeChannel(channel)?.orgId;
          if (!orgId) continue;
          for (const m of await replay(orgId, channel, delivered.get(channel)?.max ?? 0))
            await deliver(channel, m);
        }
      });
    },
    baseline(channel, id) {
      if (closed || delivered.has(channel) || !parseRealtimeChannel(channel)) return;
      forget();
      delivered.set(channel, { max: parseRealtimeId(id) ?? 0, recent: new Set() });
    },
    async idle() {
      if (timer) {
        clearTimeout(timer);
        flush();
      }
      await chain;
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      pending.clear();
    },
  };
}

/** Feed a fan-out from Postgres notifications (one LISTEN connection per process). */
export function listenForRealtime(fanout: RealtimeFanout): Promise<Listener> {
  return listenChannel(
    REALTIME_NOTIFY_CHANNEL,
    (payload) => fanout.notify(payload),
    () => fanout.resync(),
  );
}
