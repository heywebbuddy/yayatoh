import { addGuestCommand } from '@yayatoh/attendees';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  addOccurrencesCommand,
  cancelOccurrenceCommand,
  createEventCommand,
  transitionEventCommand,
} from '@yayatoh/events';
import { buildRow } from '@yayatoh/floorplan';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { publicMedia, uploadMedia } from '@yayatoh/media';
import { testPng } from '@yayatoh/media/testing';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  orderDetailQuery,
  recordBoxOfficeSaleCommand,
  startCheckoutCommand,
} from '@yayatoh/orders';
import { attendeeExportBulk } from '@yayatoh/reports';
import {
  allocateGroupSeatsCommand,
  assignSeatCategoryCommand,
  assignSeatsCommand,
  attendeeSeatLabelsQuery,
  blockSeatsCommand,
  dateChartsQuery,
  eventSeatingQuery,
  giveDateOwnChartCommand,
  publicSeatMap,
  publicUnderlayShown,
  publishEventLayoutCommand,
  removeDateChartCommand,
  seatAssignBulk,
  seatAssignmentsQuery,
  seatGroupsQuery,
  setEventLayoutCommand,
  ticketSeatLabelsQuery,
  unassignSeatsCommand,
} from '@yayatoh/seating';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXPORT_PARAMS, type OrgFixture, ports, runBulk, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/** Event names are unique per run (slugs are global; other suites create similar events). */
const RUN = uuidv7().slice(-8);
let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let seated: string;
const dates: string[] = [];
const SECTION = uuidv7();
const row = buildRow({ label: 'A', count: 6, x: 100, y: 100, sectionId: SECTION });
const seat = (i: number) => row.seats[i]?.id ?? '';
const doc = {
  version: 1,
  width: 1000,
  height: 500,
  sections: [{ id: SECTION, label: 'Stalls' }],
  items: [row],
};

const buyer = (n: string) => ({ email: `dates-${n}.${RUN}@example.test`, name: `Dates ${n}` });
const checkout = (occurrenceId: string, seats: string[], n: string) =>
  executeCommand(
    startCheckoutCommand,
    { eventId, occurrenceId, items: [], seats, buyer: buyer(n) },
    createCtx({ orgId: a.org.id }),
    ports,
  );
