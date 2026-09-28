import { addGuestCommand, removeGuestCommand } from '@yayatoh/attendees';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { buildRoundTable, buildRow } from '@yayatoh/floorplan';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  completeRefundCommand,
  orderDetailQuery,
  startCheckoutCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import { consumeEvent } from '@yayatoh/platform';
import {
  assignSeatCategoryCommand,
  assignSeatsCommand,
  blockSeatsCommand,
  eventSeatingQuery,
  holdSeatsTx,
  publicSeatMap,
  publishEventLayoutCommand,
  releaseCancelledSeats,
  seatAssignmentsQuery,
  setEventLayoutCommand,
  unassignSeatsCommand,
} from '@yayatoh/seating';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let stalls: string;
let standing: string;
const row = buildRow({ label: 'R', count: 6, x: 100, y: 100 });
const table = buildRoundTable({ label: '1', seats: 4, x: 600, y: 600 });
const table2 = buildRoundTable({ label: '2', seats: 4, x: 1200, y: 600 });
const doc = { version: 1, width: 1600, height: 1000, items: [row, table, table2] };
const rowSeat = (i: number) => row.seats[i]?.id ?? '';
const tSeat = (i: number) => table.seats[i]?.id ?? '';
const guests: Record<string, string> = {};

const assign = (attendeeIds: string[], itemId: string, seatUuid?: string, ctx = a.ctx()) =>
  executeCommand(assignSeatsCommand, { eventId, attendeeIds, itemId, seatUuid }, ctx, ports);
const unassign = (attendeeIds: string[]) =>
  executeCommand(unassignSeatsCommand, { eventId, attendeeIds }, a.ctx(), ports);
const view = async () => {
  const v = await executeQuery(seatAssignmentsQuery, { eventId }, a.ctx(), ports);
  if (!v) throw new Error('no view');
  return v;
};
const itemOf = async (id: string) => (await view()).items.find((i) => i.id === id);
const peopleAt = async (id: string) =>
  ((await itemOf(id))?.seats ?? []).flatMap((s) => (s.person ? [s.person.name] : [])).sort();
const seatStatus = async (seatUuid: string) =>
  (await executeQuery(eventSeatingQuery, { eventId }, a.ctx(), ports))?.seats.find(
    (s) => s.seatUuid === seatUuid,
  )?.status;
const blockReason = async (seatUuid: string) =>
  (
    await withTenant(a.ctx(), (tx) =>
      tx.execute<{ block_reason: string | null }>(
        sql`select block_reason from seating.event_seats where event_id = ${eventId} and seat_uuid = ${seatUuid}`,
      ),
    )
  )[0]?.block_reason ?? null;

