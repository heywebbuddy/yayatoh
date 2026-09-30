import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { buildRow } from '@yayatoh/floorplan';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
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
import {
  assignSeatCategoryCommand,
  eventSeatingQuery,
  publicSeatMap,
  publishEventLayoutCommand,
  setEventLayoutCommand,
} from '@yayatoh/seating';
import { createTicketTypeCommand, listTicketTypesQuery } from '@yayatoh/ticketing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

let a: OrgFixture;
let eventId: string;
let vip: string;
let ga: string;
const row = buildRow({ label: 'A', count: 6, x: 100, y: 100 });
const seat = (i: number) => row.seats[i]?.id ?? '';

const checkout = (seats: string[], items: { ticketTypeId: string; quantity: number }[] = [], n = 'x') =>
  executeCommand(
    startCheckoutCommand,
    { eventId, items, seats, buyer: { email: `seated-${n}@example.test`, name: `Seated ${n}` } },
    createCtx({ orgId: a.org.id }),
    ports,
  );
async function pay(orderId: string, total: number) {
  const pi = `fakepi_seat_${orderId}`;
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
const statusOf = async (i: number) =>
  (await executeQuery(eventSeatingQuery, { eventId }, a.ctx(), ports))?.seats.find(
    (s) => s.seatUuid === seat(i),
  )?.status;

beforeAll(async () => {
  ({ a } = await twoOrgs());
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: 'Seated concert',
        timezone: 'UTC',
        startsAt: '2028-09-01T18:00:00Z',
        endsAt: '2028-09-01T22:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
  vip = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'VIP', priceMinor: 8000, quantityTotal: 6 },
      a.ctx(),
      ports,
    )
  ).id;
  ga = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'Standing', priceMinor: 2000, quantityTotal: 50 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(
    setEventLayoutCommand,
    { eventId, doc: { version: 1, width: 1000, height: 500, items: [row] } },
    a.ctx(),
    ports,
  );
  await executeCommand(
    assignSeatCategoryCommand,
    { eventId, itemIds: [row.id], ticketTypeId: vip },
    a.ctx(),
    ports,
  );
  await executeCommand(publishEventLayoutCommand, { eventId }, a.ctx(), ports);
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
});
afterAll(closePools);

describe('seated checkout (M1.7c)', () => {
  it('shows buyers which seats are free, without anything about who holds them', async () => {
    const map = await publicSeatMap(a.org.id, eventId);
    expect(map?.seats).toHaveLength(6);
    expect(Object.keys(map?.seats[0] ?? {}).sort()).toEqual([
      'accessible',
      'available',
      'label',
      'seatUuid',
      'ticketTypeId',
    ]);
  });

  it('seated passes need seats; seats set the quantity; standing passes still sell by quantity', async () => {
    await expect(checkout([], [{ ticketTypeId: vip, quantity: 2 }])).rejects.toMatchObject({
      details: { reason: 'choose_seats' },
    });
    await expect(
      executeCommand(
        recordBoxOfficeSaleCommand,
        {
          eventId,
          items: [{ ticketTypeId: vip, quantity: 1 }],
          buyer: { email: 'door@example.test', name: 'Door' },
          method: 'cash',
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'choose_seats' } });
    const r = await checkout([seat(0), seat(1)], [{ ticketTypeId: ga, quantity: 1 }], 'first');
    expect(r.order.items.map((i) => [i.name, i.quantity]).sort()).toEqual([
      ['Standing', 1],
      ['VIP', 2],
    ]);
    expect([await statusOf(0), await statusOf(1)]).toEqual(['held', 'held']);
    await pay(r.order.id, r.order.totalMinor);
    const detail = await executeQuery(orderDetailQuery, { orderId: r.order.id }, a.ctx(), ports);
    expect(detail.tickets.map((t) => t.seatLabel).sort()).toEqual(['Row A · 1', 'Row A · 2', null]);
    expect([await statusOf(0), await statusOf(1)]).toEqual(['sold', 'sold']);
    expect((await executeQuery(eventSeatingQuery, { eventId }, a.ctx(), ports))?.status).toBe('locked');
  });

  it('two buyers racing for the same seat: one wins, the other is told it was just taken', async () => {
    const results = await Promise.allSettled([
      checkout([seat(2)], [], 'r1'),
      checkout([seat(2)], [], 'r2'),
      checkout([seat(2)], [], 'r3'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results
        .filter((r) => r.status === 'rejected')
        .map((r) => (r as PromiseRejectedResult).reason.details?.reason),
    ).toEqual(['seats_taken', 'seats_taken']);
  });

  it('an expired checkout frees its seats', async () => {
    await checkout([seat(3)], [], 'late');
    expect(await statusOf(3)).toBe('held');
    await executeCommand(
      expireOrdersCommand,
      {},
      { ...systemCtx(a.org.id), now: new Date(Date.now() + 60 * 60_000) },
      ports,
    );
    expect(await statusOf(3)).toBe('available');
  });

  it('a refunded seated ticket frees its seat for sale again', async () => {
    const r = await checkout([seat(4)], [], 'refund');
    await pay(r.order.id, r.order.totalMinor);
    const [ticket] = (await executeQuery(orderDetailQuery, { orderId: r.order.id }, a.ctx(), ports)).tickets;
    const refund = await executeCommand(
      startRefundCommand,
      { orderId: r.order.id, reason: 'event_cancelled', ticketIds: [ticket?.id ?? ''] },
      a.ctx(),
      ports,
    );
    await executeCommand(
      completeRefundCommand,
      { refundId: refund.refundId, outcome: 'succeeded', providerRefundId: 'fakere_seat' },
      a.ctx(),
      ports,
    );
    expect(await statusOf(4)).toBe('available');
    const again = await checkout([seat(4)], [], 'again');
    expect(again.order.items[0]).toMatchObject({ name: 'VIP', quantity: 1 });
  });

  it('a paid-late order whose seats were resold is flagged, and gives the stock back', async () => {
    const r = await checkout([seat(5)], [], 'slow');
    await executeCommand(
      attachPaymentCommand,
      { orderId: r.order.id, provider: 'fake', providerPaymentId: 'fakepi_slow' },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    await executeCommand(
      expireOrdersCommand,
      {},
      { ...systemCtx(a.org.id), now: new Date(Date.now() + 60 * 60_000) },
      ports,
    );
    await checkout([seat(5)], [], 'fast');
    const heldBefore = (await executeQuery(listTicketTypesQuery, { eventId }, a.ctx(), ports)).find(
      (t) => t.id === vip,
    )?.quantityHeld;
    const out = await executeCommand(
      applyProviderEventCommand,
      {
        provider: 'fake',
        id: 'fakeevt_slow',
        type: 'payment.succeeded',
        providerPaymentId: 'fakepi_slow',
        amountMinor: r.order.totalMinor,
        currency: 'USD',
        orgId: a.org.id,
        orderId: r.order.id,
      },
      systemCtx(a.org.id),
      ports,
    );
    expect(out.outcome).toBe('orphaned');
    const heldAfter = (await executeQuery(listTicketTypesQuery, { eventId }, a.ctx(), ports)).find(
      (t) => t.id === vip,
    )?.quantityHeld;
    expect(heldAfter).toBe(heldBefore);
  });
});