async function pay(orderId: string, total: number) {
  const pi = `fakepi_dates_${orderId}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId, provider: 'fake', providerPaymentId: pi },
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
      amountMinor: total,
      currency: 'USD',
      orgId: a.org.id,
      orderId,
    },
    systemCtx(a.org.id),
    ports,
  );
}
const buy = async (occurrenceId: string, seats: string[], n: string) => {
  const o = await checkout(occurrenceId, seats, n);
  await pay(o.order.id, o.order.totalMinor);
  return o.order.id;
};
const availableOn = async (occurrenceId: string | null) =>
  new Map(
    (await publicSeatMap(a.org.id, eventId, { occurrenceId }))?.seats.map((s) => [s.seatUuid, s.available]),
  );
const seatingOn = (occurrenceId: string | null, ctx = a.ctx()) =>
  executeQuery(eventSeatingQuery, { eventId, occurrenceId }, ctx, ports);
const give = (occurrenceId: string, ctx = a.ctx()) =>
  executeCommand(giveDateOwnChartCommand, { eventId, occurrenceId }, ctx, ports);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: `Run of shows ${RUN}`,
        timezone: 'UTC',
        startsAt: '2029-10-01T19:00:00Z',
        endsAt: '2029-10-01T22:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
  const added = await executeCommand(
    addOccurrencesCommand,
    {
      eventId,
      dates: [1, 2, 3, 4].map((d) => ({
        startsAt: `2029-10-0${d}T19:00:00Z`,
        endsAt: `2029-10-0${d}T22:00:00Z`,
      })),
    },
    a.ctx(),
    ports,
  );
  dates.push(...added.map((o) => o.id));
  seated = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'Stalls', priceMinor: 3000, quantityTotal: 100 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(setEventLayoutCommand, { eventId, doc }, a.ctx(), ports);
  await executeCommand(
    assignSeatCategoryCommand,
    { eventId, itemIds: [row.id], ticketTypeId: seated },
    a.ctx(),
    ports,
  );
  await executeCommand(blockSeatsCommand, { eventId, seatUuids: [seat(5)], reason: 'kill' }, a.ctx(), ports);
  await executeCommand(publishEventLayoutCommand, { eventId }, a.ctx(), ports);
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
});
afterAll(closePools);

describe('per-date charts (M1.7g)', () => {
  it('by default every date uses the event plan: one inventory, as before', async () => {
    expect(await executeQuery(dateChartsQuery, { eventId }, a.ctx(), ports)).toEqual([]);
    // A date without its own chart resolves to the event plan.
    expect((await seatingOn(dates[1] as string))?.chart).toBeNull();
    await buy(dates[0] as string, [seat(0)], 'plan');
    // Seat 1·A sold for date 1 on the shared plan is taken on every date that uses it.
    expect((await availableOn(dates[0] as string)).get(seat(0))).toBe(false);
    expect((await availableOn(dates[2] as string)).get(seat(0))).toBe(false);
    // The event plan remembers which date that sale is for.
    const [row0] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ held_for_occurrence_id: string | null }>(
        sql`select held_for_occurrence_id from seating.event_seats where event_id = ${eventId} and seat_uuid = ${seat(0)} and occurrence_id is null`,
      ),
    );
    expect(row0?.held_for_occurrence_id).toBe(dates[0]);
  });

  it('a date gets its own copy of the plan: prices and blocks copied, sales never', async () => {
    const r = await give(dates[1] as string);
    // The event plan is locked (sold); its copy is on sale, not locked.
    expect(r).toMatchObject({ occurrenceId: dates[1], seatCount: 6, status: 'published' });
    const s = await seatingOn(dates[1] as string);
    expect(s?.chart).toBe(dates[1]);
    expect(s?.status).toBe('published');
    expect(s?.seats.every((x) => x.ticketTypeId === seated)).toBe(true);
    expect(s?.seats.find((x) => x.seatUuid === seat(0))?.status).toBe('available');
    expect(s?.seats.find((x) => x.seatUuid === seat(5))?.status).toBe('blocked');
    expect(await executeQuery(dateChartsQuery, { eventId }, a.ctx(), ports)).toEqual([
      { occurrenceId: dates[1], status: 'published', seatCount: 6, inUse: 0 },
    ]);
    // Once only; foreign, cancelled and unknown dates are refused.
    await expect(give(dates[1] as string)).rejects.toMatchObject({ details: { reason: 'date_has_chart' } });
    await expect(give(uuidv7())).rejects.toMatchObject({ code: 'not_found' });
    await executeCommand(cancelOccurrenceCommand, { occurrenceId: dates[3] as string }, a.ctx(), ports);
    await expect(give(dates[3] as string)).rejects.toMatchObject({ details: { reason: 'date_cancelled' } });
  });

  it('selling a seat on date A leaves date B free: the same seat sells on both dates', async () => {
    expect((await availableOn(dates[1] as string)).get(seat(0))).toBe(true);
    const orderId = await buy(dates[1] as string, [seat(0)], 'own');
    const order = await executeQuery(orderDetailQuery, { orderId }, a.ctx(), ports);
    expect(order.tickets[0]?.seatLabel).toBe('Row A · 1');
    expect(order.tickets[0]?.occurrenceId).toBe(dates[1]);
    // Taken on date 2's chart now, and still on the event plan (date 1's sale) — two sales of one seat id.
    expect((await availableOn(dates[1] as string)).get(seat(0))).toBe(false);
    const [n] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from seating.event_seats where event_id = ${eventId} and seat_uuid = ${seat(0)} and status = 'sold'`,
      ),
    );
    expect(n?.n).toBe(2);
    // Selling locks date 2's chart only.
    expect((await seatingOn(dates[1] as string))?.status).toBe('locked');
    // The Seat column and the order page find each buyer's seat on their own date's chart.
    const labels = await executeQuery(
      ticketSeatLabelsQuery,
      { eventId, tickets: order.tickets.map((t) => ({ ticketId: t.id, occurrenceId: t.occurrenceId })) },
      a.ctx(),
      ports,
    );
    expect(labels).toEqual([{ ticketId: order.tickets[0]?.id, seat: 'Stalls · Row A · 1' }]);
  });

  it('holds are per chart; a hold on the event plan for a date keeps that date from its own copy', async () => {
    const hold = await checkout(dates[1] as string, [seat(1)], 'hold-own');
    expect((await availableOn(dates[1] as string)).get(seat(1))).toBe(false);
    expect((await availableOn(dates[0] as string)).get(seat(1))).toBe(true);
    expect(hold.order.status).toBe('reserved');
    // A seat of the event plan held for date 3 blocks giving date 3 its own chart.
    await checkout(dates[2] as string, [seat(2)], 'hold-plan');
    await expect(give(dates[2] as string)).rejects.toMatchObject({ details: { reason: 'seats_in_use' } });
  });

  it('box office sells a seat on the chosen date’s chart', async () => {
    const r = await executeCommand(
      recordBoxOfficeSaleCommand,
      { eventId, occurrenceId: dates[1], seats: [seat(3)], buyer: buyer('door'), method: 'cash' },
      a.ctx(),
      ports,
    );
    expect(r.order.status).toBe('paid');
    expect((await availableOn(dates[1] as string)).get(seat(3))).toBe(false);
    expect((await availableOn(dates[0] as string)).get(seat(3))).toBe(true);
  });

  it('guests are seated per date: one-by-one, groups and in bulk, without touching other charts', async () => {
    const guest = async (name: string) =>
      (
        await executeCommand(
          addGuestCommand,
          { eventId, name, email: `${name.toLowerCase()}.${RUN}@dates.test`, labels: ['Crew'] },
          a.ctx(),
          ports,
        )
      ).id;
    const ann = await guest('Ann');
    const ben = await guest('Ben');
    const cy = await guest('Cy');
    await executeCommand(
      assignSeatsCommand,
      { eventId, occurrenceId: dates[1], attendeeIds: [ann], itemId: row.id, seatUuid: seat(4) },
      a.ctx(),
      ports,
    );
    // On the event plan, seat 5 is still free.
    const plan = await seatingOn(null);
    expect(plan?.seats.find((x) => x.seatUuid === seat(4))?.state).toBe('available');
    expect((await seatingOn(dates[1] as string))?.seats.find((x) => x.seatUuid === seat(4))?.state).toBe(
      'assigned',
    );
    const view = await executeQuery(
      seatAssignmentsQuery,
      { eventId, occurrenceId: dates[1] },
      a.ctx(),
      ports,
    );
    expect(view?.items[0]?.seats.find((x) => x.seatUuid === seat(4))?.person?.name).toBe('Ann');
    // Ann may also sit on the event plan (another chart): both seats stay.
    await executeCommand(
      assignSeatsCommand,
      { eventId, attendeeIds: [ann], itemId: row.id, seatUuid: seat(4) },
      a.ctx(),
      ports,
    );
    expect((await seatingOn(dates[1] as string))?.seats.find((x) => x.seatUuid === seat(4))?.state).toBe(
      'assigned',
    );
    // Unseating on the event plan leaves the date's seat alone.
    await executeCommand(unassignSeatsCommand, { eventId, attendeeIds: [ann] }, a.ctx(), ports);
    expect((await seatingOn(null))?.seats.find((x) => x.seatUuid === seat(4))?.state).toBe('available');
    expect((await seatingOn(dates[1] as string))?.seats.find((x) => x.seatUuid === seat(4))?.state).toBe(
      'assigned',
    );
    // The Seat column: a guest without a date shows their seat on the chart they sit on.
    const labels = await executeQuery(
      attendeeSeatLabelsQuery,
      { eventId, people: [{ attendeeId: ann, ticketId: null, occurrenceId: dates[1] as string }] },
      a.ctx(),
      ports,
    );
    expect(labels).toEqual([{ attendeeId: ann, seat: 'Stalls · Row A · 5' }]);

    // Bulk: Ben and Cy on the event plan ("best available") — date 2 untouched.
    const op = await executeCommand(
      seatAssignBulk.start,
      { eventId, selection: { ids: [ben, cy] }, params: { target: { kind: 'best' } } },
      a.ctx(),
      ports,
    );
    expect(await runBulk(a.org.id, op.operationId)).toBe('done');
    const d2 = await seatingOn(dates[1] as string);
    expect(d2?.counts.assigned).toBe(1);
    // …then on date 2's chart: its free seats only.
    const op2 = await executeCommand(
      seatAssignBulk.start,
      {
        eventId,
        selection: { ids: [ben, cy] },
        params: { target: { kind: 'best' }, occurrenceId: dates[1] },
      },
      a.ctx(),
      ports,
    );
    expect(await runBulk(a.org.id, op2.operationId)).toBe('done');
    // Date 2 has one free seat left (sold, held, the box office sale, Ann and a killed seat):
    // one of them is seated, the other fails, as a partial result.
    expect(
      await executeQuery(seatAssignBulk.status, { operationId: op2.operationId }, a.ctx(), ports),
    ).toMatchObject({
      succeeded: 1,
      failed: 1,
      failures: [expect.objectContaining({ code: 'not_enough_seats' })],
    });
    expect((await seatingOn(dates[1] as string))?.counts.assigned).toBe(2);
    const planAssigned = (await seatingOn(null))?.counts.assigned;
    expect(planAssigned).toBe(2);
    // Undo takes them off date 2's chart only.
    await executeCommand(seatAssignBulk.undo, { operationId: op2.operationId }, a.ctx(), ports);
    expect(await runBulk(a.org.id, op2.operationId)).toBe('undone');
    expect((await seatingOn(dates[1] as string))?.counts.assigned).toBe(1);
    expect((await seatingOn(null))?.counts.assigned).toBe(2);

    // Group blocks are per chart too.
    await executeCommand(
      allocateGroupSeatsCommand,
      { eventId, occurrenceId: dates[1], label: 'Crew', itemId: row.id, count: 1 },
      a.ctx(),
      ports,
    ).catch((err) => {
      // Every free seat of date 2's row may already be taken by now; then nothing is allocated.
      expect(err).toMatchObject({ details: { reason: 'not_enough_seats' } });
    });
    const groups = await executeQuery(seatGroupsQuery, { eventId, occurrenceId: dates[1] }, a.ctx(), ports);
    const planGroups = await executeQuery(seatGroupsQuery, { eventId }, a.ctx(), ports);
    expect(planGroups.find((g) => g.label === 'Crew')).toBeUndefined();
    expect(groups.every((g) => g.label === 'Crew')).toBe(true);

    // The export's Seat column.
    const exp = await executeCommand(
      attendeeExportBulk.start,
      { eventId, selection: { ids: [ben] }, params: EXPORT_PARAMS },
      a.ctx(),
      ports,
    );
    expect(await runBulk(a.org.id, exp.operationId)).toBe('done');
    const f = await executeQuery(attendeeExportBulk.file, { operationId: exp.operationId }, a.ctx(), ports);
    const [header, line] = f.content.replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(header?.endsWith(',Seat')).toBe(true);
    expect(line).toMatch(/,Stalls · Row A · \d$/);
  });

  it('editing a date’s chart changes that chart only', async () => {
    // Date 3's chart: a fresh copy after its hold lapses (not tested here) — use a new date.
    const [d5] = await executeCommand(
      addOccurrencesCommand,
      { eventId, dates: [{ startsAt: '2029-10-05T19:00:00Z', endsAt: '2029-10-05T22:00:00Z' }] },
      a.ctx(),
      ports,
    );
    const id = d5?.id as string;
    await give(id);
    const wider = buildRow({ label: 'B', count: 3, x: 100, y: 300 });
    await executeCommand(
      setEventLayoutCommand,
      { eventId, occurrenceId: id, doc: { ...doc, items: [row, wider] } },
      a.ctx(),
      ports,
    );
    expect((await seatingOn(id))?.seats).toHaveLength(9);
    expect((await seatingOn(null))?.seats).toHaveLength(6);
    // The copy keeps prices of seats that stay (a plan on sale stays on sale).
    expect((await seatingOn(id))?.status).toBe('published');
    // Back to the event plan: allowed while nothing is sold there.
    expect(
      await executeCommand(removeDateChartCommand, { eventId, occurrenceId: id }, a.ctx(), ports),
    ).toEqual({
      occurrenceId: id,
      unseated: 0,
    });
    expect((await seatingOn(id))?.chart).toBeNull();
    // A chart with sales is locked.
    await expect(
      executeCommand(removeDateChartCommand, { eventId, occurrenceId: dates[1] as string }, a.ctx(), ports),
    ).rejects.toMatchObject({ details: { reason: 'layout_locked' } });
    // A locked date chart can't be replaced either.
    await expect(
      executeCommand(setEventLayoutCommand, { eventId, occurrenceId: dates[1], doc }, a.ctx(), ports),
    ).rejects.toMatchObject({ details: { reason: 'layout_locked' } });
  });

  it('viewers read but cannot give or remove date charts; other orgs see nothing', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    expect(await executeQuery(dateChartsQuery, { eventId }, viewer, ports)).toHaveLength(1);
    await expect(give(dates[0] as string, viewer)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(removeDateChartCommand, { eventId, occurrenceId: dates[1] as string }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await executeQuery(dateChartsQuery, { eventId }, b.ctx(), ports)).toEqual([]);
    expect(await seatingOn(dates[1] as string, b.ctx())).toBeNull();
    await expect(give(dates[0] as string, b.ctx())).rejects.toMatchObject({ code: 'not_found' });
    expect(await publicSeatMap(b.org.id, eventId, { occurrenceId: dates[1] })).toBeNull();
  });
});

