import { type Listener, listenChannel, withTenant } from '@yayatoh/db';
import { createCtx, DomainError } from '@yayatoh/kernel';
import {
  defineRealtimeChannel,
  orgChannel,
  type RealtimeMessage,
  type RealtimePublisher,
  tenantQuery,
} from '@yayatoh/platform';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { type ChartKey, chartKeyTx, onChart } from './chart.ts';
import {
  availabilityLists,
  changedEntries,
  type LiveSeatState,
  liveSeatState,
  pricingKey,
  publicAvailability,
  type SeatCounts,
  sameKeys,
  seatCounts,
} from './domain/live.ts';
import { activeAdaRule } from './domain/rules.ts';
import type { SeatStatus } from './domain/seat-state.ts';
import { ruleStartTx, seatingRulesTx } from './rules.ts';
import { type EVENT_LAYOUT_STATUSES, eventLayouts, eventSeats } from './schema.ts';

/**
 * Live seat availability (M1.7f, ADR 0009/0012). Postgres triggers on `event_seats` (and on
 * `seating_rules`) NOTIFY `seating_seats` with "org:event" when a statement changes seats; the
 * notification arrives only after commit. The seat feed listens, re-reads the event's seats under
 * that org's RLS, diffs against what it last published, and publishes one coalesced message per
 * burst to two org-scoped channels:
 *
 * - `org:{o}:event:{e}:seats` — public: which seats buyers may choose (`on` / `off`), never who.
 * - `org:{o}:event:{e}:seat-states` — staff: each seat's state and the counts.
 *
 * Messages carry ids `{epoch}-{seq}`; a reconnecting client sends the last one (Last-Event-ID)
 * and gets what it missed, or a full snapshot when that is gone.
 */
export const SEAT_NOTIFY_CHANNEL = 'seating_seats';

/**
 * A chart's channels. The event plan keeps the event's channels; a date's own chart (M1.7g) has
 * `org:{o}:event:{e}:date:{d}:seats` and `…:seat-states`.
 */
export function seatChannels(orgId: string, eventId: string, chart: ChartKey = null) {
  const base = chart ? ['event', eventId, 'date', chart] : ['event', eventId];
  return {
    public: orgChannel(orgId, ...base, 'seats'),
    staff: orgChannel(orgId, ...base, 'seat-states'),
  } as const;
}

/** The chart a date uses (system actor, under the org's RLS): its own, or the event plan. */
export async function chartForDate(
  orgId: string,
  eventId: string,
  occurrenceId: string | null | undefined,
): Promise<ChartKey> {
  if (!occurrenceId) return null;
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'seating.live' } });
  return withTenant(ctx, (tx) => chartKeyTx(tx, eventId, occurrenceId));
}

export type SeatStreamKind = 'public' | 'staff';

export interface SeatSnapshot {
  readonly status: (typeof EVENT_LAYOUT_STATUSES)[number];
  /** Seats on sale → whether a buyer may choose them now. */
  readonly available: ReadonlyMap<string, boolean>;
  readonly pricing: string;
  readonly states: ReadonlyMap<string, LiveSeatState>;
  readonly counts: SeatCounts;
}

/** The public stream's payload: seats now choosable and not (all of them in a snapshot). */
export const PublicSeatsData = z.object({ on: z.array(z.uuid()), off: z.array(z.uuid()) });
/** The staff stream's payload: counts, and each changed seat's state (all of them in a snapshot). */
export const StaffSeatsData = z.object({
  counts: z.object({
    available: z.int(),
    held: z.int(),
    sold: z.int(),
    assigned: z.int(),
    blocked: z.int(),
  }),
  seats: z.record(z.uuid(), z.enum(['available', 'held', 'sold', 'assigned', 'blocked'])),
});

/**
 * The seat map's realtime channels (M3.1b registry entries). Served by the seat feed below, not
 * the message log; every message still leaves through these allowlists.
 */
export const SEATS_CHANNEL = defineRealtimeChannel({
  scope: 'event',
  topic: 'seats',
  source: 'feed',
  description: 'Which seats of an on-sale map buyers may choose (never who holds them)',
  access: { public: true },
  events: { snapshot: PublicSeatsData, delta: PublicSeatsData, refresh: z.object({}) },
});

