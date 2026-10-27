import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { buildRow } from '@yayatoh/floorplan';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  moveTicketSeatCommand,
  orderDetailQuery,
  startCheckoutCommand,
} from '@yayatoh/orders';
import {
  assignSeatCategoryCommand,
  eventSeatingQuery,
  publishEventLayoutCommand,
  setEventLayoutCommand,
} from '@yayatoh/seating';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

let a: OrgFixture;
let eventId: string;
let vip: string;
let _ga: string;
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
        name: 'Seat mover concert',
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
  _ga = (
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

describe('move a ticket to another seat (organizer)', () => {
  const labels = async (orderId: string) =>
    (await executeQuery(orderDetailQuery, { orderId }, a.ctx(), ports)).tickets.map(
      (t) => [t.id, t.seatLabel, t.status] as const,
    );

  it('moves a bought seat to a free seat: the ticket stays valid and shows the new seat', async () => {
    const r = await checkout([seat(0)], [], 'mv1');
    await pay(r.order.id, r.order.totalMinor);
    const [ticket] = await labels(r.order.id);
    const moved = await executeCommand(
      moveTicketSeatCommand,
      { ticketId: ticket?.[0] ?? '', toSeatUuid: seat(5) },
      a.ctx(),
      ports,
    );
    expect(moved.swapped).toBe(false);
    expect(await labels(r.order.id)).toEqual([[ticket?.[0], 'Row A · 6', 'active']]);
    expect(await statusOf(0)).toBe('available');
    expect(await statusOf(5)).toBe('sold');
  });

  it('swaps two tickets when the target seat is sold to another ticket', async () => {
    const r = await checkout([seat(1)], [], 'mv2');
    await pay(r.order.id, r.order.totalMinor);
    const [mine] = await labels(r.order.id);
    const moved = await executeCommand(
      moveTicketSeatCommand,
      { ticketId: mine?.[0] ?? '', toSeatUuid: seat(5) },
      a.ctx(),
      ports,
    );
    expect(moved.swapped).toBe(true);
    expect(moved.moved.map((m) => m.toLabel).sort()).toEqual(['Row A · 2', 'Row A · 6']);
    expect((await labels(r.order.id))[0]?.[1]).toBe('Row A · 6');
    expect(await statusOf(1)).toBe('sold');
  });

  it('refuses a seat someone is paying for right now', async () => {
    const r = await checkout([seat(2)], [], 'mv3');
    await pay(r.order.id, r.order.totalMinor);
    const held = await checkout([seat(3)], [], 'mv3h');
    expect(held.order.id).toBeTruthy();
    const [mine] = await labels(r.order.id);
    await expect(
      executeCommand(
        moveTicketSeatCommand,
        { ticketId: mine?.[0] ?? '', toSeatUuid: seat(3) },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'seat_taken' } });
    expect((await labels(r.order.id))[0]?.[1]).toBe('Row A · 3');
  });
});
