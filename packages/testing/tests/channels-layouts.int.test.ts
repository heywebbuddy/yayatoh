import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { buildRow, type FloorplanDoc } from '@yayatoh/floorplan';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { recordBoxOfficeSaleCommand, startCheckoutCommand } from '@yayatoh/orders';
import {
  allotSeatsCommand,
  assignSeatCategoryCommand,
  deleteLayoutCommand,
  deleteSeatChannelCommand,
  eventSeatingQuery,
  holdBestAvailableCommand,
  holdBestAvailableStaffCommand,
  holdSeatsTx,
  KEEP_REVISIONS,
  layoutLibraryQuery,
  layoutRevisionQuery,
  layoutRevisionsQuery,
  orderChannelTx,
  publicSeatMap,
  publishEventLayoutCommand,
  renameLayoutCommand,
  restoreLayoutRevisionCommand,
  saveLayoutCommand,
  saveSeatChannelCommand,
  seatChannelsQuery,
  setEventLayoutCommand,
  setSelectionSettingsCommand,
} from '@yayatoh/seating';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/** Event names are unique per run (slugs are global; other suites create similar events). */
const RUN = uuidv7().slice(-8);
let a: OrgFixture;
let b: OrgFixture;

interface Seated {
  id: string;
  tt: string;
  doc: FloorplanDoc;
  rows: ReturnType<typeof buildRow>[];
  seat: (row: number, i: number) => string;
}

const planOf = (rows: ReturnType<typeof buildRow>[]): FloorplanDoc => ({
  version: 1,
  width: 4000,
  height: 3000,
  underlay: null,
  sections: [],
  items: [
    {
      kind: 'object',
      id: uuidv7(),
      objectType: 'stage',
      label: 'Stage',
      x: 300,
      y: 100,
      width: 600,
      height: 300,
      rotation: 0,
    },
    ...rows,
  ],
});

/** A published event with rows of seats (row 0 nearest the stage), all at one (free) price. */
async function seatedEvent(name: string, rows: number, perRow: number, priceMinor = 0): Promise<Seated> {
  const id = (
    await executeCommand(
      createEventCommand,
      {
        name: `${name} ${RUN}`,
        timezone: 'UTC',
        startsAt: '2029-09-01T19:00:00Z',
        endsAt: '2029-09-01T22:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
  const tt = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId: id, name: 'Seat', priceMinor, quantityTotal: 2_000 },
      a.ctx(),
      ports,
    )
  ).id;
  const built = Array.from({ length: rows }, (_, r) =>
    buildRow({ label: String.fromCharCode(65 + r), count: perRow, x: 200, y: 600 + r * 90 }),
  );
  const doc = planOf(built);
  await executeCommand(setEventLayoutCommand, { eventId: id, doc }, a.ctx(), ports);
  await executeCommand(
    assignSeatCategoryCommand,
    { eventId: id, itemIds: built.map((r) => r.id), ticketTypeId: tt },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: id, transition: 'publish' }, a.ctx(), ports);
  await executeCommand(publishEventLayoutCommand, { eventId: id }, a.ctx(), ports);
  return { id, tt, doc, rows: built, seat: (r, i) => built[r]?.seats[i]?.id ?? '' };
}

const buyer = (now?: Date): Ctx => ({ ...createCtx({ orgId: a.org.id }), ...(now ? { now } : {}) });
const channel = (ev: Seated, v: Record<string, unknown>, ctx = a.ctx()) =>
  executeCommand(saveSeatChannelCommand, { eventId: ev.id, ...v } as never, ctx, ports);
const allot = (ev: Seated, channelId: string | null, v: Record<string, unknown>, ctx = a.ctx()) =>
  executeCommand(allotSeatsCommand, { eventId: ev.id, channelId, ...v }, ctx, ports);
const checkout = (ev: Seated, extra: Record<string, unknown>, ctx = buyer()) => {
  const who = `ch-${uuidv7().slice(-6)}`;
  return executeCommand(
    startCheckoutCommand,
    { eventId: ev.id, items: [], buyer: { email: `${who}@channels.test`, name: who }, ...extra },
    ctx,
    ports,
  );
};
const door = (ev: Seated, extra: Record<string, unknown>) =>
  executeCommand(
    recordBoxOfficeSaleCommand,
    { eventId: ev.id, buyer: { email: 'door@channels.test', name: 'Door' }, method: 'cash', ...extra },
    a.ctx(),
    ports,
  );