export const SEAT_STATES_CHANNEL = defineRealtimeChannel({
  scope: 'event',
  topic: 'seat-states',
  source: 'feed',
  description: "Each seat's state and the counts, for the organizer and the box office",
  entitlement: 'seating',
  access: { permission: 'events:read' },
  events: { snapshot: StaffSeatsData, delta: StaffSeatsData, refresh: z.object({}) },
});

/** Read a chart's seats as the live feed sees them (system actor, under the org's RLS). */
export async function loadSeatSnapshot(
  orgId: string,
  eventId: string,
  now: Date = new Date(),
  chart: ChartKey = null,
): Promise<SeatSnapshot | null> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'seating.live' } });
  return withTenant(ctx, async (tx) => {
    const [layout] = await tx
      .select({ status: eventLayouts.status })
      .from(eventLayouts)
      .where(onChart(eventLayouts, eventId, chart));
    if (!layout) return null;
    const rows = (
      await tx
        .select({
          seatUuid: eventSeats.seatUuid,
          status: eventSeats.status,
          blockReason: eventSeats.blockReason,
          ticketTypeId: eventSeats.ticketTypeId,
          accessible: eventSeats.accessible,
        })
        .from(eventSeats)
        .where(onChart(eventSeats, eventId, chart))
        .orderBy(eventSeats.seatUuid)
    ).map((r) => ({ ...r, status: r.status as SeatStatus }));
    const rules = await seatingRulesTx(tx, eventId);
    let keptBack = false;
    if (rules.some((r) => r.kind === 'ada_reserved')) {
      const startsAt = await ruleStartTx(tx, eventId, chart);
      keptBack = startsAt ? activeAdaRule(rules, startsAt, now)?.severity === 'enforce' : false;
    }
    const states = new Map(rows.map((r) => [r.seatUuid, liveSeatState(r.status, r.blockReason)] as const));
    return {
      status: layout.status as SeatSnapshot['status'],
      available: publicAvailability(rows, { accessibleKeptBack: keptBack }),
      pricing: pricingKey(rows),
      states,
      counts: seatCounts(states.values()),
    };
  });
}

/**
 * Who may open the organizer's live stream: anyone who may read the event (`events:read`), for
 * an event of their org with a floor plan (RLS: another org's event is simply not there).
 */
export const seatingLiveAccessQuery = tenantQuery({
  name: 'seating.liveAccess',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({ eventId: z.uuid() }),
  entitlement: 'seating',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const [layout] = await tx
      .select({ id: eventLayouts.id })
      .from(eventLayouts)
      .where(eq(eventLayouts.eventId, input.eventId));
    if (!layout) throw new DomainError('not_found', 'This event has no floor plan');
    return { eventId: input.eventId };
  },
});

export interface SeatWatch {
  readonly channels: { readonly public: string; readonly staff: string };
  /** Buyers may see this map: on sale (published or locked) with seats priced. */
  readonly isPublic: boolean;
  /**
   * What a (re)connecting client gets first: the messages after `lastEventId` when this feed
   * still has them, otherwise one snapshot of the current state.
   */
  catchUp(kind: SeatStreamKind, lastEventId: string | null): RealtimeMessage[];
  /** The client left; the event is forgotten after a grace period without watchers. */
  release(): void;
}

export interface SeatFeed {
  readonly epoch: string;
  /**
   * Start (or join) watching an event's chart for a date (M1.7g: its own chart, else the event
   * plan); null when it has no floor plan.
   */
  watch(orgId: string, eventId: string, occurrenceId?: string | null): Promise<SeatWatch | null>;
  /** A `seating_seats` notification ("org:event"): every watched chart of the event re-reads. */
  notify(payload: string): void;
  /** Re-read every watched event (after the LISTEN connection (re)connects). */
  resync(): void;
  watching(): number;
  close(): void;
}

export interface SeatFeedOptions {
  readonly publisher: RealtimePublisher;
  readonly load?: (orgId: string, eventId: string, chart: ChartKey) => Promise<SeatSnapshot | null>;
  /** Which chart a date uses (default: read it from the database). */
  readonly resolveChart?: (orgId: string, eventId: string, occurrenceId: string) => Promise<ChartKey>;
  /** Wait this long after the first change of a burst before reading (collects the burst). */
  readonly coalesceMs?: number;
  /** At most one message per event per this interval. */
  readonly minIntervalMs?: number;
  /** Safety re-read of watched events (missed notifications, time-based rules); 0 = off. */
  readonly pollMs?: number;
  readonly graceMs?: number;
  readonly bufferSize?: number;
  readonly epoch?: string;
  readonly clock?: () => number;
}

