import { closePools } from '@yayatoh/db/testing';
import { addOccurrencesCommand, createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { buildRow } from '@yayatoh/floorplan';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  orderDetailQuery,
  startCheckoutCommand,
} from '@yayatoh/orders';
import {
  assignSeatCategoryCommand,
  blockSeatsCommand,
  eventSeatingQuery,
  giveDateOwnChartCommand,
  publicSeatMap,
  publishEventLayoutCommand,
  setEventLayoutCommand,
} from '@yayatoh/seating';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

/** Event names are unique per run (slugs are global; other suites create similar events). */
const RUN = uuidv7().slice(-8);
let a: OrgFixture;
let _b: OrgFixture;
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
const _seatingOn = (occurrenceId: string | null, ctx = a.ctx()) =>
  executeQuery(eventSeatingQuery, { eventId, occurrenceId }, ctx, ports);
const give = (occurrenceId: string, ctx = a.ctx()) =>
  executeCommand(giveDateOwnChartCommand, { eventId, occurrenceId }, ctx, ports);

beforeAll(async () => {
  ({ a } = await twoOrgs());
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: `Leg trip ${RUN}`,
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

describe('one seat per date (legs)', () => {
  it('books a seat on each chosen date in one order: one ticket per leg, each with its own seat and date', async () => {
    await give(dates[0] as string);
    await give(dates[1] as string);
    const r = await executeCommand(
      startCheckoutCommand,
      {
        eventId,
        legs: [
          { occurrenceId: dates[0] as string, seats: [seat(0)] },
          { occurrenceId: dates[1] as string, seats: [seat(0), seat(1)] },
        ],
        buyer: buyer('legs'),
      },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    expect(r.order.items.map((i) => i.quantity)).toEqual([3]);
    expect(r.order.totalMinor).toBe(3 * 3000 + r.order.feeMinor);
    await pay(r.order.id, r.order.totalMinor);
    const detail = await executeQuery(orderDetailQuery, { orderId: r.order.id }, a.ctx(), ports);
    const legs = detail.tickets.map((t) => `${dates.indexOf(t.occurrenceId ?? '')}:${t.seatLabel}`).sort();
    expect(legs).toEqual(['0:Row A · 1', '1:Row A · 1', '1:Row A · 2']);
    // Each date's chart sold its own seats; nothing leaked to the other dates.
    expect((await availableOn(dates[0] as string)).get(seat(0))).toBe(false);
    expect((await availableOn(dates[0] as string)).get(seat(1))).toBe(true);
    expect((await availableOn(dates[1] as string)).get(seat(1))).toBe(false);
  });

  it('refuses a leg with a taken seat and rolls every leg back; the same date twice is refused', async () => {
    await expect(
      executeCommand(
        startCheckoutCommand,
        {
          eventId,
          legs: [
            { occurrenceId: dates[0] as string, seats: [seat(2)] },
            { occurrenceId: dates[1] as string, seats: [seat(0)] },
          ],
          buyer: buyer('legs2'),
        },
        createCtx({ orgId: a.org.id }),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'seats_taken' } });
    expect((await availableOn(dates[0] as string)).get(seat(2))).toBe(true);
    await expect(
      executeCommand(
        startCheckoutCommand,
        {
          eventId,
          legs: [
            { occurrenceId: dates[0] as string, seats: [seat(2)] },
            { occurrenceId: dates[0] as string, seats: [seat(3)] },
          ],
          buyer: buyer('legs3'),
        },
        createCtx({ orgId: a.org.id }),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('without legs the ordinary one-date flow is unchanged', async () => {
    const orderId = await buy(dates[0] as string, [seat(3)], 'plain');
    const order = await executeQuery(orderDetailQuery, { orderId }, a.ctx(), ports);
    expect(order.tickets).toHaveLength(1);
    expect(order.tickets[0]?.occurrenceId).toBe(dates[0]);
  });
});