const statusOf = async (ev: Seated) =>
  new Map(
    ((await executeQuery(eventSeatingQuery, { eventId: ev.id }, a.ctx(), ports))?.seats ?? []).map((s) => [
      s.seatUuid,
      s.status,
    ]),
  );
const page = (ev: Seated, ctx = a.ctx()) => executeQuery(seatChannelsQuery, { eventId: ev.id }, ctx, ports);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

describe('sales channels and allotments (M6.11b)', () => {
  it('the organizer creates channels; codes are checked; viewers read only', async () => {
    const ev = await seatedEvent('Channels', 2, 6);
    await expect(channel(ev, { kind: 'promoter', name: 'DJ Kai' })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'code_required', field: 'code' },
    });
    await expect(channel(ev, { kind: 'public', name: 'Web', code: 'WEB' })).rejects.toMatchObject({
      details: { reason: 'code_not_allowed' },
    });
    await expect(channel(ev, { kind: 'sponsor', name: 'Acme', code: 'a b' })).rejects.toMatchObject({
      details: { reason: 'code_format' },
    });
    const promo = await channel(ev, { kind: 'promoter', name: 'DJ Kai', code: ' dj-kai ' });
    await expect(channel(ev, { kind: 'sponsor', name: 'Acme', code: 'DJ-KAI' })).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'code_taken' },
    });
    await channel(ev, { kind: 'box_office', name: 'Door' });
    await expect(channel(ev, { kind: 'box_office', name: 'Door 2' })).rejects.toMatchObject({
      details: { reason: 'kind_taken' },
    });
    await expect(
      channel(ev, { kind: 'promoter', name: 'Viewer', code: 'VIEW' }, userCtx(a.viewerId, a.org.id)),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      allot(ev, promo.id, { itemIds: [ev.rows[0]?.id] }, userCtx(a.viewerId, a.org.id)),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(allot(ev, promo.id, {})).rejects.toMatchObject({ details: { reason: 'no_seats' } });
    expect(await allot(ev, promo.id, { itemIds: [ev.rows[0]?.id] })).toEqual({ updated: 6 });
    // Renamed and given a release time; the code is stored upper-case.
    await channel(ev, {
      id: promo.id,
      kind: 'promoter',
      name: 'DJ Kai (summer)',
      code: 'DJ-KAI',
      releaseAt: '2029-08-31T19:00:00Z',
    });
    const seen = await page(ev, userCtx(a.viewerId, a.org.id));
    expect(seen.channels).toEqual([
      expect.objectContaining({
        id: promo.id,
        kind: 'promoter',
        name: 'DJ Kai (summer)',
        code: 'DJ-KAI',
        releaseAt: new Date('2029-08-31T19:00:00Z'),
        released: false,
        seats: 6,
        orders: 0,
      }),
      expect.objectContaining({ kind: 'box_office', code: null, seats: 0 }),
    ]);
    expect(seen.allotments).toHaveLength(6);
    // A seat moves from one channel to another; "back to every channel" frees it.
    const box = seen.channels.find((c) => c.kind === 'box_office')?.id ?? '';
    expect(await allot(ev, box, { seatUuids: [ev.seat(0, 0)] })).toEqual({ updated: 1 });
    expect(await allot(ev, null, { seatUuids: [ev.seat(0, 1)] })).toEqual({ updated: 1 });
    const after = await page(ev);
    expect(after.channels.map((c) => c.seats)).toEqual([4, 1]);
    // Removing a channel gives its seats back to every channel.
    expect(
      await executeCommand(deleteSeatChannelCommand, { eventId: ev.id, id: promo.id }, a.ctx(), ports),
    ).toEqual({
      released: 4,
    });
    expect((await page(ev)).allotments).toHaveLength(1);
  });

  it('a seat in one channel can never be sold through another (checkout, box office, best available)', async () => {
    const ev = await seatedEvent('Never', 2, 6);
    const promo = await channel(ev, { kind: 'promoter', name: 'Promoter', code: 'PROMO-1' });
    const sponsor = await channel(ev, { kind: 'sponsor', name: 'Sponsor', code: 'ACME' });
    const box = await channel(ev, { kind: 'box_office', name: 'Door' });
    const web = await channel(ev, { kind: 'public', name: 'Website' });
    await allot(ev, promo.id, { seatUuids: [ev.seat(0, 0), ev.seat(0, 1)] });
    await allot(ev, sponsor.id, { seatUuids: [ev.seat(0, 2)] });
    await allot(ev, box.id, { seatUuids: [ev.seat(0, 3)] });
    await allot(ev, web.id, { seatUuids: [ev.seat(0, 4)] });

    // Online without a code: the public channel (and seats in no channel) only.
    for (const s of [ev.seat(0, 0), ev.seat(0, 2), ev.seat(0, 3)])
      await expect(checkout(ev, { seats: [s] })).rejects.toMatchObject({
        code: 'conflict',
        details: { reason: 'seat_channel' },
      });
    // An unknown code is refused, never treated as the public.
    await expect(checkout(ev, { seats: [ev.seat(1, 0)], channelCode: 'NOPE' })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'channel_code_invalid', field: 'channelCode' },
    });
    // With the promoter's code: its seats and seats in no channel, never another channel's.
    await expect(checkout(ev, { seats: [ev.seat(0, 2)], channelCode: 'promo-1' })).rejects.toMatchObject({
      details: { reason: 'seat_channel' },
    });
    await expect(checkout(ev, { seats: [ev.seat(0, 4)], channelCode: 'PROMO-1' })).rejects.toMatchObject({
      details: { reason: 'seat_channel' },
    });
    const bought = await checkout(ev, { seats: [ev.seat(0, 0), ev.seat(1, 5)], channelCode: 'promo-1' });
    expect(bought.order.status).toBe('paid');
    expect(await withTenant(a.ctx(), (tx) => orderChannelTx(tx, bought.order.id))).toBe(promo.id);
    // The public channel's seat sells online without a code.
    await checkout(ev, { seats: [ev.seat(0, 4)] });
    // The box office sells its own seats and seats in no channel, never a promoter's or the website's.
    await expect(door(ev, { seats: [ev.seat(0, 1)] })).rejects.toMatchObject({
      details: { reason: 'seat_channel' },
    });
    await door(ev, { seats: [ev.seat(0, 3)] });
    const status = await statusOf(ev);
    expect([0, 1, 2, 3, 4].map((i) => status.get(ev.seat(0, i)))).toEqual([
      'sold',
      'available',
      'available',
      'sold',
      'sold',
    ]);
    // Holding by hand without naming a channel can't take a channel's seat (secure default).
    await expect(
      withTenant(a.ctx(), (tx) =>
        holdSeatsTx(tx, a.ctx(), {
          eventId: ev.id,
          seatUuids: [ev.seat(0, 1)],
          holdId: uuidv7(),
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ),
    ).rejects.toMatchObject({ details: { reason: 'seat_channel' } });
    // The channel's report counts paid orders through it.
    const report = await page(ev);
    expect(report.channels.find((c) => c.id === promo.id)).toMatchObject({ orders: 1, seatsSold: 2 });
    expect(report.channels.find((c) => c.id === box.id)).toMatchObject({ orders: 1, seatsSold: 1 });
    expect(report.channels.find((c) => c.id === web.id)).toMatchObject({ orders: 1, seatsSold: 1 });
  });

  it('best available never picks another channel’s seats, and an adopted hold is checked again', async () => {
    const ev = await seatedEvent('Best channel', 2, 6);
    await executeCommand(
      setSelectionSettingsCommand,
      { eventId: ev.id, bestAvailable: true, sectionScores: {} },
      a.ctx(),
      ports,
    );
    const promo = await channel(ev, { kind: 'promoter', name: 'Front row', code: 'FRONT' });
    // The whole front row (the best seats) is the promoter's.
    await allot(ev, promo.id, { itemIds: [ev.rows[0]?.id] });
    const best = (more: Record<string, unknown> = {}, ctx = buyer()) =>
      executeCommand(
        holdBestAvailableCommand,
        { eventId: ev.id, ticketTypeId: ev.tt, quantity: 2, ...more },
        ctx,
        ports,
      );
    const general = await best();
    expect(general.seats.every((s) => s.label.startsWith('Row B'))).toBe(true);
    const front = await best({ channelCode: 'front' });
    expect(front.seats.every((s) => s.label.startsWith('Row A'))).toBe(true);
    await expect(best({ channelCode: 'BACK' })).rejects.toMatchObject({
      details: { reason: 'channel_code_invalid' },
    });
    // The promoter's hold taken over by a checkout without the code: refused, nothing changes.
    await expect(checkout(ev, { seatHold: front.token })).rejects.toMatchObject({
      details: { reason: 'seat_channel' },
    });
    const ok = await checkout(ev, { seatHold: front.token, channelCode: 'FRONT' });
    expect(ok.order.status).toBe('paid');
    // The box office's best available skips the promoter's row too.
    const staff = await executeCommand(
      holdBestAvailableStaffCommand,
      { eventId: ev.id, ticketTypeId: ev.tt, quantity: 2 },
      a.ctx(),
      ports,
    );
    expect(staff.seats.every((s) => s.label.startsWith('Row B'))).toBe(true);
  });

  it('released seats go back to every channel at the release time; the public map follows', async () => {
    const ev = await seatedEvent('Release', 1, 4);
    const promo = await channel(ev, {
      kind: 'promoter',
      name: 'Early',
      code: 'EARLY',
      releaseAt: '2029-08-01T00:00:00Z',
    });
    await allot(ev, promo.id, { seatUuids: [ev.seat(0, 0)] });
    const before = new Date('2029-07-31T23:00:00Z');
    const after = new Date('2029-08-01T00:00:01Z');
    const map = await publicSeatMap(a.org.id, ev.id, { now: before });
    expect(map?.seats.find((s) => s.seatUuid === ev.seat(0, 0))).toMatchObject({
      available: false,
      otherChannel: true,
    });
    expect(map?.seats.find((s) => s.seatUuid === ev.seat(0, 1))).not.toHaveProperty('otherChannel');
    expect(map?.channel).toBeUndefined();
    const withCode = await publicSeatMap(a.org.id, ev.id, { now: before, channelCode: 'early' });
    expect(withCode?.channel).toEqual({ name: 'Early' });
    expect(withCode?.seats.find((s) => s.seatUuid === ev.seat(0, 0))).toMatchObject({ available: true });
    expect((await publicSeatMap(a.org.id, ev.id, { now: before, channelCode: 'LATE' }))?.channel).toBe(
      'invalid',
    );
    // The box office's map is the box office channel's: the promoter's seat isn't theirs either.
    const staffMap = await publicSeatMap(a.org.id, ev.id, { now: before, audience: 'staff' });
    expect(staffMap?.seats.find((s) => s.seatUuid === ev.seat(0, 0))?.otherChannel).toBe(true);
    await expect(checkout(ev, { seats: [ev.seat(0, 0)] }, buyer(before))).rejects.toMatchObject({
      details: { reason: 'seat_channel' },
    });
    const released = await publicSeatMap(a.org.id, ev.id, { now: after });
    expect(released?.seats.find((s) => s.seatUuid === ev.seat(0, 0))).toMatchObject({ available: true });
    expect((await page(ev, buyerCtxAt(after))).channels[0]?.released).toBe(true);
    const sold = await checkout(ev, { seats: [ev.seat(0, 0)] }, buyer(after));
    expect(sold.order.status).toBe('paid');
  });

  it('isolation: another org can neither see, allot nor use this org’s channels', async () => {
    const ev = await seatedEvent('Isolated channels', 1, 4);
    const promo = await channel(ev, { kind: 'promoter', name: 'Mine', code: 'MINE' });
    await allot(ev, promo.id, { seatUuids: [ev.seat(0, 0)] });
    expect(await page(ev, b.ctx())).toEqual({ channels: [], allotments: [] });
    await expect(
      channel(ev, { kind: 'promoter', name: 'Theirs', code: 'THEIRS' }, b.ctx()),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(allot(ev, promo.id, { seatUuids: [ev.seat(0, 1)] }, b.ctx())).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await allot(ev, null, { seatUuids: [ev.seat(0, 0)] }, b.ctx())).toEqual({ updated: 0 });
    await expect(
      executeCommand(deleteSeatChannelCommand, { eventId: ev.id, id: promo.id }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect((await page(ev)).allotments).toHaveLength(1);
    for (const table of ['seat_channels', 'channel_seats', 'channel_orders', 'layout_revisions']) {
      const rows = await withTenant(b.ctx(), (tx) =>
        tx.execute<{ org_id: string }>(sql.raw(`select org_id from seating.${table}`)),
      );
      expect(rows.length, table).toBeGreaterThan(0);
      expect(rows.every((r) => r.org_id === b.org.id)).toBe(true);
    }
  });

  it('needs the advanced_seating module', async () => {
    const ev = await seatedEvent('Module channels', 1, 4);
    const off = { moduleKey: 'advanced_seating', reason: 'test' } as const;
    await executeCommand(
      setEntitlementOverrideCommand,
      { ...off, effect: 'revoke' },
      systemCtx(a.org.id),
      ports,
    );
    try {
      await expect(channel(ev, { kind: 'public', name: 'Web' })).rejects.toMatchObject({
        code: 'module_not_enabled',
      });
      await expect(page(ev)).rejects.toMatchObject({ code: 'module_not_enabled' });
      await expect(
        executeQuery(layoutRevisionsQuery, { eventId: ev.id }, a.ctx(), ports),
      ).rejects.toMatchObject({ code: 'module_not_enabled' });
      await expect(
        executeCommand(restoreLayoutRevisionCommand, { eventId: ev.id, number: 1 }, a.ctx(), ports),
      ).rejects.toMatchObject({ code: 'module_not_enabled' });
    } finally {
      await executeCommand(
        setEntitlementOverrideCommand,
        { ...off, effect: 'grant' },
        systemCtx(a.org.id),
        ports,
      );
    }
  });
});

