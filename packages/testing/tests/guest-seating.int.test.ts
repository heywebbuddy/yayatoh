import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, type EventDto } from '@yayatoh/events';
import { type FloorplanDoc, quickLayout } from '@yayatoh/floorplan';
import {
  addPartyGuestCommand,
  addPlusOneCommand,
  createPartyCommand,
  createSubEventCommand,
  recordSubEventResponseCommand,
  removePartyGuestCommand,
  setInvitationsCommand,
  updatePartyGuestCommand,
} from '@yayatoh/guests';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  guestSeatingQuery,
  seatGuestsCommand,
  setEventLayoutCommand,
  setVipTableCommand,
  unseatGuestsCommand,
} from '@yayatoh/seating';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M4.3a guest seating: parties to tables all or nothing ("can't fit"), VIP zone warnings, the
 * queue fed by RSVP (declined guests leave it), a sub-event's chart seated apart, and the live
 * channels: a plus-one change is published on the event's guest channel in its transaction.
 */

let admin: AdminSql;
let a: OrgFixture;
let b: OrgFixture;

const wedding = (f: OrgFixture, name: string) =>
  executeCommand(
    createEventCommand,
    {
      name: `${name} ${f.org.slug}`,
      profile: 'wedding',
      timezone: 'America/Chicago',
      startsAt: '2030-06-01T20:00:00Z',
      endsAt: '2030-06-02T04:00:00Z',
    },
    f.ctx(),
    ports,
  );

/** Two round tables ("1", "2") of `seats` each, no stage. */
async function plan(
  f: OrgFixture,
  ev: EventDto,
  seats = 4,
): Promise<{ t1: string; t2: string; doc: FloorplanDoc }> {
  const doc = quickLayout({ rows: 0, seatsPerRow: 1, tables: 2, seatsPerTable: seats, stage: false });
  await executeCommand(setEventLayoutCommand, { eventId: ev.id, doc }, f.ctx(), ports);
  const [t1, t2] = doc.items.map((i) => i.id);
  return { t1: t1 ?? '', t2: t2 ?? '', doc: doc as FloorplanDoc };
}

/** Garcia (VIP: Luis, his plus-one, Ana) and Chen (Mei, Jun). */
async function guestList(f: OrgFixture, ev: EventDto) {
  const garcia = await executeCommand(
    createPartyCommand,
    { eventId: ev.id, name: 'Garcia', side: 'Bride', vip: true },
    f.ctx(),
    ports,
  );
  const chen = await executeCommand(
    createPartyCommand,
    { eventId: ev.id, name: 'Chen', side: 'Groom' },
    f.ctx(),
    ports,
  );
  const add = (partyId: string, firstName: string) =>
    executeCommand(
      addPartyGuestCommand,
      { eventId: ev.id, partyId, firstName, lastName: 'X' },
      f.ctx(),
      ports,
    );
  const luis = await add(garcia.id, 'Luis');
  const plus = await executeCommand(
    addPlusOneCommand,
    { eventId: ev.id, hostGuestId: luis.id },
    f.ctx(),
    ports,
  );
  const ana = await add(garcia.id, 'Ana');
  const mei = await add(chen.id, 'Mei');
  const jun = await add(chen.id, 'Jun');
  return { garcia, chen, luis, plus, ana, mei, jun };
}

const view = (f: OrgFixture, eventId: string, subEventId: string | null = null, ctx = f.ctx()) =>
  executeQuery(guestSeatingQuery, { eventId, subEventId }, ctx, ports);

const seat = (
  f: OrgFixture,
  eventId: string,
  itemId: string,
  guestIds: string[],
  subEventId: string | null = null,
  ctx = f.ctx(),
) => executeCommand(seatGuestsCommand, { eventId, subEventId, itemId, guestIds }, ctx, ports);

const placeOf = async (f: OrgFixture, eventId: string, subEventId: string | null = null) => {
  const v = await view(f, eventId, subEventId);
  return new Map(v.parties.flatMap((p) => p.guests.map((g) => [g.id, g.itemId] as const)));
};