interface Buffered {
  readonly seq: number;
  readonly public?: RealtimeMessage;
  readonly staff?: RealtimeMessage;
}

interface Entry {
  readonly orgId: string;
  readonly eventId: string;
  readonly chart: ChartKey;
  readonly channels: { readonly public: string; readonly staff: string };
  base: SeatSnapshot | null;
  /** The id of the state `base` represents. */
  seq: number;
  /** Messages up to this seq are no longer buffered (the entry's creation, then trimming). */
  trimmedThrough: number;
  buffer: Buffered[];
  refs: number;
  timer: ReturnType<typeof setTimeout> | null;
  drop: ReturnType<typeof setTimeout> | null;
  flushing: boolean;
  dirty: boolean;
  lastFlushAt: number;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PAYLOAD = new RegExp(`^(${UUID}):(${UUID})$`);

const unref = (t: ReturnType<typeof setTimeout>) => {
  (t as { unref?: () => void }).unref?.();
  return t;
};

const onSale = (s: SeatSnapshot) => s.status !== 'draft';

function staffData(s: SeatSnapshot, seats: Iterable<[string, LiveSeatState]>) {
  return { counts: s.counts, seats: Object.fromEntries(seats) };
}

export function createSeatFeed(opts: SeatFeedOptions): SeatFeed {
  const load = opts.load ?? ((o: string, e: string, c: ChartKey) => loadSeatSnapshot(o, e, new Date(), c));
  const resolveChart = opts.resolveChart ?? chartForDate;
  const keyOf = (o: string, e: string, c: ChartKey) => `${o}:${e}:${c ?? ''}`;
  const coalesceMs = opts.coalesceMs ?? 100;
  const minIntervalMs = opts.minIntervalMs ?? 500;
  const graceMs = opts.graceMs ?? 60_000;
  const bufferSize = opts.bufferSize ?? 200;
  const clock = opts.clock ?? Date.now;
  const epoch = opts.epoch ?? Math.random().toString(36).slice(2, 10);
  const entries = new Map<string, Entry>();
  const loading = new Map<string, Promise<Entry | null>>();
  let seq = 0;
  const idOf = (n: number) => `${epoch}-${n}`;

  async function flush(e: Entry): Promise<void> {
    e.timer = null;
    e.flushing = true;
    e.dirty = false;
    try {
      const next = await load(e.orgId, e.eventId, e.chart);
      if (entries.get(keyOf(e.orgId, e.eventId, e.chart)) === e) await publishChanges(e, next);
    } catch (err) {
      console.warn(`seat feed ${e.eventId}: ${(err as Error).message}`);
    } finally {
      e.flushing = false;
      e.lastFlushAt = clock();
      if (e.dirty) schedule(e);
    }
  }

  function schedule(e: Entry): void {
    if (e.flushing) {
      e.dirty = true;
      return;
    }
    if (e.timer) return;
    const wait = Math.max(coalesceMs, e.lastFlushAt + minIntervalMs - clock());
    e.timer = unref(setTimeout(() => void flush(e), wait));
  }

  async function publishChanges(e: Entry, next: SeatSnapshot | null): Promise<void> {
    const prev = e.base;
    e.base = next;
    if (!prev && !next) return;
    const n = seq + 1;
    const id = idOf(n);
    let pub: RealtimeMessage | undefined;
    let staff: RealtimeMessage | undefined;
    // The map itself changed (seats priced or repriced, or it went on sale): buyers reload it.
    // Locking at the first sale changes nothing for them.
    if (!prev || !next || prev.pricing !== next.pricing || onSale(prev) !== onSale(next))
      pub = { id, event: 'refresh', data: {} };
    else {
      const changed = changedEntries(prev.available, next.available);
      if (changed.length) pub = { id, event: 'delta', data: availabilityLists(changed) };
    }
    if (!next) staff = { id, event: 'refresh', data: {} };
    else if (!prev || !sameKeys(prev.states, next.states))
      staff = { id, event: 'snapshot', data: staffData(next, next.states) };
    else {
      const changed = changedEntries(prev.states, next.states);
      if (changed.length) staff = { id, event: 'delta', data: staffData(next, changed) };
    }
    if (!pub && !staff) return;
    seq = n;
    e.seq = n;
    e.buffer.push({ seq: n, public: pub, staff });
    while (e.buffer.length > bufferSize) e.trimmedThrough = e.buffer.shift()?.seq ?? e.trimmedThrough;
    if (pub) await opts.publisher.publish(e.channels.public, pub);
    if (staff) await opts.publisher.publish(e.channels.staff, staff);
  }

  function snapshotOf(e: Entry, kind: SeatStreamKind): RealtimeMessage {
    const id = idOf(e.seq);
    if (!e.base) return { id, event: 'refresh', data: {} };
    return kind === 'public'
      ? { id, event: 'snapshot', data: availabilityLists(e.base.available) }
      : { id, event: 'snapshot', data: staffData(e.base, e.base.states) };
  }

  function watchOf(e: Entry): SeatWatch {
    let released = false;
    return {
      channels: e.channels,
      isPublic: Boolean(e.base && onSale(e.base) && e.base.available.size > 0),
      catchUp(kind, lastEventId) {
        const m = /^([a-z0-9]+)-(\d+)$/.exec(lastEventId ?? '');
        const last = m?.[1] === epoch ? Number(m[2]) : Number.NaN;
        // Unknown id (another server, a restart, too old): the whole state again.
        if (!Number.isFinite(last) || last > e.seq || last < e.trimmedThrough) return [snapshotOf(e, kind)];
        return e.buffer.flatMap((b) => {
          const msg = b.seq > last ? (kind === 'public' ? b.public : b.staff) : undefined;
          return msg ? [msg] : [];
        });
      },
      release() {
        if (released) return;
        released = true;
        e.refs -= 1;
        if (e.refs > 0) return;
        e.drop = unref(
          setTimeout(() => {
            if (e.refs > 0) return;
            if (e.timer) clearTimeout(e.timer);
            entries.delete(keyOf(e.orgId, e.eventId, e.chart));
          }, graceMs),
        );
      },
    };
  }

  async function open(orgId: string, eventId: string, chart: ChartKey): Promise<Entry | null> {
    const base = await load(orgId, eventId, chart);
    if (!base) return null;
    // A fresh id for the state read now: ids from before (another entry) never replay into it.
    seq += 1;
    const e: Entry = {
      orgId,
      eventId,
      chart,
      channels: seatChannels(orgId, eventId, chart),
      base,
      seq,
      trimmedThrough: seq,
      buffer: [],
      refs: 0,
      timer: null,
      drop: null,
      flushing: false,
      dirty: false,
      lastFlushAt: clock(),
    };
    entries.set(keyOf(orgId, eventId, chart), e);
    // A change committed while the first read ran would be missed: read once more shortly.
    schedule(e);
    return e;
  }

  const poll = opts.pollMs
    ? unref(
        setInterval(() => {
          for (const e of entries.values()) if (e.refs > 0) schedule(e);
        }, opts.pollMs),
      )
    : null;

  return {
    epoch,
    async watch(orgId, eventId, occurrenceId) {
      const chart = occurrenceId ? await resolveChart(orgId, eventId, occurrenceId) : null;
      const key = keyOf(orgId, eventId, chart);
      let e = entries.get(key) ?? null;
      if (!e) {
        let pending = loading.get(key);
        if (!pending) {
          pending = open(orgId, eventId, chart).finally(() => loading.delete(key));
          loading.set(key, pending);
        }
        e = await pending;
      }
      if (!e) return null;
      e.refs += 1;
      if (e.drop) {
        clearTimeout(e.drop);
        e.drop = null;
      }
      return watchOf(e);
    },
    notify(payload) {
      const m = PAYLOAD.exec(payload);
      if (!m) return;
      // Every watched chart of the event (the notification names the event, not the chart).
      const prefix = `${m[1]}:${m[2]}:`;
      for (const [k, e] of entries) if (k.startsWith(prefix)) schedule(e);
    },
    resync() {
      for (const e of entries.values()) schedule(e);
    },
    watching: () => [...entries.values()].filter((e) => e.refs > 0).length,
    close() {
      if (poll) clearInterval(poll);
      for (const e of entries.values()) {
        if (e.timer) clearTimeout(e.timer);
        if (e.drop) clearTimeout(e.drop);
      }
      entries.clear();
    },
  };
}

/** Feed the seat feed from Postgres notifications (one LISTEN connection per process). */
export function listenForSeatChanges(feed: SeatFeed): Promise<Listener> {
  return listenChannel(
    SEAT_NOTIFY_CHANNEL,
    (payload) => feed.notify(payload),
    () => feed.resync(),
  );
}