const buyerCtxAt = (now: Date): Ctx => ({ ...a.ctx(), now });

describe('layout revisions (M6.11b)', () => {
  const revisions = (ev: Seated, ctx = a.ctx()) =>
    executeQuery(layoutRevisionsQuery, { eventId: ev.id }, ctx, ports);
  const revision = (ev: Seated, number: number, ctx = a.ctx()) =>
    executeQuery(layoutRevisionQuery, { eventId: ev.id, number }, ctx, ports);
  const restore = (ev: Seated, number: number, ctx = a.ctx()) =>
    executeCommand(restoreLayoutRevisionCommand, { eventId: ev.id, number }, ctx, ports);
  const save = (ev: Seated, doc: FloorplanDoc) =>
    executeCommand(setEventLayoutCommand, { eventId: ev.id, doc }, a.ctx(), ports);

  it('every save is a revision with what it changed; restoring brings a plan back as a new revision', async () => {
    const ev = await seatedEvent('Revisions', 2, 4);
    // An unchanged save is not repeated.
    await save(ev, ev.doc);
    const third = buildRow({ label: 'C', count: 3, x: 200, y: 900 });
    await save(ev, planOf([...ev.rows, third]));
    const renamed = planOf([{ ...(ev.rows[0] as Seated['rows'][number]), label: 'AA' }, ev.rows[1] as never]);
    await save(ev, renamed);
    const list = await revisions(ev, userCtx(a.viewerId, a.org.id));
    expect(list?.current).toBe(3);
    expect(list?.revisions.map((r) => [r.number, r.kind, r.seatCount, r.changes])).toEqual([
      [3, 'save', 8, { added: 0, removed: 3, renumbered: 4, moved: 0 }],
      [2, 'save', 11, { added: 3, removed: 0, renumbered: 0, moved: 0 }],
      [1, 'save', 8, null],
    ]);
    const two = await revision(ev, 2);
    expect(two.changes?.addedSeats.map((s) => s.label)).toEqual(['Row C · 1', 'Row C · 2', 'Row C · 3']);
    expect(two.restore).toMatchObject({ added: 3, removed: 0, renumbered: 4 });
    expect(two.canRestore).toBe(true);
    expect((await revision(ev, 3)).canRestore).toBe(false);
    await expect(restore(ev, 2, userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(restore(ev, 99)).rejects.toMatchObject({ code: 'not_found' });
    // Prices and blocks follow the seats that keep their id.
    expect(await restore(ev, 1)).toEqual({
      number: 4,
      seatCount: 8,
      kept: 0,
      remapped: 0,
      status: 'published',
    });
    const now = await executeQuery(eventSeatingQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(now?.seats.map((s) => s.label).sort()).toEqual(
      ['A', 'B'].flatMap((r) => [1, 2, 3, 4].map((n) => `Row ${r} · ${n}`)).sort(),
    );
    expect(now?.seats.every((s) => s.ticketTypeId === ev.tt)).toBe(true);
    const after = await revisions(ev);
    expect(after?.revisions[0]).toMatchObject({ number: 4, kind: 'restore', restoredFrom: 1 });
    expect(KEEP_REVISIONS).toBe(100);
  });

  it('restoring a revision keeps sold seats: kept, remapped by label, or refused with the seats named', async () => {
    const ev = await seatedEvent('Restore sold', 2, 4);
    // Revision 2: row A drawn again (new seat ids, same labels), row B removed.
    const redrawn = buildRow({ label: 'A', count: 4, x: 200, y: 700 });
    await save(ev, planOf([redrawn]));
    // Revision 3: back to the original, and a seat of row A is sold (the plan locks).
    await save(ev, ev.doc);
    await executeCommand(
      assignSeatCategoryCommand,
      { eventId: ev.id, itemIds: ev.rows.map((r) => r.id), ticketTypeId: ev.tt },
      a.ctx(),
      ports,
    );
    const sale = await door(ev, { seats: [ev.seat(0, 1)] });
    expect((await executeQuery(eventSeatingQuery, { eventId: ev.id }, a.ctx(), ports))?.status).toBe(
      'locked',
    );
    // Revision 2 lacks row B but nothing is sold there; A·2 is remapped onto the redrawn seat.
    const detail = await revision(ev, 2);
    expect(detail.inUse).toEqual({
      kept: 0,
      remapped: [{ seatUuid: ev.seat(0, 1), label: 'Row A · 2', status: 'sold' }],
      conflicts: [],
    });
    expect(detail.canRestore).toBe(true);
    // Sell a seat of row B: now revision 2 can't keep it.
    await door(ev, { seats: [ev.seat(1, 0)] });
    const blocked = await revision(ev, 2);
    expect(blocked.inUse.conflicts).toEqual([
      { seatUuid: ev.seat(1, 0), label: 'Row B · 1', status: 'sold', reason: 'removed', newLabel: null },
    ]);
    expect(blocked.canRestore).toBe(false);
    await expect(restore(ev, 2)).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'restore_conflicts', conflicts: [{ label: 'Row B · 1', reason: 'removed' }] },
    });
    // Revision 1 (the original) keeps both sold seats as they are.
    const back = await restore(ev, 1);
    expect(back).toMatchObject({ kept: 2, remapped: 0, status: 'locked' });
    const seats = await statusOf(ev);
    expect(seats.get(ev.seat(0, 1))).toBe('sold');
    expect(seats.get(ev.seat(1, 0))).toBe('sold');
    // The sold seat's ticket still points at the same seat row.
    const [row] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ ticket_id: string | null; label: string }>(
        sql`select ticket_id, label from seating.event_seats where event_id = ${ev.id} and seat_uuid = ${ev.seat(0, 1)}`,
      ),
    );
    expect(row?.label).toBe('Row A · 2');
    expect(row?.ticket_id).toBeTruthy();
    const [order] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ seat_uuids: string[] }>(
        sql`select seat_uuids from orders.orders where id = ${sale.order.id}`,
      ),
    );
    expect(order?.seat_uuids).toEqual([ev.seat(0, 1)]);
  });

  it('a remapped restore moves the sale onto the seat with its label, keeping the id', async () => {
    const ev = await seatedEvent('Remap', 1, 4);
    const redrawn = buildRow({ label: 'A', count: 4, x: 200, y: 800 });
    await save(ev, planOf([redrawn]));
    await save(ev, ev.doc);
    await executeCommand(
      assignSeatCategoryCommand,
      { eventId: ev.id, itemIds: [ev.rows[0]?.id ?? ''], ticketTypeId: ev.tt },
      a.ctx(),
      ports,
    );
    await door(ev, { seats: [ev.seat(0, 2)] });
    expect(await restore(ev, 2)).toMatchObject({ kept: 0, remapped: 1, seatCount: 4, status: 'locked' });
    const now = await executeQuery(eventSeatingQuery, { eventId: ev.id }, a.ctx(), ports);
    const ids = new Set(now?.seats.map((s) => s.seatUuid));
    // Every seat of the redrawn row, except the one that took the sold seat's id.
    expect(ids).toEqual(
      new Set([redrawn.seats[0]?.id, redrawn.seats[1]?.id, ev.seat(0, 2), redrawn.seats[3]?.id]),
    );
    expect(now?.seats.find((s) => s.seatUuid === ev.seat(0, 2))).toMatchObject({
      status: 'sold',
      label: 'Row A · 3',
    });
    const row = now?.doc.items.find((i) => i.kind === 'row');
    expect(row?.kind === 'row' && row.y).toBe(800);
  });

  it('isolation: another org can neither read nor restore this org’s revisions', async () => {
    const ev = await seatedEvent('Isolated revisions', 1, 3);
    await save(ev, planOf([buildRow({ label: 'Z', count: 2, x: 200, y: 600 })]));
    expect(await revisions(ev, b.ctx())).toBeNull();
    await expect(revision(ev, 1, b.ctx())).rejects.toMatchObject({ code: 'not_found' });
    await expect(restore(ev, 1, b.ctx())).rejects.toMatchObject({ code: 'not_found' });
    expect((await revisions(ev))?.current).toBe(2);
  });
});