async function buy(opts: { seats?: string[]; standing?: number; who: string }) {
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: opts.standing ? [{ ticketTypeId: standing, quantity: opts.standing }] : [],
      seats: opts.seats ?? [],
      buyer: { email: `${opts.who.toLowerCase().replace(/\W+/g, '.')}@example.test`, name: opts.who },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  const pi = `fakepi_assign_${r.order.id}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId: r.order.id, provider: 'fake', providerPaymentId: pi },
    createCtx({ orgId: a.org.id }),
    ports,
  );
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
  const detail = await executeQuery(orderDetailQuery, { orderId: r.order.id }, a.ctx(), ports);
  const [attendee] = await withTenant(a.ctx(), (tx) =>
    tx.execute<{ id: string }>(
      sql`select id from attendees.attendees where ticket_id = ${detail.tickets[0]?.id ?? ''}`,
    ),
  );
  return { orderId: r.order.id, ticketId: detail.tickets[0]?.id ?? '', attendeeId: attendee?.id ?? '' };
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: 'Assigned gala',
        timezone: 'UTC',
        startsAt: '2028-10-01T18:00:00Z',
        endsAt: '2028-10-01T23:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
  stalls = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'Stalls', priceMinor: 3000, quantityTotal: 6 },
      a.ctx(),
      ports,
    )
  ).id;
  standing = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'Standing', priceMinor: 1000, quantityTotal: 20 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(setEventLayoutCommand, { eventId, doc }, a.ctx(), ports);
  await executeCommand(
    assignSeatCategoryCommand,
    { eventId, itemIds: [row.id], ticketTypeId: stalls },
    a.ctx(),
    ports,
  );
  await executeCommand(publishEventLayoutCommand, { eventId }, a.ctx(), ports);
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  for (const name of ['Ann', 'Ben', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus'])
    guests[name] = (
      await executeCommand(
        addGuestCommand,
        { eventId, name, email: `${name.toLowerCase()}@assign.test` },
        a.ctx(),
        ports,
      )
    ).id;
});
afterAll(closePools);

const g = (name: string) => guests[name] as string;

describe('seat assignment (M1.7d)', () => {
  it('starts with everyone in the unseated queue and every table empty', async () => {
    const v = await view();
    expect(v.items.map((i) => [i.label, i.kind, i.capacity, i.free])).toEqual([
      ['R', 'row', 6, 6],
      ['1', 'table', 4, 4],
      ['2', 'table', 4, 4],
    ]);
    expect(v.unseated.map((p) => p.name)).toEqual(['Ann', 'Ben', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus']);
    expect(v.seatedCount).toBe(0);
    // Allowlisted: no contact ids, tickets or emails beyond the person's own.
    expect(Object.keys(v.unseated[0] ?? {}).sort()).toEqual(['email', 'id', 'labels', 'name']);
  });

  it('seats a party at a table in one go; their seats are taken off sale', async () => {
    const r = await assign([g('Ann'), g('Ben')], table.id);
    expect(r.itemLabel).toBe('1');
    expect(r.seated.map((s) => s.seatLabel)).toEqual(['Table 1 · 1', 'Table 1 · 2']);
    expect(await peopleAt(table.id)).toEqual(['Ann', 'Ben']);
    const v = await view();
    expect(v.unseated.map((p) => p.name)).not.toContain('Ann');
    expect(v.items.find((i) => i.id === table.id)?.free).toBe(2);
    expect(await seatStatus(tSeat(0))).toBe('blocked');
    expect(await blockReason(tSeat(0))).toBe('assigned');
  });

  it("refuses a group that doesn't fit and says how many would", async () => {
    await expect(assign([g('Cat'), g('Dan'), g('Eve')], table.id)).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'not_enough_seats', fits: 2, asked: 3 },
    });
    // Nothing moved: all or nothing.
    expect(await peopleAt(table.id)).toEqual(['Ann', 'Ben']);
  });

  it('moves someone who is already seated, freeing their old seat', async () => {
    await assign([g('Ben')], table2.id);
    expect(await peopleAt(table.id)).toEqual(['Ann']);
    expect(await peopleAt(table2.id)).toEqual(['Ben']);
    expect(await seatStatus(tSeat(1))).toBe('available');
    // Seating them where they already are changes nothing.
    await assign([g('Ben')], table2.id);
    expect(await peopleAt(table2.id)).toEqual(['Ben']);
  });

  it('a specific seat is for one person, and takes that exact seat', async () => {
    await expect(assign([g('Cat'), g('Dan')], table.id, tSeat(3))).rejects.toMatchObject({
      code: 'validation_failed',
    });
    const r = await assign([g('Cat')], table.id, tSeat(3));
    expect(r.seated[0]?.seatLabel).toBe('Table 1 · 4');
    await expect(assign([g('Dan')], table.id, tSeat(3))).rejects.toMatchObject({
      details: { reason: 'seat_taken' },
    });
  });

  it('someone placed automatically makes room when their seat is chosen for another guest', async () => {
    // Ann was placed automatically at seat 1.
    await assign([g('Dan')], table.id, tSeat(0));
    const t = await itemOf(table.id);
    const who = Object.fromEntries((t?.seats ?? []).map((s) => [s.label, s.person?.name ?? null]));
    expect(who['Table 1 · 1']).toBe('Dan');
    expect(Object.values(who)).toContain('Ann');
    expect(t?.seats.find((s) => s.person?.name === 'Dan')?.person?.pinned).toBe(true);
  });

  it('a seated guest takes a seat off sale: buyers cannot hold it, the public map shows it taken', async () => {
    await assign([g('Eve')], row.id, rowSeat(5));
    const map = await publicSeatMap(a.org.id, eventId);
    expect(map?.seats.find((s) => s.seatUuid === rowSeat(5))?.available).toBe(false);
    await expect(
      withTenant(a.ctx(), (tx) =>
        holdSeatsTx(tx, a.ctx(), {
          eventId,
          seatUuids: [rowSeat(5)],
          holdId: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ),
    ).rejects.toMatchObject({ details: { reason: 'seats_taken' } });
    // Unblocking by hand never frees a guest's seat.
    await executeCommand(
      blockSeatsCommand,
      { eventId, seatUuids: [rowSeat(5)], reason: null },
      a.ctx(),
      ports,
    );
    expect(await blockReason(rowSeat(5))).toBe('assigned');
    // Unseating does: the seat is on sale again.
    expect((await unassign([g('Eve')])).released).toBe(1);
    expect(await seatStatus(rowSeat(5))).toBe('available');
    expect(
      (await publicSeatMap(a.org.id, eventId))?.seats.find((s) => s.seatUuid === rowSeat(5))?.available,
    ).toBe(true);
    expect((await view()).unseated.map((p) => p.name)).toContain('Eve');
  });

  it('never assigns held or sold seats; automatic placement skips them', async () => {
    const holdId = crypto.randomUUID();
    await withTenant(a.ctx(), (tx) =>
      holdSeatsTx(tx, a.ctx(), {
        eventId,
        seatUuids: [rowSeat(0)],
        holdId,
        expiresAt: new Date(Date.now() + 600_000),
      }),
    );
    await expect(assign([g('Fay')], row.id, rowSeat(0))).rejects.toMatchObject({
      details: { reason: 'seat_taken' },
    });
    const bought = await buy({ seats: [rowSeat(1)], who: 'Seat Buyer' });
    await expect(assign([g('Fay')], row.id, rowSeat(1))).rejects.toMatchObject({
      details: { reason: 'seat_taken' },
    });
    const r = await assign([g('Fay')], row.id);
    expect(r.seated[0]?.seatLabel).toBe('Row R · 3');
    // The buyer is seated by their ticket: shown at the row, not in the queue, and not assignable.
    const v = await view();
    const seat1 = v.items.find((i) => i.id === row.id)?.seats.find((s) => s.seatUuid === rowSeat(1));
    expect(seat1).toMatchObject({ state: 'sold', person: { name: 'Seat Buyer', byTicket: true } });
    expect(v.unseated.map((p) => p.name)).not.toContain('Seat Buyer');
    await expect(assign([bought.attendeeId], table2.id)).rejects.toMatchObject({
      details: { reason: 'seated_by_ticket' },
    });
  });

  it('a seat kept back for a channel can be given to a guest, and gets its block back after', async () => {
    await executeCommand(
      blockSeatsCommand,
      { eventId, seatUuids: [rowSeat(4)], reason: 'channel' },
      a.ctx(),
      ports,
    );
    // Not picked automatically…
    expect((await itemOf(row.id))?.seats.find((s) => s.seatUuid === rowSeat(4))?.state).toBe('reserved');
    // …but it can be chosen.
    await assign([g('Gus')], row.id, rowSeat(4));
    expect(await blockReason(rowSeat(4))).toBe('assigned');
    await unassign([g('Gus')]);
    expect(await blockReason(rowSeat(4))).toBe('channel');
    // A killed seat can't be.
    await executeCommand(
      blockSeatsCommand,
      { eventId, seatUuids: [rowSeat(4)], reason: null },
      a.ctx(),
      ports,
    );
    await executeCommand(
      blockSeatsCommand,
      { eventId, seatUuids: [rowSeat(4)], reason: 'kill' },
      a.ctx(),
      ports,
    );
    await expect(assign([g('Gus')], row.id, rowSeat(4))).rejects.toMatchObject({
      details: { reason: 'seat_blocked' },
    });
  });

  it('a refund gives a guest’s assigned seat back', async () => {
    const holder = await buy({ standing: 1, who: 'Standing Sam' });
    await assign([holder.attendeeId], table2.id);
    expect(await peopleAt(table2.id)).toEqual(['Ben', 'Standing Sam']);
    const refund = await executeCommand(
      startRefundCommand,
      { orderId: holder.orderId, reason: 'requested_by_customer', ticketIds: [holder.ticketId] },
      a.ctx(),
      ports,
    );
    await executeCommand(
      completeRefundCommand,
      { refundId: refund.refundId, outcome: 'succeeded', providerRefundId: 'fakere_assign' },
      a.ctx(),
      ports,
    );
    expect(await peopleAt(table2.id)).toEqual(['Ben']);
    expect((await itemOf(table2.id))?.free).toBe(3);
    // A cancelled attendee can't be seated again.
    await expect(assign([holder.attendeeId], table2.id)).rejects.toMatchObject({
      details: { reason: 'attendee_cancelled' },
    });
  });

  it('a guest taken off the list gives their seat back (attendee.cancelled)', async () => {
    const seat = (await assign([g('Gus')], table2.id)).seated[0]?.seatUuid ?? '';
    await executeCommand(removeGuestCommand, { eventId, attendeeId: g('Gus') }, a.ctx(), ports);
    const [evt] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string; payload: unknown }>(
        sql`select id, payload from platform.domain_events where type = 'attendee.cancelled' and aggregate_id = ${g('Gus')}`,
      ),
    );
    expect(evt?.payload).toEqual({ orgId: a.org.id, eventId, attendeeId: g('Gus') });
    const published = {
      id: evt?.id as string,
      orgId: a.org.id,
      type: 'attendee.cancelled',
      version: 1,
      aggregateType: 'attendee',
      aggregateId: g('Gus'),
      payload: evt?.payload,
      logSeq: 1,
    };
    expect(await consumeEvent(releaseCancelledSeats(), published)).toBe(true);
    expect(await consumeEvent(releaseCancelledSeats(), published)).toBe(false);
    expect(await seatStatus(seat)).toBe('available');
    expect(await peopleAt(table2.id)).toEqual(['Ben']);
  });

  it('viewers see the assignments but cannot change them; other orgs see nothing', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    expect(await executeQuery(seatAssignmentsQuery, { eventId }, viewer, ports)).not.toBeNull();
    await expect(assign([g('Eve')], table.id, undefined, viewer)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      executeCommand(unassignSeatsCommand, { eventId, attendeeIds: [g('Ann')] }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await executeQuery(seatAssignmentsQuery, { eventId }, b.ctx(), ports)).toBeNull();
    await expect(assign([g('Eve')], table.id, undefined, b.ctx())).rejects.toMatchObject({
      code: 'not_found',
    });
    const [n] = await withTenant(b.ctx(), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from seating.seat_assignments where event_id = ${eventId}`,
      ),
    );
    expect(n?.n).toBe(0);
  });
});

