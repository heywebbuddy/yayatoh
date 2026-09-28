import {
  addGuestCommand,
  createAttendeesTx,
  removeGuestCommand,
  setAttendeeLabelsCommand,
} from '@yayatoh/attendees';
import { upsertContactTx } from '@yayatoh/crm';
import { type Listener, withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { buildRoundTable, buildRow } from '@yayatoh/floorplan';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  orderDetailQuery,
  startCheckoutCommand,
} from '@yayatoh/orders';
import { memoryRealtimeHub, type RealtimeMessage } from '@yayatoh/platform';
import {
  allocateGroupSeatsCommand,
  assignSeatCategoryCommand,
  assignSeatsCommand,
  createSeatFeed,
  listenForSeatChanges,
  publishEventLayoutCommand,
  releaseGroupSeatsCommand,
  type SeatFeed,
  type SeatWatch,
  seatAssignBulk,
  seatChannels,
  seatGroupsQuery,
  setEventLayoutCommand,
  setSeatingRulesCommand,
  unassignSeatsCommand,
} from '@yayatoh/seating';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, runBulk, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

const RUN = uuidv7().slice(-8);
let a: OrgFixture;
let b: OrgFixture;

// The big room: 20 rows of 50 in one section (1,000 seats), plus a table outside it.
const MAIN = uuidv7();
const rows = Array.from({ length: 20 }, (_, i) =>
  buildRow({ label: `R${i + 1}`, count: 50, x: 100, y: 100 + i * 90, sectionId: MAIN }),
);
const side = buildRoundTable({ label: 'S', seats: 8, x: 3500, y: 300 });
const bigDoc = {
  version: 1,
  width: 4000,
  height: 2200,
  sections: [{ id: MAIN, label: 'Main floor' }],
  items: [...rows, side],
};
let bigEvent: string;
let crowd: string[] = [];

// The small room: table 1 (4 seats, the last accessible), table 2 (4 seats), a priced row.
const t1 = buildRoundTable({ label: '1', seats: 4, x: 400, y: 400 });
t1.seats[3] = { ...(t1.seats[3] as (typeof t1.seats)[number]), accessible: true };
const t2 = buildRoundTable({ label: '2', seats: 4, x: 900, y: 400 });
const hall = buildRow({ label: 'H', count: 4, x: 100, y: 900 });
const smallDoc = { version: 1, width: 1400, height: 1200, items: [t1, t2, hall] };
let smallEvent: string;