describe('the venue layout library (M6.11b)', () => {
  it('lists the org’s plans with their use; renames and removes them; events keep their copy', async () => {
    const doc = planOf([buildRow({ label: 'A', count: 5, x: 200, y: 600 })]);
    const saved = await executeCommand(saveLayoutCommand, { name: `Hall ${RUN}`, doc }, a.ctx(), ports);
    const ev = await seatedEvent('Library', 1, 2);
    await executeCommand(setEventLayoutCommand, { eventId: ev.id, layoutId: saved.id }, a.ctx(), ports);
    const list = await executeQuery(layoutLibraryQuery, {}, userCtx(a.viewerId, a.org.id), ports);
    expect(list.find((l) => l.id === saved.id)).toMatchObject({
      name: `Hall ${RUN}`,
      seatCount: 5,
      rows: 1,
      tables: 0,
      image: false,
      usedBy: 1,
    });
    await expect(
      executeCommand(
        renameLayoutCommand,
        { id: saved.id, name: 'Nope' },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(renameLayoutCommand, { id: saved.id, name: ' ' }, a.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
    expect(
      await executeCommand(renameLayoutCommand, { id: saved.id, name: `Main hall ${RUN}` }, a.ctx(), ports),
    ).toEqual({
      id: saved.id,
      name: `Main hall ${RUN}`,
    });
    // Another org sees none of it and can't touch it.
    expect((await executeQuery(layoutLibraryQuery, {}, b.ctx(), ports)).some((l) => l.id === saved.id)).toBe(
      false,
    );
    await expect(executeCommand(deleteLayoutCommand, { id: saved.id }, b.ctx(), ports)).rejects.toMatchObject(
      {
        code: 'not_found',
      },
    );
    await executeCommand(deleteLayoutCommand, { id: saved.id }, a.ctx(), ports);
    expect((await executeQuery(layoutLibraryQuery, {}, a.ctx(), ports)).some((l) => l.id === saved.id)).toBe(
      false,
    );
    expect((await executeQuery(eventSeatingQuery, { eventId: ev.id }, a.ctx(), ports))?.seats).toHaveLength(
      5,
    );
  });
});