describe('floor plan image under the plan (M1.7g)', () => {
  it('an uploaded floorplan image sets the underlay; buyers see it only when shown', async () => {
    const file = await testPng(80, 40);
    const { asset } = await uploadMedia(
      a.ctx(),
      { ownerType: 'event', ownerId: eventId, slot: 'floorplan', decorative: true, file },
      ports,
    );
    expect(asset.slot).toBe('floorplan');
    // Never on the event page's gallery.
    expect((await publicMedia('event', eventId)).some((m) => m.id === asset.id)).toBe(false);
    const url = asset.variants[0]?.url as string;
    const underlay = {
      url,
      mediaId: asset.id,
      x: 0,
      y: 0,
      width: 1000,
      height: 500,
      imageWidth: 80,
      imageHeight: 40,
    };
    // A fresh event (not locked) takes the image; hidden from buyers by default.
    const ev = (
      await executeCommand(
        createEventCommand,
        {
          name: `Underlay ${RUN}`,
          timezone: 'UTC',
          startsAt: '2029-11-01T19:00:00Z',
          endsAt: '2029-11-01T22:00:00Z',
        },
        a.ctx(),
        ports,
      )
    ).id;
    const tt = (
      await executeCommand(
        createTicketTypeCommand,
        { eventId: ev, name: 'Seat', priceMinor: 0, quantityTotal: 10 },
        a.ctx(),
        ports,
      )
    ).id;
    // Only this org's own media: another URL is refused.
    await expect(
      executeCommand(
        setEventLayoutCommand,
        { eventId: ev, doc: { ...doc, underlay: { ...underlay, url: 'https://evil.test/x.png' } } },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'underlay_url' } });
    await expect(
      executeCommand(
        setEventLayoutCommand,
        { eventId: ev, doc: { ...doc, underlay: { ...underlay, url: url.replace(a.org.id, b.org.id) } } },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'underlay_url' } });
    await executeCommand(setEventLayoutCommand, { eventId: ev, doc: { ...doc, underlay } }, a.ctx(), ports);
    await executeCommand(
      assignSeatCategoryCommand,
      { eventId: ev, itemIds: [row.id], ticketTypeId: tt },
      a.ctx(),
      ports,
    );
    await executeCommand(publishEventLayoutCommand, { eventId: ev }, a.ctx(), ports);
    expect(
      (await executeQuery(eventSeatingQuery, { eventId: ev }, a.ctx(), ports))?.doc.underlay,
    ).toMatchObject({
      mediaId: asset.id,
      opacity: 0.5,
      locked: false,
      showOnMap: false,
    });
    expect((await publicSeatMap(a.org.id, ev))?.doc.underlay).toBeNull();
    expect(await publicUnderlayShown(a.org.id, asset.id)).toBe(false);
    await executeCommand(
      setEventLayoutCommand,
      {
        eventId: ev,
        doc: { ...doc, underlay: { ...underlay, showOnMap: true, opacity: 0.3, locked: true } },
      },
      a.ctx(),
      ports,
    );
    expect((await publicSeatMap(a.org.id, ev))?.doc.underlay).toMatchObject({ url, showOnMap: true });
    expect(await publicUnderlayShown(a.org.id, asset.id)).toBe(true);
    // Another org never learns about it.
    expect(await publicUnderlayShown(b.org.id, asset.id)).toBe(false);
  });

  it('viewers cannot upload a floor plan image', async () => {
    const file = await testPng(20, 20);
    await expect(
      uploadMedia(
        userCtx(a.viewerId, a.org.id),
        { ownerType: 'event', ownerId: eventId, slot: 'floorplan', decorative: true, file },
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
