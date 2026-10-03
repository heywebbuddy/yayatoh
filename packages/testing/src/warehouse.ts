import { catchUpWarehouse } from '@yayatoh/analytics';
import { scanTicketCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  completeRefundCommand,
  startCheckoutCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { ports } from './ports.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * M6.2a: an org's warehouse scenario for the analytics e2e (fixed figures in a fresh org):
 * - a USD event happening now: two paid orders (2 + 1 tickets), a comp order (2 free tickets),
 *   one paid ticket refunded, one ticket checked in;
 * - a EUR event next week: one paid order of 2 tickets and a goodwill refund of €5.00;
 * - a USD event that ended two days ago: one paid order of 2 tickets nobody checked in (2 no-shows);
 * then the warehouse ingests the org's outbox. Returns the expected figures; money is read back
 * from the orders (fees passed on are inside the totals).
 */
export async function warehouseScenario(orgId: string, now = new Date()) {
  const sys = (at = now, key?: string) =>
    createCtx({
      orgId,
      actor: { type: 'system', name: 'warehouse-scenario' },
      now: at,
      ...(key ? { idempotencyKey: key } : {}),
    });
  const anon = (at = now) => createCtx({ orgId, now: at });
  const stamp = uuidv7().slice(-10);

  async function event(name: string, currency: string, startsAt: Date, at = now) {
    const e = await executeCommand(
      createEventCommand,
      {
        name,
        slug: `wh-${stamp}-${name
          .toLowerCase()
          .replace(/[^a-z]+/g, '-')
          .replace(/^-|-$/g, '')}`,
        timezone: 'UTC',
        currency,
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 4 * HOUR).toISOString(),
      },
      sys(at),
      ports,
    );
    return e;
  }
  const type = async (eventId: string, name: string, priceMinor: number, at = now) =>
    (
      await executeCommand(
        createTicketTypeCommand,
        { eventId, name, priceMinor, quantityTotal: 50 },
        sys(at),
        ports,
      )
    ).id;
  const publish = (eventId: string, at = now) =>
    executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, sys(at), ports);
  async function buy(eventId: string, ticketTypeId: string, quantity: number, currency: string, at = now) {
    const c = await executeCommand(
      startCheckoutCommand,
      {
        eventId,
        items: [{ ticketTypeId, quantity }],
        buyer: { email: `wh-${uuidv7().slice(-8)}@example.test`, name: 'Warehouse Buyer' },
      },
      anon(at),
      ports,
    );
    if (c.order.totalMinor === 0) return c.order.id;
    const pi = `fakepi_wh_${uuidv7()}`;
    await executeCommand(
      attachPaymentCommand,
      { orderId: c.order.id, provider: 'fake', providerPaymentId: pi },
      anon(at),
      ports,
    );
    await executeCommand(
      applyProviderEventCommand,
      {
        provider: 'fake',
        id: `fakeevt_${pi}`,
        type: 'payment.succeeded',
        providerPaymentId: pi,
        amountMinor: c.order.totalMinor,
        currency,
        orgId,
        orderId: c.order.id,
      },
      sys(at),
      ports,
    );
    return c.order.id;
  }
  async function refund(orderId: string, input: Record<string, unknown>) {
    const r = await executeCommand(startRefundCommand, { orderId, ...input }, sys(now, uuidv7()), ports);
    await executeCommand(
      completeRefundCommand,
      { refundId: r.refundId, outcome: 'succeeded', providerRefundId: `fakere_${r.refundId}` },
      sys(),
      ports,
    );
  }
  const tickets = (orderId: string) =>
    withTenant(sys(), (tx) =>
      tx.execute<{ id: string; short_code: string }>(
        sql`select id, short_code from ticketing.tickets where order_id = ${orderId}::uuid order by serial`,
      ),
    );

  const live = await event('Harbour Lights', 'USD', new Date(now.getTime() - HOUR));
  const ga = await type(live.id, 'General', 4000);
  const free = await type(live.id, 'Guest pass', 0);
  await publish(live.id);
  const o1 = await buy(live.id, ga, 2, 'USD');
  const o2 = await buy(live.id, ga, 1, 'USD');
  await buy(live.id, free, 2, 'USD');
  const [t1] = await tickets(o1);
  await refund(o1, { reason: 'requested_by_customer', ticketIds: [t1?.id] });
  const [t2] = await tickets(o2);
  await executeCommand(scanTicketCommand, { eventId: live.id, code: t2?.short_code ?? '' }, sys(), ports);

  const eur = await event('Nuit d’été', 'EUR', new Date(now.getTime() + 7 * DAY));
  const entree = await type(eur.id, 'Entrée', 3000);
  await publish(eur.id);
  const e1 = await buy(eur.id, entree, 2, 'EUR');
  await refund(e1, { reason: 'goodwill', amountMinor: 500 });

  const then = new Date(now.getTime() - 3 * DAY);
  const past = await event('Spring Gala', 'USD', new Date(now.getTime() - 2 * DAY), then);
  const seat = await type(past.id, 'Seat', 2500, then);
  await publish(past.id, then);
  await buy(past.id, seat, 2, 'USD', then);

  await catchUpWarehouse(orgId);
  const money = await withTenant(sys(), (tx) =>
    tx.execute<{ currency: string; gross: string; refunds: string }>(sql`
      select o.currency, sum(o.total_minor)::text as gross,
        coalesce((select sum(r.amount_minor) from orders.refunds r join orders.orders x on x.id = r.order_id
          where r.status = 'succeeded' and x.currency = o.currency), 0)::text as refunds
      from orders.orders o where o.status in ('paid', 'partially_refunded', 'refunded') group by 1 order by 1`),
  );
  return {
    events: { live, eur, past },
    expected: {
      registrations: 5,
      tickets: 6,
      compTickets: 2,
      checkins: 1,
      noShows: 2,
      liveRegistrations: 3,
      net: Object.fromEntries(money.map((m) => [m.currency, Number(m.gross) - Number(m.refunds)])) as Record<
        string,
        number
      >,
    },
  };
}
