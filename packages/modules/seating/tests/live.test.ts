import { memoryRealtimeHub, type RealtimeMessage } from '@yayatoh/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  availabilityLists,
  changedEntries,
  coalesceAvailability,
  type LiveSeatRow,
  type LiveSeatState,
  liveSeatState,
  pricingKey,
  publicAvailability,
  sameKeys,
  seatCounts,
} from '../src/domain/live.ts';
import { createSeatFeed, type SeatSnapshot, seatChannels } from '../src/live.ts';

const ORG = '0190a000-0000-7000-8000-00000000000a';
const OTHER = '0190b000-0000-7000-8000-00000000000b';
const EV = '0190e000-0000-7000-8000-00000000000e';
const S = (n: number) => `0190c000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const row = (n: number, over: Partial<LiveSeatRow> = {}): LiveSeatRow => ({
  seatUuid: S(n),
  status: 'available',
  blockReason: null,
  ticketTypeId: 'tt',
  accessible: false,
  ...over,
});

describe('live seat states (M1.7f)', () => {
  it('a guest’s seat shows as assigned, apart from blocked', () => {
    expect(liveSeatState('blocked', 'assigned')).toBe('assigned');
    expect(liveSeatState('blocked', 'kill')).toBe('blocked');
    expect(liveSeatState('blocked', 'ada')).toBe('blocked');
    expect(liveSeatState('held', null)).toBe('held');
    expect(seatCounts(['available', 'assigned', 'assigned', 'blocked', 'sold', 'held'])).toEqual({
      available: 1,
      held: 1,
      sold: 1,
      assigned: 2,
      blocked: 1,
    });
  });

  it('public availability: priced seats only; kept-back accessible seats are off when enforced', () => {
    const rows = [
      row(1),
      row(2, { status: 'held' }),
      row(3, { ticketTypeId: null }),
      row(4, { accessible: true }),
      row(5, { status: 'blocked', blockReason: 'assigned' }),
    ];
    expect([...publicAvailability(rows, { accessibleKeptBack: false })]).toEqual([
      [S(1), true],
      [S(2), false],
      [S(4), true],
      [S(5), false],
    ]);
    expect(publicAvailability(rows, { accessibleKeptBack: true }).get(S(4))).toBe(false);
  });

  it('the pricing key changes when seats are priced, repriced or taken off sale — not when sold', () => {
    const base = pricingKey([row(1), row(2)]);
    expect(pricingKey([row(2), row(1, { status: 'sold' })])).toBe(base);
    expect(pricingKey([row(1), row(2, { ticketTypeId: 'vip' })])).not.toBe(base);
    expect(pricingKey([row(1), row(2, { ticketTypeId: null })])).not.toBe(base);
    expect(pricingKey([row(1), row(2), row(3)])).not.toBe(base);
  });

  it('diffs, key sets and the wire format', () => {
    const a = new Map([
      ['x', true],
      ['y', false],
    ]);
    const b = new Map([
      ['x', false],
      ['y', false],
      ['z', true],
    ]);
    expect(changedEntries(a, b)).toEqual([
      ['x', false],
      ['z', true],
    ]);
    expect(sameKeys(a, b)).toBe(false);
    expect(sameKeys(a, new Map(a))).toBe(true);
    expect(availabilityLists(b)).toEqual({ on: ['z'], off: ['x', 'y'] });
  });

  it('coalescing a burst: the last word on each seat wins, a seat toggled back ends as it ended', () => {
    expect(
      coalesceAvailability([
        { on: [], off: ['a', 'b'] },
        { on: ['a'], off: ['c'] },
        { on: ['c'], off: ['a'] },
      ]),
    ).toEqual({ on: ['c'], off: ['b', 'a'] });
    expect(coalesceAvailability([])).toEqual({ on: [], off: [] });
  });
});

/** A seat plan held in memory, as the feed would read it from Postgres. */
function fakePlan(n: number) {
  const status = new Map<string, LiveSeatState>(Array.from({ length: n }, (_, i) => [S(i), 'available']));
  let priced = true;
  let reads = 0;
  const snapshot = (): SeatSnapshot => {
    reads++;
    const states = new Map(status);
    return {
      status: 'published',
      available: new Map([...states].map(([k, v]) => [k, priced && v === 'available'])),
      pricing: priced ? 'p1' : 'p2',
      states,
      counts: seatCounts(states.values()),
    };
  };
  return {
    status,
    reprice: () => {
      priced = !priced;
    },
    reads: () => reads,
    load: async (orgId: string, eventId: string) => (orgId === ORG && eventId === EV ? snapshot() : null),
  };
}

describe('seat feed: coalescing, catch-up and isolation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (n = 6) => {
    const plan = fakePlan(n);
    const hub = memoryRealtimeHub();
    const feed = createSeatFeed({
      publisher: hub,
      load: plan.load,
      coalesceMs: 100,
      minIntervalMs: 500,
      graceMs: 1_000,
      epoch: 'ep1',
      clock: () => Date.now(),
    });
    const got: { public: RealtimeMessage[]; staff: RealtimeMessage[] } = { public: [], staff: [] };
    const ch = seatChannels(ORG, EV);
    hub.subscribe(ch.public, (m) => got.public.push(m));
    hub.subscribe(ch.staff, (m) => got.staff.push(m));
    return { plan, hub, feed, got };
  };
  const settle = async (ms = 1_000) => {
    await vi.advanceTimersByTimeAsync(ms);
  };

  it('a burst of changes becomes one message per channel; unchanged reads publish nothing', async () => {
    const { plan, feed, got } = setup();
    const w = await feed.watch(ORG, EV);
    expect(w?.isPublic).toBe(true);
    await settle(); // the re-read right after opening finds nothing new
    expect(got.public).toEqual([]);
    for (let i = 0; i < 4; i++) {
      plan.status.set(S(i), 'held');
      feed.notify(`${ORG}:${EV}`);
    }
    await settle();
    expect(got.public).toHaveLength(1);
    expect(got.public[0]).toMatchObject({ event: 'delta', data: { on: [], off: [S(0), S(1), S(2), S(3)] } });
    expect(got.staff).toHaveLength(1);
    expect(got.staff[0]?.data).toMatchObject({
      counts: { available: 2, held: 4 },
      seats: { [S(0)]: 'held', [S(3)]: 'held' },
    });
    expect(got.public[0]?.id).toBe(got.staff[0]?.id);
    // A held seat sold: nothing changes for buyers, the staff see it.
    plan.status.set(S(0), 'sold');
    feed.notify(`${ORG}:${EV}`);
    await settle();
    expect(got.public).toHaveLength(1);
    expect(got.staff).toHaveLength(2);
    // A notification with nothing new publishes nothing.
    feed.notify(`${ORG}:${EV}`);
    await settle();
    expect(got.staff).toHaveLength(2);
  });

  it('a date with its own chart has its own channels; one notification re-reads every chart of the event', async () => {
    const DATE = '0190d000-0000-7000-8000-00000000000d';
    const plan = fakePlan(3);
    const own = fakePlan(3);
    const hub = memoryRealtimeHub();
    const feed = createSeatFeed({
      publisher: hub,
      load: async (o, e, chart) => (chart === DATE ? own.load(o, e) : plan.load(o, e)),
      resolveChart: async (_o, _e, occ) => (occ === DATE ? DATE : null),
      coalesceMs: 100,
      minIntervalMs: 500,
      epoch: 'ep9',
      clock: () => Date.now(),
    });
    expect(seatChannels(ORG, EV, DATE)).toEqual({
      public: `org:${ORG}:event:${EV}:date:${DATE}:seats`,
      staff: `org:${ORG}:event:${EV}:date:${DATE}:seat-states`,
    });
    const onPlan: RealtimeMessage[] = [];
    const onDate: RealtimeMessage[] = [];
    hub.subscribe(seatChannels(ORG, EV).public, (m) => onPlan.push(m));
    hub.subscribe(seatChannels(ORG, EV, DATE).public, (m) => onDate.push(m));
    const wd = await feed.watch(ORG, EV, DATE);
    // Another date without its own chart joins the event plan's watch.
    const wp = await feed.watch(ORG, EV, '0190d000-0000-7000-8000-0000000000ff');
    expect(wd?.channels.public).toContain(`:date:${DATE}:`);
    expect(wp?.channels).toEqual(seatChannels(ORG, EV));
    expect(feed.watching()).toBe(2);
    await vi.advanceTimersByTimeAsync(1_000);
    own.status.set(S(0), 'sold');
    feed.notify(`${ORG}:${EV}`);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onDate).toHaveLength(1);
    expect(onDate[0]).toMatchObject({ event: 'delta', data: { off: [S(0)] } });
    expect(onPlan).toEqual([]);
    feed.close();
  });

  it('throttles: at most one message per event per interval, however many notifications', async () => {
    const { plan, feed, got } = setup(20);
    await feed.watch(ORG, EV);
    await settle();
    const start = Date.now();
    for (let i = 0; i < 20; i++) {
      plan.status.set(S(i), 'held');
      feed.notify(`${ORG}:${EV}`);
      await vi.advanceTimersByTimeAsync(50);
    }
    await settle();
    const elapsed = Date.now() - start;
    expect(got.public.length).toBeLessThanOrEqual(Math.ceil(elapsed / 500) + 1);
    expect(got.public.length).toBeGreaterThan(1);
    // Every seat ends unavailable exactly as the plan says.
    expect(
      coalesceAvailability(got.public.map((m) => m.data as { on: string[]; off: string[] })).off.sort(),
    ).toEqual(Array.from({ length: 20 }, (_, i) => S(i)).sort());
  });

  it('repricing asks buyers to refresh; the staff get a snapshot when seats come and go', async () => {
    const { plan, feed, got } = setup();
    await feed.watch(ORG, EV);
    await settle();
    plan.reprice();
    feed.notify(`${ORG}:${EV}`);
    await settle();
    expect(got.public.map((m) => m.event)).toEqual(['refresh']);
    plan.status.set(S(99), 'available');
    feed.notify(`${ORG}:${EV}`);
    await settle();
    expect(got.staff.at(-1)?.event).toBe('snapshot');
  });

  it('catch-up: the messages after Last-Event-ID, or a snapshot for unknown, foreign or too-old ids', async () => {
    const { plan, feed } = setup();
    const w = await feed.watch(ORG, EV);
    if (!w) throw new Error('no watch');
    const first = w.catchUp('public', null);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ event: 'snapshot', data: { on: expect.any(Array), off: [] } });
    const lastId = first[0]?.id ?? '';
    await settle();
    plan.status.set(S(1), 'sold');
    feed.notify(`${ORG}:${EV}`);
    await settle();
    plan.status.set(S(2), 'held');
    feed.notify(`${ORG}:${EV}`);
    await settle();
    const replay = w.catchUp('public', lastId);
    expect(replay.map((m) => m.data)).toEqual([
      { on: [], off: [S(1)] },
      { on: [], off: [S(2)] },
    ]);
    expect(w.catchUp('public', replay.at(-1)?.id ?? '')).toEqual([]);
    expect(w.catchUp('staff', lastId)).toHaveLength(2);
    // Another server's id, garbage, or an id from the future: start over from a snapshot.
    for (const id of ['other-3', 'nonsense', 'ep1-999'])
      expect(w.catchUp('public', id).map((m) => m.event)).toEqual(['snapshot']);
    const snap = w.catchUp('public', null)[0];
    expect((snap?.data as { off: string[] } | undefined)?.off.sort()).toEqual([S(1), S(2)].sort());
  });

  it('only a watched event of that org is re-read; other orgs and malformed notifications are ignored', async () => {
    const { plan, feed, got } = setup();
    expect(await feed.watch(OTHER, EV)).toBeNull();
    await feed.watch(ORG, EV);
    await settle();
    const reads = plan.reads();
    plan.status.set(S(0), 'held');
    feed.notify(`${OTHER}:${EV}`);
    feed.notify('garbage');
    feed.notify(`${ORG}:not-a-uuid`);
    await settle();
    expect(plan.reads()).toBe(reads);
    expect(got.public).toEqual([]);
  });

  it('an event nobody watches is forgotten after the grace period; ids never replay across it', async () => {
    const { plan, feed } = setup();
    const w = await feed.watch(ORG, EV);
    if (!w) throw new Error('no watch');
    const id = w.catchUp('public', null)[0]?.id ?? '';
    w.release();
    w.release(); // idempotent
    expect(feed.watching()).toBe(0);
    await settle(2_000);
    plan.status.set(S(0), 'sold');
    const again = await feed.watch(ORG, EV);
    const msgs = again?.catchUp('public', id) ?? [];
    expect(msgs.map((m) => m.event)).toEqual(['snapshot']);
    expect((msgs[0]?.data as { off: string[] } | undefined)?.off).toEqual([S(0)]);
    feed.close();
  });

  it('a watcher that returns within the grace period keeps the event (and its replay)', async () => {
    const { plan, feed } = setup();
    const w1 = await feed.watch(ORG, EV);
    const id = w1?.catchUp('public', null)[0]?.id ?? '';
    await settle();
    w1?.release();
    plan.status.set(S(3), 'held');
    feed.notify(`${ORG}:${EV}`);
    await settle(300);
    const w2 = await feed.watch(ORG, EV);
    await settle();
    expect(w2?.catchUp('public', id).map((m) => m.data)).toEqual([{ on: [], off: [S(3)] }]);
  });

  it('resync re-reads every watched event (after the listener reconnects)', async () => {
    const { plan, feed, got } = setup();
    await feed.watch(ORG, EV);
    await settle();
    plan.status.set(S(5), 'held');
    feed.resync();
    await settle();
    expect(got.public.at(-1)?.data).toEqual({ on: [], off: [S(5)] });
  });

  it('a safety poll catches changes whose notification was missed', async () => {
    const plan = fakePlan(3);
    const hub = memoryRealtimeHub();
    const feed = createSeatFeed({ publisher: hub, load: plan.load, pollMs: 5_000, epoch: 'ep2' });
    const got: RealtimeMessage[] = [];
    hub.subscribe(seatChannels(ORG, EV).public, (m) => got.push(m));
    await feed.watch(ORG, EV);
    await settle();
    plan.status.set(S(2), 'blocked');
    await vi.advanceTimersByTimeAsync(6_000);
    expect(got.at(-1)?.data).toEqual({ on: [], off: [S(2)] });
    feed.close();
  });
});
