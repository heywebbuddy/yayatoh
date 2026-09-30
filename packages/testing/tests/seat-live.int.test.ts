import { addGuestCommand } from '@yayatoh/attendees';
import type { Listener } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { buildRow } from '@yayatoh/floorplan';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  completeRefundCommand,
  expireOrdersCommand,
  orderDetailQuery,
  recordBoxOfficeSaleCommand,
  startCheckoutCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import { memoryRealtimeHub, type RealtimeMessage } from '@yayatoh/platform';
import {
  assignSeatCategoryCommand,
  assignSeatsCommand,
  blockSeatsCommand,
  createSeatFeed,
  listenForSeatChanges,
  publicSeatMap,
  publishEventLayoutCommand,
  type SeatFeed,
  type SeatWatch,
  seatChannels,
  seatingLiveAccessQuery,
  setEventLayoutCommand,
  setSeatingRulesCommand,
  unassignSeatsCommand,
} from '@yayatoh/seating';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/** Event names are unique per run (slugs are global; other suites create similar events). */
const RUN = uuidv7().slice(-8);
let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let tt: string;
let feed: SeatFeed;
let listener: Listener;
let watch: SeatWatch;
const hub = memoryRealtimeHub();
const pub: RealtimeMessage[] = [];
const staff: RealtimeMessage[] = [];
const foreign: RealtimeMessage[] = [];
const row = buildRow({ label: 'L', count: 12, x: 100, y: 100 });
// Seat 12 is an accessible seat.
row.seats[11] = { ...(row.seats[11] as (typeof row.seats)[number]), accessible: true };
const seat = (i: number) => row.seats[i]?.id ?? '';

type Pub = { on: string[]; off: string[] };
type Staff = { counts: Record<string, number>; seats: Record<string, string> };