const mkEvent = async (name: string) =>
  (
    await executeCommand(
      createEventCommand,
      {
        name: `${name} ${RUN}`,
        timezone: 'UTC',
        startsAt: '2029-05-01T18:00:00Z',
        endsAt: '2029-05-01T23:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
const guest = async (eventId: string, name: string, labels: string[] = []) =>
  (
    await executeCommand(
      addGuestCommand,
      { eventId, name, email: `${name.toLowerCase().replace(/\W+/g, '.')}.${RUN}@bulkseat.test`, labels },
      a.ctx(),
      ports,
    )
  ).id;
const seatingOf = (eventId: string) =>
  withTenant(a.ctx(), (tx) =>
    tx.execute<{
      seat_uuid: string;
      status: string;
      block_reason: string | null;
      group_label: string | null;
      attendee_id: string | null;
      pinned: boolean | null;
      prior_block: string | null;
    }>(sql`
      select s.seat_uuid, s.status, s.block_reason, s.group_label, a.attendee_id, a.pinned, a.prior_block
      from seating.event_seats s
      left join seating.seat_assignments a on a.event_id = s.event_id and a.seat_uuid = s.seat_uuid
      where s.event_id = ${eventId}
      order by s.seat_uuid`),
  );
const status = (operationId: string, ctx = a.ctx()) =>
  executeQuery(seatAssignBulk.status, { operationId }, ctx, ports);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  bigEvent = await mkEvent('Bulk hall');
  await executeCommand(setEventLayoutCommand, { eventId: bigEvent, doc: bigDoc }, a.ctx(), ports);
  await withTenant(systemCtx(a.org.id), async (tx) => {
    const ctx = systemCtx(a.org.id);
    const c = await upsertContactTx(tx, ctx, {
      email: `crowd.${RUN}@bulkseat.test`,
      name: 'Crowd',
      source: 'import',
    });
    crowd = (
      await createAttendeesTx(
        tx,
        ctx,
        Array.from({ length: 1000 }, (_, i) => ({
          eventId: bigEvent,
          contactId: c.id,
          source: 'import' as const,
          name: `Guest ${String(i).padStart(4, '0')}`,
          email: `guest${i}.${RUN}@bulkseat.test`,
        })),
      )
    ).map((r) => r.id);
  });

  smallEvent = await mkEvent('Bulk dinner');
  const tt = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId: smallEvent, name: 'Hall', priceMinor: 2000, quantityTotal: 10 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(setEventLayoutCommand, { eventId: smallEvent, doc: smallDoc }, a.ctx(), ports);
  await executeCommand(
    assignSeatCategoryCommand,
    { eventId: smallEvent, itemIds: [t1.id, t2.id, hall.id], ticketTypeId: tt },
    a.ctx(),
    ports,
  );
  await executeCommand(publishEventLayoutCommand, { eventId: smallEvent }, a.ctx(), ports);
  await executeCommand(
    transitionEventCommand,
    { eventId: smallEvent, transition: 'publish' },
    a.ctx(),
    ports,
  );
});
afterAll(closePools);

describe('bulk seat assignment: 1,000 seats (M1.8f acceptance)', () => {
  it('assigns 1,000 seats in bulk with visible progress, and undo restores every previous seat exactly', async () => {
    // Five people already sit at the side table (one of them on a seat chosen by hand).
    const five = crowd.slice(0, 5);
    await executeCommand(
      assignSeatsCommand,
      { eventId: bigEvent, attendeeIds: five.slice(0, 4), itemId: side.id },
      a.ctx(),
      ports,
    );
    await executeCommand(
      assignSeatsCommand,
      { eventId: bigEvent, attendeeIds: [five[4] as string], itemId: side.id, seatUuid: side.seats[7]?.id },
      a.ctx(),
      ports,
    );
    const before = await seatingOf(bigEvent);

    const started = Date.now();
    const op = await executeCommand(
      seatAssignBulk.start,
      {
        eventId: bigEvent,
        selection: { filter: {} },
        params: { target: { kind: 'section', sectionId: MAIN } },
      },
      a.ctx(),
      ports,
    );
    expect(op.total).toBe(1000);
    // A zero budget stops after one chunk: progress shows between chunks.
    await runBulk(a.org.id, op.operationId, 0);
    expect(await status(op.operationId)).toMatchObject({ status: 'running', processed: 100, succeeded: 100 });
    expect(await runBulk(a.org.id, op.operationId, 60_000)).toBe('done');
    const assignMs = Date.now() - started;
    const done = await status(op.operationId);
    expect(done).toMatchObject({ status: 'done', total: 1000, processed: 1000, succeeded: 1000, failed: 0 });
    expect(done.failures).toEqual([]);
    expect(done.undoUntil).not.toBeNull();

    const after = await seatingOf(bigEvent);
    const inMain = new Set(rows.flatMap((r) => r.seats.map((s) => s.id)));
    const seated = after.filter((s) => s.attendee_id);
    expect(seated).toHaveLength(1000);
    expect(seated.every((s) => inMain.has(s.seat_uuid) && s.block_reason === 'assigned')).toBe(true);
    // Plan order: the first people fill row 1 from seat 1.
    const r1 = rows[0]?.seats.map((s) => s.id) ?? [];
    const firstRow = after.filter((s) => r1.includes(s.seat_uuid));
    expect(firstRow.every((s) => s.attendee_id)).toBe(true);
    // The side table is empty again: its five moved into the section.
    const sideSeats = new Set(side.seats.map((s) => s.id));
    expect(after.filter((s) => sideSeats.has(s.seat_uuid) && s.attendee_id)).toEqual([]);

    const undoStart = Date.now();
    await executeCommand(seatAssignBulk.undo, { operationId: op.operationId }, a.ctx(), ports);
    expect(await runBulk(a.org.id, op.operationId, 60_000)).toBe('undone');
    const undoMs = Date.now() - undoStart;
    expect(await status(op.operationId)).toMatchObject({ status: 'undone', undone: 1000 });
    // Exactly as before: the five back in their seats (pinned flag and all), the section free.
    expect(await seatingOf(bigEvent)).toEqual(before);
    // Timing (local, 4 CPUs): a few seconds each way; the budget here is generous for CI.
    expect(assignMs).toBeLessThan(30_000);
    expect(undoMs).toBeLessThan(30_000);
    console.info(`bulk assign 1,000 seats: ${assignMs} ms; undo: ${undoMs} ms`);
  });

  it('undo is one-shot and the operation is audited with its target', async () => {
    const op = await executeCommand(
      seatAssignBulk.start,
      { eventId: bigEvent, selection: { ids: crowd.slice(10, 13) }, params: { target: { kind: 'best' } } },
      a.ctx(),
      ports,
    );
    expect(await runBulk(a.org.id, op.operationId)).toBe('done');
    await executeCommand(seatAssignBulk.undo, { operationId: op.operationId }, a.ctx(), ports);
    expect(await runBulk(a.org.id, op.operationId)).toBe('undone');
    await expect(
      executeCommand(seatAssignBulk.undo, { operationId: op.operationId }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    const [row] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ data: Record<string, unknown> }>(
        sql`select data from platform.audit_events where action = 'bulk.start' and target_id = ${op.operationId}`,
      ),
    );
    expect(row?.data).toMatchObject({ action: 'seating.bulkAssign', total: 3, target: 'best' });
  });
});

async function buySeat(eventId: string, seatUuid: string, who: string) {
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [],
      seats: [seatUuid],
      buyer: { email: `${who.toLowerCase()}.${RUN}@bulkseat.test`, name: who },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  const pi = `fakepi_bulkseat_${r.order.id}`;
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
  const [att] = await withTenant(a.ctx(), (tx) =>
    tx.execute<{ id: string }>(
      sql`select id from attendees.attendees where ticket_id = ${detail.tickets[0]?.id ?? ''}`,
    ),
  );
  return att?.id as string;
}

describe('bulk seat assignment: failures, rules, groups, live feed (M1.8f)', () => {
  let feed: SeatFeed;
  let listener: Listener;
  let watch: SeatWatch;
  const hub = memoryRealtimeHub();
  const pub: RealtimeMessage[] = [];

  beforeAll(async () => {
    feed = createSeatFeed({ publisher: hub, coalesceMs: 20, minIntervalMs: 60, epoch: 'bulk' });
    listener = await listenForSeatChanges(feed);
    hub.subscribe(seatChannels(a.org.id, smallEvent).public, (m) => pub.push(m));
    const w = await feed.watch(a.org.id, smallEvent);
    if (!w) throw new Error('no watch');
    watch = w;
  });
  afterAll(async () => {
    watch?.release();
    feed?.close();
    await listener?.close();
  });

  it('reports partial failures per person: not enough seats, seated by ticket, cancelled', async () => {
    const buyer = await buySeat(smallEvent, hall.seats[0]?.id as string, 'Buyer');
    const gone = await guest(smallEvent, 'Gone Guest');
    await executeCommand(removeGuestCommand, { eventId: smallEvent, attendeeId: gone }, a.ctx(), ports);
    const five = [];
    for (const n of ['Ana', 'Bo', 'Cy', 'Di', 'Ed']) five.push(await guest(smallEvent, `${n} Party`));
    const from = pub.length;
    const op = await executeCommand(
      seatAssignBulk.start,
      {
        eventId: smallEvent,
        selection: { ids: [buyer, gone, ...five] },
        params: { target: { kind: 'item', itemId: t2.id } },
      },
      a.ctx(),
      ports,
    );
    expect(await runBulk(a.org.id, op.operationId)).toBe('done');
    const st = await status(op.operationId);
    expect(st).toMatchObject({ total: 7, succeeded: 4, failed: 3 });
    expect(Object.fromEntries(st.failures.map((f) => [f.itemId, f.code]))).toEqual({
      [buyer]: 'seated_by_ticket',
      [gone]: 'attendee_cancelled',
      [five[4] as string]: 'not_enough_seats',
    });
    // The four seats went off sale, and the public feed said so.
    const t2seats = t2.seats.map((s) => s.id);
    const deadline = Date.now() + 5_000;
    const offNow = () =>
      pub.slice(from).flatMap((m) => (m.event === 'delta' ? ((m.data as { off: string[] }).off ?? []) : []));
    while (!t2seats.every((s) => offNow().includes(s)) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 20));
    expect(t2seats.every((s) => offNow().includes(s))).toBe(true);
    // Undo frees them again.
    await executeCommand(seatAssignBulk.undo, { operationId: op.operationId }, a.ctx(), ports);
    expect(await runBulk(a.org.id, op.operationId)).toBe('undone');
    const free = (await seatingOf(smallEvent)).filter((s) => t2seats.includes(s.seat_uuid));
    expect(free.every((s) => s.status === 'available' && !s.attendee_id)).toBe(true);
  });

  it('seating rules: kept-back accessible seats warn, an enforced rule skips them unless overridden', async () => {
    const people = [];
    for (const n of ['Fi', 'Gil', 'Hal', 'Ivy']) people.push(await guest(smallEvent, `${n} Rules`));
    // Warn (the default): the accessible seat is used last, and flagged.
    await executeCommand(
      setSeatingRulesCommand,
      {
        eventId: smallEvent,
        rules: [{ kind: 'ada_reserved', severity: 'warn', params: { releaseDays: 3 } }],
      },
      a.ctx(),
      ports,
    );
    const warnOp = await executeCommand(
      seatAssignBulk.start,
      {
        eventId: smallEvent,
        selection: { ids: people },
        params: { target: { kind: 'item', itemId: t1.id } },
      },
      a.ctx(),
      ports,
    );
    await runBulk(a.org.id, warnOp.operationId);
    const warned = await status(warnOp.operationId);
    expect(warned).toMatchObject({ succeeded: 4, failed: 0 });
    expect(warned.warnings).toEqual([{ itemId: people[3], code: 'ada_kept_back' }]);
    await executeCommand(seatAssignBulk.undo, { operationId: warnOp.operationId }, a.ctx(), ports);
    await runBulk(a.org.id, warnOp.operationId);

    // Enforced: the accessible seat is out of reach, so the fourth person doesn't fit.
    await executeCommand(
      setSeatingRulesCommand,
      {
        eventId: smallEvent,
        rules: [{ kind: 'ada_reserved', severity: 'enforce', params: { releaseDays: 3 } }],
      },
      a.ctx(),
      ports,
    );
    const enforced = await executeCommand(
      seatAssignBulk.start,
      {
        eventId: smallEvent,
        selection: { ids: people },
        params: { target: { kind: 'item', itemId: t1.id } },
      },
      a.ctx(),
      ports,
    );
    await runBulk(a.org.id, enforced.operationId);
    const e = await status(enforced.operationId);
    expect(e).toMatchObject({ succeeded: 3, failed: 1 });
    expect(e.failures).toEqual([{ itemId: people[3], code: 'not_enough_seats' }]);
    await executeCommand(seatAssignBulk.undo, { operationId: enforced.operationId }, a.ctx(), ports);
    await runBulk(a.org.id, enforced.operationId);

    // Overridden on purpose: seated, still flagged, and the override is audited.
    const over = await executeCommand(
      seatAssignBulk.start,
      {
        eventId: smallEvent,
        selection: { ids: people },
        params: { target: { kind: 'item', itemId: t1.id }, overrideRules: true },
      },
      a.ctx(),
      ports,
    );
    await runBulk(a.org.id, over.operationId);
    const o = await status(over.operationId);
    expect(o).toMatchObject({ succeeded: 4, failed: 0 });
    expect(o.warnings.map((w) => w.code)).toEqual(['ada_kept_back']);
    const [audit] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ data: Record<string, unknown> }>(
        sql`select data from platform.audit_events where action = 'bulk.start' and target_id = ${over.operationId}`,
      ),
    );
    expect(audit?.data).toMatchObject({ overrideRules: true, target: 'item' });
    await executeCommand(seatAssignBulk.undo, { operationId: over.operationId }, a.ctx(), ports);
    await runBulk(a.org.id, over.operationId);
    await executeCommand(setSeatingRulesCommand, { eventId: smallEvent, rules: [] }, a.ctx(), ports);
  });

  it("a group's block: allocate, seat its members into it by label, release the unused seats", async () => {
    const acme = [];
    for (const n of ['Kai', 'Lu']) acme.push(await guest(smallEvent, `${n} Acme`, ['Acme']));
    const from = pub.length;
    const r = await executeCommand(
      allocateGroupSeatsCommand,
      { eventId: smallEvent, label: '  Acme ', itemId: t2.id, count: 3 },
      a.ctx(),
      ports,
    );
    expect(r).toEqual({ label: 'Acme', itemLabel: '2', allocated: 3 });
    // Kept back: off sale on the public map at once.
    const deadline = Date.now() + 5_000;
    const offNow = () =>
      pub.slice(from).flatMap((m) => (m.event === 'delta' ? (m.data as { off: string[] }).off : []));
    while (offNow().length < 3 && Date.now() < deadline) await new Promise((res) => setTimeout(res, 20));
    expect(offNow()).toEqual(expect.arrayContaining(t2.seats.slice(0, 3).map((s) => s.id)));
    expect(await executeQuery(seatGroupsQuery, { eventId: smallEvent }, a.ctx(), ports)).toEqual([
      { label: 'Acme', seats: 3, seated: 0, unused: 3, items: [{ kind: 'table', label: '2' }] },
    ]);
    // More than is free: refused, nothing changes.
    await expect(
      executeCommand(
        allocateGroupSeatsCommand,
        { eventId: smallEvent, label: 'Beta', itemId: t2.id, count: 2 },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'not_enough_seats', fits: 1 } });
    // A single assignment can't take a group's seat automatically.
    const outsider = await guest(smallEvent, 'Out Sider');
    await expect(
      executeCommand(
        assignSeatsCommand,
        { eventId: smallEvent, attendeeIds: [outsider, acme[0] as string], itemId: t2.id },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'not_enough_seats', fits: 1 } });

    // Seat the members (everyone labelled Acme) into their block.
    const op = await executeCommand(
      seatAssignBulk.start,
      {
        eventId: smallEvent,
        selection: { filter: { labels: ['Acme'], status: 'active' } },
        params: { target: { kind: 'group', label: 'Acme' } },
      },
      a.ctx(),
      ports,
    );
    expect(await runBulk(a.org.id, op.operationId)).toBe('done');
    expect(await status(op.operationId)).toMatchObject({ total: 2, succeeded: 2, failed: 0 });
    const seats = await seatingOf(smallEvent);
    const block = seats.filter((s) => s.group_label === 'Acme');
    expect(block.filter((s) => s.attendee_id).map((s) => s.prior_block)).toEqual(['group', 'group']);
    expect(await executeQuery(seatGroupsQuery, { eventId: smallEvent }, a.ctx(), ports)).toMatchObject([
      { label: 'Acme', seats: 3, seated: 2, unused: 1 },
    ]);

    // Release the unused seat: back on sale, out of the group. Members keep theirs.
    expect(
      await executeCommand(releaseGroupSeatsCommand, { eventId: smallEvent, label: 'Acme' }, a.ctx(), ports),
    ).toEqual({ released: 1 });
    const released = (await seatingOf(smallEvent)).find(
      (s) => s.seat_uuid === block.find((x) => !x.attendee_id)?.seat_uuid,
    );
    expect(released).toMatchObject({ status: 'available', group_label: null });
    await expect(
      executeCommand(releaseGroupSeatsCommand, { eventId: smallEvent, label: 'Acme' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    // A member unseated gives the seat back to the group, not to sale.
    await executeCommand(
      unassignSeatsCommand,
      { eventId: smallEvent, attendeeIds: [acme[0] as string] },
      a.ctx(),
      ports,
    );
    expect(await executeQuery(seatGroupsQuery, { eventId: smallEvent }, a.ctx(), ports)).toMatchObject([
      { label: 'Acme', seats: 2, seated: 1, unused: 1 },
    ]);
    await executeCommand(releaseGroupSeatsCommand, { eventId: smallEvent, label: 'Acme' }, a.ctx(), ports);
    await executeCommand(
      unassignSeatsCommand,
      { eventId: smallEvent, attendeeIds: [acme[1] as string] },
      a.ctx(),
      ports,
    );
    // A seated member had kept the label: unseated, their seat returned to the (now empty) group.
    await executeCommand(releaseGroupSeatsCommand, { eventId: smallEvent, label: 'Acme' }, a.ctx(), ports);
    expect(await executeQuery(seatGroupsQuery, { eventId: smallEvent }, a.ctx(), ports)).toEqual([]);
  });

  it('bulk undo restores a group seat and a chosen seat exactly', async () => {
    const [p1, p2] = [
      await guest(smallEvent, 'Pia Restore', ['Zeta']),
      await guest(smallEvent, 'Quin Restore'),
    ];
    await executeCommand(
      allocateGroupSeatsCommand,
      { eventId: smallEvent, label: 'Zeta', itemId: t1.id, count: 1 },
      a.ctx(),
      ports,
    );
    await executeCommand(
      seatAssignBulk.start,
      { eventId: smallEvent, selection: { ids: [p1] }, params: { target: { kind: 'group', label: 'Zeta' } } },
      a.ctx(),
      ports,
    ).then((op) => runBulk(a.org.id, op.operationId));
    await executeCommand(
      assignSeatsCommand,
      { eventId: smallEvent, attendeeIds: [p2], itemId: t1.id, seatUuid: t1.seats[2]?.id },
      a.ctx(),
      ports,
    );
    const before = await seatingOf(smallEvent);
    const op = await executeCommand(
      seatAssignBulk.start,
      {
        eventId: smallEvent,
        selection: { ids: [p1, p2] },
        params: { target: { kind: 'item', itemId: t2.id } },
      },
      a.ctx(),
      ports,
    );
    await runBulk(a.org.id, op.operationId);
    expect(await status(op.operationId)).toMatchObject({ succeeded: 2 });
    await executeCommand(seatAssignBulk.undo, { operationId: op.operationId }, a.ctx(), ports);
    await runBulk(a.org.id, op.operationId);
    expect(await seatingOf(smallEvent)).toEqual(before);
  });

  it('viewers and box office can neither seat in bulk nor allocate or release groups', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    const someone = await guest(smallEvent, 'Vee Denied');
    await expect(
      executeCommand(
        seatAssignBulk.start,
        { eventId: smallEvent, selection: { ids: [someone] }, params: { target: { kind: 'best' } } },
        viewer,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        allocateGroupSeatsCommand,
        { eventId: smallEvent, label: 'X', itemId: t2.id },
        viewer,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(releaseGroupSeatsCommand, { eventId: smallEvent, label: 'X' }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Viewers may read the groups.
    expect(await executeQuery(seatGroupsQuery, { eventId: smallEvent }, viewer, ports)).toBeInstanceOf(Array);
  });

  it("org B can't seat, allocate, read or undo in org A's event", async () => {
    const someone = await guest(smallEvent, 'Iso Late');
    await expect(
      executeCommand(
        seatAssignBulk.start,
        { eventId: smallEvent, selection: { ids: [someone] }, params: { target: { kind: 'best' } } },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    // "Everything matching" in someone else's event matches nothing.
    await expect(
      executeCommand(
        seatAssignBulk.start,
        { eventId: smallEvent, selection: { filter: {} }, params: { target: { kind: 'best' } } },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        allocateGroupSeatsCommand,
        { eventId: smallEvent, label: 'Iso', itemId: t2.id },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await executeQuery(seatGroupsQuery, { eventId: smallEvent }, b.ctx(), ports)).toEqual([]);
    const op = await executeCommand(
      seatAssignBulk.start,
      { eventId: smallEvent, selection: { ids: [someone] }, params: { target: { kind: 'best' } } },
      a.ctx(),
      ports,
    );
    await runBulk(a.org.id, op.operationId);
    await expect(status(op.operationId, b.ctx())).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(seatAssignBulk.undo, { operationId: op.operationId }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await executeCommand(seatAssignBulk.undo, { operationId: op.operationId }, a.ctx(), ports);
    await runBulk(a.org.id, op.operationId);
  });

  it('labels drive group membership: relabelling someone adds them to the next bulk seating', async () => {
    const newcomer = await guest(smallEvent, 'New Comer');
    await executeCommand(
      setAttendeeLabelsCommand,
      { eventId: smallEvent, attendeeIds: [newcomer], add: ['Omega'] },
      a.ctx(),
      ports,
    );
    await executeCommand(
      allocateGroupSeatsCommand,
      { eventId: smallEvent, label: 'Omega', itemId: hall.id },
      a.ctx(),
      ports,
    );
    const op = await executeCommand(
      seatAssignBulk.start,
      {
        eventId: smallEvent,
        selection: { filter: { labels: ['Omega'], status: 'active' } },
        params: { target: { kind: 'group', label: 'Omega' } },
      },
      a.ctx(),
      ports,
    );
    await runBulk(a.org.id, op.operationId);
    expect(await status(op.operationId)).toMatchObject({ total: 1, succeeded: 1 });
    await executeCommand(seatAssignBulk.undo, { operationId: op.operationId }, a.ctx(), ports);
    await runBulk(a.org.id, op.operationId);
    await executeCommand(releaseGroupSeatsCommand, { eventId: smallEvent, label: 'Omega' }, a.ctx(), ports);
  });
});