describe('seat assignment and plan edits (M1.7d)', () => {
  it('keeps guests on seats that still exist, follows moved seats, and unseats the rest', async () => {
    const ev = (
      await executeCommand(
        createEventCommand,
        {
          name: 'Wedding dinner',
          timezone: 'UTC',
          startsAt: '2028-11-01T18:00:00Z',
          endsAt: '2028-11-01T23:00:00Z',
        },
        a.ctx(),
        ports,
      )
    ).id;
    const t1 = buildRoundTable({ label: 'A', seats: 4, x: 400, y: 400 });
    const t2 = buildRoundTable({ label: 'B', seats: 4, x: 900, y: 400 });
    const plan = { version: 1, width: 1400, height: 900, items: [t1, t2] };
    await executeCommand(setEventLayoutCommand, { eventId: ev, doc: plan }, a.ctx(), ports);
    const ids: string[] = [];
    for (const name of ['Hal', 'Ida'])
      ids.push(
        (
          await executeCommand(
            addGuestCommand,
            { eventId: ev, name, email: `${name.toLowerCase()}@edit.test` },
            a.ctx(),
            ports,
          )
        ).id,
      );
    await executeCommand(
      assignSeatsCommand,
      { eventId: ev, attendeeIds: [ids[0] as string], itemId: t1.id },
      a.ctx(),
      ports,
    );
    await executeCommand(
      assignSeatsCommand,
      { eventId: ev, attendeeIds: [ids[1] as string], itemId: t2.id },
      a.ctx(),
      ports,
    );
    // Table A moves (seats keep their ids); table B is replaced by a new one.
    const t3 = buildRoundTable({ label: 'C', seats: 4, x: 900, y: 400 });
    await executeCommand(
      setEventLayoutCommand,
      { eventId: ev, doc: { ...plan, items: [{ ...t1, x: 500 }, t3] } },
      a.ctx(),
      ports,
    );
    const v = await executeQuery(seatAssignmentsQuery, { eventId: ev }, a.ctx(), ports);
    const at = (id: string) =>
      v?.items.find((i) => i.id === id)?.seats.flatMap((s) => (s.person ? [s.person.name] : []));
    expect(at(t1.id)).toEqual(['Hal']);
    expect(at(t3.id)).toEqual([]);
    expect(v?.unseated.map((p) => p.name)).toEqual(['Ida']);
    // Hal's seat stays off sale (a guest's seat: assigned, not blocked); nothing else is blocked.
    const s = await executeQuery(eventSeatingQuery, { eventId: ev }, a.ctx(), ports);
    expect(s?.counts).toMatchObject({ assigned: 1, blocked: 0, available: 7 });
    expect(s?.seats.find((x) => x.state === 'assigned')?.status).toBe('blocked');
  });
});
