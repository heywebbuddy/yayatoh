import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { buildRow } from '@yayatoh/floorplan';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { orderDetailQuery, recordBoxOfficeSaleCommand, startCheckoutCommand } from '@yayatoh/orders';
import {
  assignSeatCategoryCommand,
  eventSeatingQuery,
  publishEventLayoutCommand,
  setEventLayoutCommand,
  setSeatingRulesCommand,
} from '@yayatoh/seating';
import { createTicketTypeCommand, listTicketTypesQuery } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

/** Event names are unique per run (slugs are global; other suites create similar events). */
const RUN = uuidv7().slice(-8);
let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let stalls: string;
let standing: string;
const row = buildRow({ label: 'B', count: 10, x: 100, y: 100 });
row.seats[9] = { ...(row.seats[9] as (typeof row.seats)[number]), accessible: true };
// Seat 9 is left unpriced (not on sale).
const seat = (i: number) => row.seats[i]?.id ?? '';

const sell = (seats: string[], extra: Record<string, unknown> = {}, ctx = a.ctx()) =>
  executeCommand(
    recordBoxOfficeSaleCommand,
    {
      eventId,
      seats,
      buyer: { email: 'door.buyer@example.test', name: 'Door Buyer' },
      method: 'cash',
      ...extra,
    },
    ctx,
    ports,
  );
const seating = async () => {
  const s = await executeQuery(eventSeatingQuery, { eventId }, a.ctx(), ports);
  if (!s) throw new Error('no seating');
  return s;
};
const statusOf = async (id: string) => (await seating()).seats.find((s) => s.seatUuid === id)?.status;
const orderCount = async () =>
  Number(
    (
      await withTenant(a.ctx(), (tx) =>
        tx.execute<{ n: number }>(
          sql`select count(*)::int as n from orders.orders where event_id = ${eventId}`,
        ),
      )
    )[0]?.n,
  );
const soldOf = async (id: string) =>
  (await executeQuery(listTicketTypesQuery, { eventId }, a.ctx(), ports)).find((t) => t.id === id)
    ?.quantitySold;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: `Door seats ${RUN}`,
        timezone: 'UTC',
        startsAt: '2029-04-01T19:00:00Z',
        endsAt: '2029-04-01T22:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
  stalls = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'Stalls', priceMinor: 3500, quantityTotal: 9 },
      a.ctx(),
      ports,
    )
  ).id;
  standing = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'Standing', priceMinor: 1500, quantityTotal: 20 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(
    setEventLayoutCommand,
    { eventId, doc: { version: 1, width: 1000, height: 400, items: [row] } },
    a.ctx(),
    ports,
  );
  await executeCommand(
    assignSeatCategoryCommand,
    { eventId, seatUuids: row.seats.slice(0, 9).map((s) => s.id), ticketTypeId: stalls },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
});
afterAll(closePools);