const messages = (channel: string) =>
  admin<{ event: string; data: Record<string, unknown> }[]>`
    select event, data from platform.realtime_messages where channel = ${channel} order by seq`;

beforeAll(async () => {
  admin = adminClient();
  ({ a, b } = await twoOrgs());
});

afterAll(async () => {
  await closePools();
  await admin.end();
});

describe('guest seating (M4.3a)', () => {
  it('seats a whole party at a table, plus-one included, and shows who sits where', async () => {
    const ev = await wedding(a, 'Seat party');
    const { t1, t2 } = await plan(a, ev);
    const g = await guestList(a, ev);
    const before = await view(a, ev.id);
    expect(before.source).toBe('event');
    expect(before.places.map((p) => [p.label, p.kind, p.capacity, p.free])).toEqual([
      ['1', 'table', 4, 4],
      ['2', 'table', 4, 4],
    ]);
    expect(before.parties.map((p) => [p.name, p.guests.length])).toEqual([
      ['Chen', 2],
      ['Garcia', 3],
    ]);
    // The plus-one comes after their host, shown as "Guest of …" until named.
    const garcia = before.parties.find((p) => p.name === 'Garcia');
    expect(garcia?.guests.map((x) => [x.name, x.guestOf, x.kind])).toEqual([
      ['Luis X', null, 'guest'],
      [null, 'Luis X', 'plus_one'],
      ['Ana X', null, 'guest'],
    ]);
    expect(before.counts).toEqual({ guests: 5, seated: 0, unseated: 5, declinedSeated: 0 });

    const r = await seat(a, ev.id, t1, [g.luis.id, g.plus.id, g.ana.id]);
    expect(r.seated).toBe(3);
    const after = await view(a, ev.id);
    expect(after.places.find((p) => p.itemId === t1)).toMatchObject({ seated: 3, free: 1 });
    expect(after.places.find((p) => p.itemId === t2)).toMatchObject({ seated: 0, free: 4 });
    expect(after.counts).toEqual({ guests: 5, seated: 3, unseated: 2, declinedSeated: 0 });
    const audit = await admin<{ data: Record<string, unknown> }[]>`
      select data from platform.audit_events where action = 'seating.guests.seat' and target_id = ${ev.id}`;
    expect(audit.map((x) => x.data)).toEqual([{ subEventId: null, itemId: t1, count: 3 }]);
  });

  it("refuses a party that can't fit and changes nothing, saying how many fit", async () => {
    const ev = await wedding(a, 'Cant fit');
    const { t1 } = await plan(a, ev, 4);
    const g = await guestList(a, ev);
    await seat(a, ev.id, t1, [g.luis.id, g.plus.id, g.ana.id]);
    await expect(seat(a, ev.id, t1, [g.mei.id, g.jun.id])).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'cant_fit', asked: 2, fits: 1 },
    });
    const places = await placeOf(a, ev.id);
    expect(places.get(g.mei.id)).toBeNull();
    expect(places.get(g.jun.id)).toBeNull();
    // One of them fits.
    expect((await seat(a, ev.id, t1, [g.mei.id])).seated).toBe(1);
    // Re-dropping a party where it already sits needs no seats.
    expect((await seat(a, ev.id, t1, [g.luis.id, g.plus.id, g.ana.id])).seated).toBe(0);
  });

  it('moves guests between tables and unseats them back to the queue', async () => {
    const ev = await wedding(a, 'Move');
    const { t1, t2 } = await plan(a, ev, 2);
    const g = await guestList(a, ev);
    await seat(a, ev.id, t1, [g.mei.id, g.jun.id]);
    // Table 1 is full, but Jun moving within it is no new seat; moving to table 2 frees one.
    await seat(a, ev.id, t2, [g.jun.id]);
    let places = await placeOf(a, ev.id);
    expect([places.get(g.mei.id), places.get(g.jun.id)]).toEqual([t1, t2]);
    expect((await seat(a, ev.id, t1, [g.ana.id])).seated).toBe(1);
    const r = await executeCommand(
      unseatGuestsCommand,
      { eventId: ev.id, subEventId: null, guestIds: [g.mei.id, g.luis.id] },
      a.ctx(),
      ports,
    );
    expect(r.unseated).toBe(1);
    places = await placeOf(a, ev.id);
    expect(places.get(g.mei.id)).toBeNull();
  });

  it('refuses unknown places and guests of another event', async () => {
    const ev = await wedding(a, 'Refuse');
    const other = await wedding(a, 'Other');
    const { t1 } = await plan(a, ev);
    await plan(a, other);
    const g = await guestList(a, ev);
    const o = await guestList(a, other);
    await expect(seat(a, ev.id, o.mei.id, [g.mei.id])).rejects.toMatchObject({
      details: { reason: 'not_a_place' },
    });
    await expect(seat(a, ev.id, t1, [o.mei.id])).rejects.toMatchObject({
      code: 'not_found',
      details: { reason: 'unknown_guest' },
    });
    // No plan: nothing to seat at.
    const bare = await wedding(a, 'No plan');
    const bg = await guestList(a, bare);
    expect((await view(a, bare.id)).source).toBe('none');
    await expect(seat(a, bare.id, t1, [bg.mei.id])).rejects.toMatchObject({ details: { reason: 'no_plan' } });
  });

  it('warns about VIP zones (host-marked tables), never refuses', async () => {
    const ev = await wedding(a, 'VIP');
    const { t1, t2 } = await plan(a, ev);
    const g = await guestList(a, ev);
    await executeCommand(setVipTableCommand, { eventId: ev.id, itemId: t1, vip: true }, a.ctx(), ports);
    expect((await view(a, ev.id)).places.map((p) => p.vip)).toEqual([true, false]);
    const chen = await seat(a, ev.id, t1, [g.mei.id]);
    expect(chen.warnings).toEqual([{ partyId: g.chen.id, kind: 'not_vip_inside' }]);
    const garcia = await seat(a, ev.id, t2, [g.luis.id, g.plus.id]);
    expect(garcia.warnings).toEqual([{ partyId: g.garcia.id, kind: 'vip_outside' }]);
    expect((await seat(a, ev.id, t1, [g.ana.id])).warnings).toEqual([]);
    await executeCommand(setVipTableCommand, { eventId: ev.id, itemId: t1, vip: false }, a.ctx(), ports);
    expect((await view(a, ev.id)).places.map((p) => p.vip)).toEqual([false, false]);
  });

  it('treats a VIP section of the plan as a VIP zone', async () => {
    const ev = await wedding(a, 'VIP section');
    const doc = quickLayout({ rows: 0, seatsPerRow: 1, tables: 1, seatsPerTable: 4, stage: false });
    const section = '0199a000-0000-7000-8000-000000000001';
    const withSection = {
      ...doc,
      sections: [{ id: section, label: 'Head', vip: true }],
      items: doc.items.map((i) => ({ ...i, sectionId: section })),
    };
    await executeCommand(setEventLayoutCommand, { eventId: ev.id, doc: withSection }, a.ctx(), ports);
    const v = await view(a, ev.id);
    expect(v.places.map((p) => [p.vip, p.sectionVip])).toEqual([[true, true]]);
  });

  it('seats a sub-event on its own: only its invited guests, declined ones refused and flagged', async () => {
    const ev = await wedding(a, 'Reception');
    const { t1 } = await plan(a, ev);
    const g = await guestList(a, ev);
    const reception = await executeCommand(
      createSubEventCommand,
      {
        eventId: ev.id,
        name: 'Reception',
        kind: 'reception',
        startsAt: '2030-06-01T22:00:00Z',
        endsAt: '2030-06-02T02:00:00Z',
      },
      a.ctx(),
      ports,
    );
    await executeCommand(
      setInvitationsCommand,
      {
        eventId: ev.id,
        subEventIds: [reception.id],
        target: { kind: 'guests', guestIds: [g.luis.id, g.mei.id] },
        invited: true,
      },
      a.ctx(),
      ports,
    );
    const respond = (guestId: string, status: 'attending' | 'declined') =>
      executeCommand(
        recordSubEventResponseCommand,
        { eventId: ev.id, guestId, subEventId: reception.id, status, source: 'paper' },
        a.ctx(),
        ports,
      );
    await respond(g.luis.id, 'attending');
    await respond(g.mei.id, 'declined');
    const v = await view(a, ev.id, reception.id);
    // The reception uses the event plan (no chart of its own); its queue is the invited guests.
    expect(v.source).toBe('event');
    expect(v.subEvents.map((s) => s.name)).toEqual(['Reception']);
    expect(v.parties.flatMap((p) => p.guests.map((x) => [x.name ?? `+${x.guestOf}`, x.status]))).toEqual([
      ['Mei X', 'declined'],
      ['Luis X', 'attending'],
      ['+Luis X', 'pending'],
    ]);
    await expect(seat(a, ev.id, t1, [g.ana.id], reception.id)).rejects.toMatchObject({
      details: { reason: 'unknown_guest' },
    });
    await expect(seat(a, ev.id, t1, [g.mei.id], reception.id)).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'declined' },
    });
    await seat(a, ev.id, t1, [g.luis.id, g.plus.id], reception.id);
    // Seated at the reception, still in the queue of the event plan (a separate chart).
    expect((await placeOf(a, ev.id)).get(g.luis.id)).toBeNull();
    expect((await placeOf(a, ev.id, reception.id)).get(g.luis.id)).toBe(t1);
    // Luis declines afterwards: still seated, flagged for the host.
    await respond(g.luis.id, 'declined');
    expect((await view(a, ev.id, reception.id)).counts).toMatchObject({ seated: 1, declinedSeated: 1 });
    // On the event plan, someone who declined every sub-event they're invited to is declined.
    const whole = await view(a, ev.id);
    const status = new Map(whole.parties.flatMap((p) => p.guests.map((x) => [x.id, x.status] as const)));
    expect([status.get(g.luis.id), status.get(g.plus.id), status.get(g.ana.id)]).toEqual([
      'declined',
      'pending',
      'pending',
    ]);
  });

  it('a removed guest loses their place; a table the plan loses sends its guests back to the queue', async () => {
    const ev = await wedding(a, 'Cascade');
    const { t1, t2, doc } = await plan(a, ev);
    const g = await guestList(a, ev);
    await seat(a, ev.id, t1, [g.mei.id, g.jun.id]);
    await seat(a, ev.id, t2, [g.ana.id]);
    await executeCommand(removePartyGuestCommand, { eventId: ev.id, guestId: g.jun.id }, a.ctx(), ports);
    const [n] = await admin<{ n: number }[]>`
      select count(*)::int as n from seating.guest_seats where event_id = ${ev.id} and guest_id = ${g.jun.id}`;
    expect(n?.n).toBe(0);
    // Table 2 leaves the plan: Ana is back in the queue (her stale place is ignored).
    await executeCommand(
      setEventLayoutCommand,
      { eventId: ev.id, doc: { ...doc, items: doc.items.filter((i) => i.id !== t2) } },
      a.ctx(),
      ports,
    );
    const places = await placeOf(a, ev.id);
    expect(places.get(g.ana.id)).toBeNull();
    expect(places.get(g.mei.id)).toBe(t1);
    // And can be seated again (the stale row is replaced).
    expect((await seat(a, ev.id, t1, [g.ana.id])).seated).toBe(1);
  });

  it('counts seats tickets and attendee seating hold on the event plan as taken', async () => {
    // The fixture event's plan: row A of 4 seats, with a held seat and a seated attendee.
    const v = await view(a, a.event.id);
    const row = v.places.find((p) => p.label === 'A');
    const [held] = await admin<{ n: number }[]>`
      select count(*)::int as n from seating.event_seats
      where event_id = ${a.event.id} and occurrence_id is null and item_id = ${row?.itemId ?? null}
        and (status in ('sold', 'held') or block_reason in ('assigned', 'kill'))`;
    expect(held?.n).toBeGreaterThan(0);
    expect(row).toMatchObject({ kind: 'row', capacity: 4, taken: held?.n });
    expect(row?.free).toBe(4 - (held?.n ?? 0) - (row?.seated ?? 0));
  });

  it('publishes a plus-one change on the guest channel in its transaction (and nothing when refused)', async () => {
    const ev = await wedding(a, 'Live');
    const { t1 } = await plan(a, ev);
    const g = await guestList(a, ev);
    const guestsChannel = `org:${a.org.id}:event:${ev.id}:guests`;
    const seatsChannel = `org:${a.org.id}:event:${ev.id}:guest-seats`;
    const before = (await messages(guestsChannel)).length;
    await executeCommand(addPlusOneCommand, { eventId: ev.id, hostGuestId: g.mei.id }, a.ctx(), ports);
    const after = await messages(guestsChannel);
    expect(after.slice(before)).toEqual([
      { event: 'party', data: { partyId: g.chen.id, at: expect.any(String) } },
    ]);
    // A refused change (a second plus-one for Mei) publishes nothing.
    await expect(
      executeCommand(addPlusOneCommand, { eventId: ev.id, hostGuestId: g.mei.id }, a.ctx(), ports),
    ).rejects.toBeTruthy();
    expect((await messages(guestsChannel)).length).toBe(after.length);
    // Naming the plus-one (a meal too) is one message.
    const [plusMei] = (await view(a, ev.id)).parties
      .flatMap((p) => p.guests)
      .filter((x) => x.guestOf === 'Mei X');
    await executeCommand(
      updatePartyGuestCommand,
      { eventId: ev.id, guestId: plusMei?.id ?? '', firstName: 'Kai', lastName: 'Y', meal: 'Fish' },
      a.ctx(),
      ports,
    );
    expect((await messages(guestsChannel)).length).toBe(after.length + 1);
    // Seating publishes the tables that changed on the seating channel; ids only.
    await seat(a, ev.id, t1, [g.mei.id]);
    const seats = await messages(seatsChannel);
    expect(seats).toEqual([
      { event: 'seats', data: { subEventId: null, itemIds: [t1], at: expect.any(String) } },
    ]);
    expect(JSON.stringify(seats)).not.toContain('Mei');
  });

  it('a viewer reads the editor but cannot seat; another org reaches nothing', async () => {
    const ev = await wedding(a, 'Roles');
    const { t1 } = await plan(a, ev);
    const g = await guestList(a, ev);
    const viewer = userCtx(a.viewerId, a.org.id);
    expect((await view(a, ev.id, null, viewer)).parties).toHaveLength(2);
    await expect(seat(a, ev.id, t1, [g.mei.id], null, viewer)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        setVipTableCommand,
        { eventId: ev.id, subEventId: null, itemId: t1, vip: true },
        viewer,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Org B: A's event is not there (no plan, no parties), and A's guests can't be seated.
    const fromB = await view(b, ev.id);
    expect(fromB.parties).toEqual([]);
    expect(fromB.source).toBe('none');
    await expect(seat(b, ev.id, t1, [g.mei.id])).rejects.toMatchObject({ code: 'not_found' });
    const bev = await wedding(b, 'B');
    const bp = await plan(b, bev);
    await expect(seat(b, bev.id, bp.t1, [g.mei.id])).rejects.toMatchObject({
      details: { reason: 'unknown_guest' },
    });
    const [rows] = await admin<{ n: number }[]>`
      select count(*)::int as n from seating.guest_seats where org_id = ${b.org.id} and guest_id = ${g.mei.id}`;
    expect(rows?.n).toBe(0);
  });
});