async function until<T>(what: string, fn: () => T | undefined | null | false, ms = 5_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > ms)
      throw new Error(`timed out waiting for ${what}; last: ${JSON.stringify(pub.slice(-3))}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}
const quiet = (ms = 400) => new Promise((r) => setTimeout(r, ms));

/** The next public message after `from` that says `seatUuid` is on (true) or off (false). */
const publicSays = (from: number, seatUuid: string, available: boolean) =>
  until(`public ${available ? 'on' : 'off'} ${seatUuid}`, () =>
    pub
      .slice(from)
      .find((m) => m.event === 'delta' && (m.data as Pub)[available ? 'on' : 'off'].includes(seatUuid)),
  );
const staffSays = (from: number, seatUuid: string, state: string) =>
  until(`staff ${state} ${seatUuid}`, () =>
    staff.slice(from).find((m) => (m.data as Staff).seats?.[seatUuid] === state),
  );

const checkout = (seats: string[], who: string) =>
  executeCommand(
    startCheckoutCommand,
    { eventId, items: [], seats, buyer: { email: `${who}@live.test`, name: who } },
    createCtx({ orgId: a.org.id }),
    ports,
  );

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: `Live hall ${RUN}`,
        timezone: 'UTC',
        startsAt: '2029-03-01T19:00:00Z',
        endsAt: '2029-03-01T22:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
  tt = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'Hall', priceMinor: 4000, quantityTotal: 50 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(
    setEventLayoutCommand,
    { eventId, doc: { version: 1, width: 1200, height: 400, items: [row] } },
    a.ctx(),
    ports,
  );
  await executeCommand(
    assignSeatCategoryCommand,
    { eventId, itemIds: [row.id], ticketTypeId: tt },
    a.ctx(),
    ports,
  );
  await executeCommand(publishEventLayoutCommand, { eventId }, a.ctx(), ports);
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);

  feed = createSeatFeed({ publisher: hub, coalesceMs: 20, minIntervalMs: 60, epoch: 'itest' });
  listener = await listenForSeatChanges(feed);
  const ch = seatChannels(a.org.id, eventId);
  hub.subscribe(ch.public, (m) => pub.push(m));
  hub.subscribe(ch.staff, (m) => staff.push(m));
  // Org B's channels for the same event id: must never receive anything.
  const other = seatChannels(b.org.id, eventId);
  hub.subscribe(other.public, (m) => foreign.push(m));
  hub.subscribe(other.staff, (m) => foreign.push(m));
  const w = await feed.watch(a.org.id, eventId);
  if (!w) throw new Error('no watch');
  watch = w;
  await quiet(200);
});
afterAll(async () => {
  watch?.release();
  feed?.close();
  await listener?.close();
  await closePools();
});

describe('live seat availability (M1.7f)', () => {
  it('the channels are org-scoped, and the event is public (on sale, priced)', () => {
    expect(watch.channels).toEqual({
      public: `org:${a.org.id}:event:${eventId}:seats`,
      staff: `org:${a.org.id}:event:${eventId}:seat-states`,
    });
    expect(watch.isPublic).toBe(true);
    const [snap] = watch.catchUp('public', null);
    expect(snap?.event).toBe('snapshot');
    expect((snap?.data as Pub | undefined)?.on).toHaveLength(12);
  });

  it('a checkout hold, its payment and a refund each reach the feed (the hold extension does not)', async () => {
    let p = pub.length;
    let s = staff.length;
    const r = await checkout([seat(0)], 'held');
    await publicSays(p, seat(0), false);
    await staffSays(s, seat(0), 'held');
    // Starting payment extends the hold: nothing changes for anyone.
    p = pub.length;
    s = staff.length;
    const pi = `fakepi_live_${r.order.id}`;
    await executeCommand(
      attachPaymentCommand,
      { orderId: r.order.id, provider: 'fake', providerPaymentId: pi },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    await quiet();
    expect(pub.length).toBe(p);
    expect(staff.length).toBe(s);
    await executeCommand(
      applyProviderEventCommand,
      {
        provider: 'fake',
        id: `fakeevt_${pi}`,
        type: 'payment.succeeded',
        providerPaymentId: pi,
        amountMinor: r.order.totalMinor,
        currency: 'USD',
        orgId: a.org.id,
        orderId: r.order.id,
      },
      systemCtx(a.org.id),
      ports,
    );
    // Held → sold: the same for buyers (still taken), a change for the staff.
    const sold = await staffSays(s, seat(0), 'sold');
    expect((sold.data as Staff).counts).toMatchObject({ sold: 1, held: 0 });
    expect(pub.length).toBe(p);
    // A refund voids the ticket and frees the seat.
    s = staff.length;
    const [ticket] = (await executeQuery(orderDetailQuery, { orderId: r.order.id }, a.ctx(), ports)).tickets;
    const refund = await executeCommand(
      startRefundCommand,
      { orderId: r.order.id, reason: 'requested_by_customer', ticketIds: [ticket?.id ?? ''] },
      a.ctx(),
      ports,
    );
    await executeCommand(
      completeRefundCommand,
      { refundId: refund.refundId, outcome: 'succeeded', providerRefundId: 'fakere_live' },
      a.ctx(),
      ports,
    );
    await publicSays(p, seat(0), true);
    await staffSays(s, seat(0), 'available');
  });

  it('an expired checkout frees its seat live (the sweeper)', async () => {
    const p = pub.length;
    await checkout([seat(1)], 'late');
    await publicSays(p, seat(1), false);
    const p2 = pub.length;
    await executeCommand(
      expireOrdersCommand,
      {},
      { ...systemCtx(a.org.id), now: new Date(Date.now() + 60 * 60_000) },
      ports,
    );
    await publicSays(p2, seat(1), true);
  });

  it('blocking, unblocking, seating a guest and unseating them each reach the feed', async () => {
    let p = pub.length;
    let s = staff.length;
    await executeCommand(
      blockSeatsCommand,
      { eventId, seatUuids: [seat(2)], reason: 'kill' },
      a.ctx(),
      ports,
    );
    await publicSays(p, seat(2), false);
    await staffSays(s, seat(2), 'blocked');
    p = pub.length;
    await executeCommand(blockSeatsCommand, { eventId, seatUuids: [seat(2)], reason: null }, a.ctx(), ports);
    await publicSays(p, seat(2), true);

    const guest = await executeCommand(
      addGuestCommand,
      { eventId, name: 'Live Guest', email: 'live.guest@live.test' },
      a.ctx(),
      ports,
    );
    p = pub.length;
    s = staff.length;
    await executeCommand(
      assignSeatsCommand,
      { eventId, attendeeIds: [guest.id], itemId: row.id, seatUuid: seat(3) },
      a.ctx(),
      ports,
    );
    await publicSays(p, seat(3), false);
    const assigned = await staffSays(s, seat(3), 'assigned');
    // The staff see a guest's seat as assigned, not blocked.
    expect((assigned.data as Staff).counts).toMatchObject({ assigned: 1, blocked: 0 });
    p = pub.length;
    await executeCommand(unassignSeatsCommand, { eventId, attendeeIds: [guest.id] }, a.ctx(), ports);
    await publicSays(p, seat(3), true);
  });

  it('a box office sale of a chosen seat reaches the feed', async () => {
    const p = pub.length;
    const s = staff.length;
    await executeCommand(
      recordBoxOfficeSaleCommand,
      { eventId, seats: [seat(4)], buyer: { email: 'door@live.test', name: 'Door' }, method: 'cash' },
      a.ctx(),
      ports,
    );
    await publicSays(p, seat(4), false);
    await staffSays(s, seat(4), 'sold');
  });

  it('a hold that rolls back publishes nothing (notifications are sent on commit only)', async () => {
    const p = pub.length;
    // Seat 4 is sold: the whole checkout fails, so seat 5 was never held as far as anyone knows.
    await expect(checkout([seat(5), seat(4)], 'loser')).rejects.toMatchObject({
      details: { reason: 'seats_taken' },
    });
    await quiet();
    expect(pub.slice(p).some((m) => JSON.stringify(m.data).includes(seat(5)))).toBe(false);
  });

  it('a burst of holds becomes at most a couple of messages, and ends in the right state', async () => {
    const p = pub.length;
    const ids = [5, 6, 7, 8, 9].map(seat);
    await Promise.all(ids.map((id, i) => checkout([id], `burst${i}`)));
    await until('every burst seat off', () => {
      const offs = new Set(pub.slice(p).flatMap((m) => (m.data as Pub).off ?? []));
      return ids.every((id) => offs.has(id));
    });
    expect(pub.length - p).toBeLessThanOrEqual(3);
  });

  it('pricing a seat differently or taking it off sale asks buyers to refresh the map', async () => {
    const p = pub.length;
    await executeCommand(
      assignSeatCategoryCommand,
      { eventId, seatUuids: [seat(10)], ticketTypeId: null },
      a.ctx(),
      ports,
    );
    await until('refresh', () => pub.slice(p).find((m) => m.event === 'refresh'));
    const p2 = pub.length;
    await executeCommand(
      assignSeatCategoryCommand,
      { eventId, seatUuids: [seat(10)], ticketTypeId: tt },
      a.ctx(),
      ports,
    );
    await until('refresh again', () => pub.slice(p2).find((m) => m.event === 'refresh'));
  });

  it('an enforced accessibility rule takes kept-back accessible seats off sale online, live; warn gives them back', async () => {
    let p = pub.length;
    await executeCommand(
      setSeatingRulesCommand,
      { eventId, rules: [{ kind: 'ada_reserved', severity: 'enforce', params: { releaseDays: 3 } }] },
      a.ctx(),
      ports,
    );
    await publicSays(p, seat(11), false);
    expect(
      (await publicSeatMap(a.org.id, eventId))?.seats.find((s) => s.seatUuid === seat(11))?.available,
    ).toBe(false);
    p = pub.length;
    await executeCommand(
      setSeatingRulesCommand,
      { eventId, rules: [{ kind: 'ada_reserved', severity: 'warn', params: { releaseDays: 3 } }] },
      a.ctx(),
      ports,
    );
    await publicSays(p, seat(11), true);
    await executeCommand(setSeatingRulesCommand, { eventId, rules: [] }, a.ctx(), ports);
  });

  it('a reconnecting client gets what it missed after its Last-Event-ID, or a snapshot', async () => {
    const [snap] = watch.catchUp('public', null);
    const last = snap?.id ?? '';
    const p = pub.length;
    await executeCommand(
      blockSeatsCommand,
      { eventId, seatUuids: [seat(10)], reason: 'channel' },
      a.ctx(),
      ports,
    );
    await publicSays(p, seat(10), false);
    const missed = watch.catchUp('public', last);
    expect(missed.map((m) => m.data)).toEqual([{ on: [], off: [seat(10)] }]);
    expect(watch.catchUp('public', 'another-server-7').map((m) => m.event)).toEqual(['snapshot']);
    await executeCommand(blockSeatsCommand, { eventId, seatUuids: [seat(10)], reason: null }, a.ctx(), ports);
  });

  it('putting a plan on sale (no seat changes) wakes the feed: buyers may then watch it', async () => {
    const ev = (
      await executeCommand(
        createEventCommand,
        {
          name: `Later hall ${RUN}`,
          timezone: 'UTC',
          startsAt: '2029-03-02T19:00:00Z',
          endsAt: '2029-03-02T22:00:00Z',
        },
        a.ctx(),
        ports,
      )
    ).id;
    const r2 = buildRow({ label: 'M', count: 3, x: 100, y: 100 });
    await executeCommand(
      setEventLayoutCommand,
      { eventId: ev, doc: { version: 1, width: 600, height: 300, items: [r2] } },
      a.ctx(),
      ports,
    );
    await executeCommand(
      assignSeatCategoryCommand,
      { eventId: ev, itemIds: [r2.id], ticketTypeId: tt },
      a.ctx(),
      ports,
    );
    const staffWatch = await feed.watch(a.org.id, ev);
    expect(staffWatch?.isPublic).toBe(false);
    const got: RealtimeMessage[] = [];
    const off = hub.subscribe(seatChannels(a.org.id, ev).public, (m) => got.push(m));
    await executeCommand(publishEventLayoutCommand, { eventId: ev }, a.ctx(), ports);
    await until('refresh on publish', () => got.find((m) => m.event === 'refresh'));
    const buyerWatch = await feed.watch(a.org.id, ev);
    expect(buyerWatch?.isPublic).toBe(true);
    off();
    staffWatch?.release();
    buyerWatch?.release();
  });

  it('no cross-org attach: another org cannot watch, open or receive this event’s stream', async () => {
    // Watching reads under the named org's RLS: org B sees no floor plan for org A's event.
    expect(await feed.watch(b.org.id, eventId)).toBeNull();
    expect(foreign).toEqual([]);
    // The organizer stream: members who may read events, of this org only.
    await expect(executeQuery(seatingLiveAccessQuery, { eventId }, a.ctx(), ports)).resolves.toEqual({
      eventId,
    });
    await expect(
      executeQuery(seatingLiveAccessQuery, { eventId }, userCtx(a.viewerId, a.org.id), ports),
    ).resolves.toEqual({ eventId });
    await expect(executeQuery(seatingLiveAccessQuery, { eventId }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      executeQuery(seatingLiveAccessQuery, { eventId }, userCtx(b.ownerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Anonymous visitors don't get the organizer stream.
    await expect(
      executeQuery(seatingLiveAccessQuery, { eventId }, createCtx({ orgId: a.org.id }), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