describe('box office seat choice (M1.7f)', () => {
  it('needs the seats on sale', async () => {
    await expect(sell([seat(0)])).rejects.toMatchObject({ details: { reason: 'seats_not_on_sale' } });
    await executeCommand(publishEventLayoutCommand, { eventId }, a.ctx(), ports);
  });

  it('sells chosen seats (with a standing pass) in one go; tickets carry their seats; the plan locks', async () => {
    const { order, warnings } = await sell([seat(0), seat(1)], {
      items: [{ ticketTypeId: standing, quantity: 1 }],
    });
    expect(warnings).toEqual([]);
    expect(order.status).toBe('paid');
    expect(order.items.map((i) => [i.name, i.quantity]).sort()).toEqual([
      ['Stalls', 2],
      ['Standing', 1],
    ]);
    expect(order.totalMinor).toBeGreaterThanOrEqual(3500 * 2 + 1500);
    const detail = await executeQuery(orderDetailQuery, { orderId: order.id }, a.ctx(), ports);
    expect(detail.tickets.map((t) => t.seatLabel).sort()).toEqual(['Row B · 1', 'Row B · 2', null]);
    expect([await statusOf(seat(0)), await statusOf(seat(1))]).toEqual(['sold', 'sold']);
    expect((await seating()).status).toBe('locked');
    expect(await soldOf(stalls)).toBe(2);
  });

  it('a seated pass sold by quantity is still refused; an empty sale too', async () => {
    await expect(
      executeCommand(
        recordBoxOfficeSaleCommand,
        {
          eventId,
          items: [{ ticketTypeId: stalls, quantity: 1 }],
          buyer: { email: 'q@example.test', name: 'Q' },
          method: 'cash',
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'choose_seats' } });
    await expect(sell([])).rejects.toMatchObject({ details: { reason: 'empty' } });
  });

  it('a seat held online (or sold) makes the whole sale fail: nothing is sold, the other seat stays free', async () => {
    await executeCommand(
      startCheckoutCommand,
      { eventId, items: [], seats: [seat(2)], buyer: { email: 'online@example.test', name: 'Online' } },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    const before = { orders: await orderCount(), sold: await soldOf(stalls) };
    await expect(sell([seat(3), seat(2)])).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'seats_taken' },
    });
    await expect(sell([seat(0)])).rejects.toMatchObject({ details: { reason: 'seats_taken' } });
    expect(await statusOf(seat(3))).toBe('available');
    expect({ orders: await orderCount(), sold: await soldOf(stalls) }).toEqual(before);
  });

  it('two sales racing for one seat: exactly one wins', async () => {
    const results = await Promise.allSettled([sell([seat(4)]), sell([seat(4)]), sell([seat(4)])]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.flatMap((r) =>
        r.status === 'rejected' ? [(r.reason as { details?: { reason?: string } }).details?.reason] : [],
      ),
    ).toEqual(['seats_taken', 'seats_taken']);
  });

  it('a seat that is not on sale is refused', async () => {
    await expect(sell([seat(9)])).rejects.toMatchObject({ details: { reason: 'seat_not_on_sale' } });
    expect(await statusOf(seat(9))).toBe('available');
  });

  it('seating rules: an enforced cap refuses unless staff override it (audited); warnings come back', async () => {
    await executeCommand(
      setSeatingRulesCommand,
      { eventId, rules: [{ kind: 'max_per_order_seats', severity: 'enforce', params: { max: 1 } }] },
      a.ctx(),
      ports,
    );
    await expect(sell([seat(5), seat(6)])).rejects.toMatchObject({
      details: { reason: 'seat_rule', rule: 'max_per_order_seats', overridable: true },
    });
    expect(await statusOf(seat(5))).toBe('available');
    const { order, warnings } = await sell([seat(5), seat(6)], { overrideRules: true });
    expect(warnings).toEqual([{ rule: 'max_per_order_seats', severity: 'enforce', max: 1, count: 2 }]);
    const [audit] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ data: { overrideRules?: boolean; seats?: number } }>(
        sql`select data from platform.audit_events where action = 'order.box_office_sale' and target_id = ${order.id}`,
      ),
    );
    expect(audit?.data).toMatchObject({ overrideRules: true, seats: 2 });
    await executeCommand(
      setSeatingRulesCommand,
      { eventId, rules: [{ kind: 'max_per_order_seats', severity: 'warn', params: { max: 1 } }] },
      a.ctx(),
      ports,
    );
    expect((await sell([seat(7), seat(8)])).warnings).toEqual([
      { rule: 'max_per_order_seats', severity: 'warn', max: 1, count: 2 },
    ]);
  });

  it('viewers cannot sell; another org cannot sell this event’s seats', async () => {
    await expect(sell([seat(3)], {}, userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(sell([seat(3)], {}, b.ctx())).rejects.toMatchObject({ code: 'not_found' });
    expect(await statusOf(seat(3))).toBe('available');
  });
});
