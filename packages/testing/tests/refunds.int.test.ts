import { setFeeOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  completeRefundCommand,
  orderRefundsQuery,
  refundPreviewQuery,
  startCheckoutCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import { createTicketTypeCommand, listTicketTypesQuery } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let typeId: string;
let orderId: string;
let total: number;
let unitFee: number;
let ticketIds: string[];

const q = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  withTenant(systemCtx(a.org.id), (tx) => tx.execute<T>(query));
const orderStatus = async () =>
  (await q<{ status: string }>(sql`select status from orders.orders where id = ${orderId}`))[0]?.status;
const refund = async (input: Record<string, unknown>, outcome: 'succeeded' | 'failed' = 'succeeded') => {
  const r = await executeCommand(startRefundCommand, { orderId, ...input }, a.ctx(), ports);
  await executeCommand(
    completeRefundCommand,
    { refundId: r.refundId, outcome, providerRefundId: `fakere_${r.refundId}` },
    a.ctx(),
    ports,
  );
  return r;
};

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  await executeCommand(
    setFeeOverrideCommand,
    { currency: 'USD', percentBps: 1000, fixedMinor: 50, reason: 'test fee' },
    systemCtx(a.org.id),
    ports,
  );
  const e = await executeCommand(
    createEventCommand,
    { name: 'Refunds', timezone: 'UTC', startsAt: '2028-03-01T18:00:00Z', endsAt: '2028-03-01T22:00:00Z' },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  typeId = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'GA', priceMinor: 5000, quantityTotal: 10 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  const c = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId: typeId, quantity: 3 }],
      buyer: { email: 'rita@example.test', name: 'Rita Refund' },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  orderId = c.order.id;
  total = c.order.totalMinor;
  unitFee = total / 3 - 5000;
  await executeCommand(
    attachPaymentCommand,
    { orderId, provider: 'fake', providerPaymentId: `fakepi_refunds_${orderId}` },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_refunds_${orderId}`,
      type: 'payment.succeeded',
      providerPaymentId: `fakepi_refunds_${orderId}`,
      amountMinor: total,
      currency: 'USD',
      orgId: a.org.id,
      orderId,
    },
    systemCtx(a.org.id),
    ports,
  );
  ticketIds = (
    await q<{ id: string }>(sql`select id from ticketing.tickets where order_id = ${orderId} order by serial`)
  ).map((r) => r.id);
});
afterAll(closePools);

describe('refunds (M1.6b)', () => {
  it('previews by policy: a buyer request keeps the pass-on fee', async () => {
    expect(unitFee).toBe(550);
    expect(total).toBe(3 * 5550);
    const p = await executeQuery(
      refundPreviewQuery,
      { orderId, reason: 'requested_by_customer', ticketIds: [ticketIds[0]] },
      a.ctx(),
      ports,
    );
    expect(p).toEqual({ amountMinor: 5000, feeRefundedMinor: 0, refundableMinor: total, currency: 'USD' });
  });

  it('refunding a ticket voids it, frees the place, cancels the attendee and books the ledger', async () => {
    const [t0] = ticketIds;
    const r = await refund({ reason: 'requested_by_customer', ticketIds: [t0] });
    expect(r).toMatchObject({ amountMinor: 5000, feeRefundedMinor: 0 });
    expect(await orderStatus()).toBe('partially_refunded');
    const [t] = await q<{ status: string; void_reason: string; attendee: string }>(sql`
      select t.status, t.void_reason, a.status as attendee from ticketing.tickets t
      join attendees.attendees a on a.id = t.attendee_id where t.id = ${t0}`);
    expect(t).toEqual({ status: 'void', void_reason: 'refunded', attendee: 'cancelled' });
    const [types] = [await executeQuery(listTicketTypesQuery, { eventId }, a.ctx(), ports)];
    expect(types.find((x) => x.id === typeId)?.quantitySold).toBe(2);
    const [j] = await q<{ n: number; sum: string; held: string }>(sql`
      select count(distinct j.id)::int as n, sum(p.amount_minor)::text as sum,
        sum(p.amount_minor) filter (where p.account = 'org:payable_held')::text as held
      from payments.journal_entries j join payments.postings p on p.journal_id = j.id
      where j.kind = 'refund' and j.ref_id = ${orderId}`);
    expect(j).toEqual({ n: 1, sum: '0', held: '5000' });
    const [evt] = await q<{ n: number }>(
      sql`select count(*)::int as n from platform.domain_events where type = 'order.refunded' and aggregate_id = ${orderId}`,
    );
    expect(evt?.n).toBe(1);
  });

  it('a ticket cannot be refunded twice, nor while a refund for it is pending', async () => {
    await expect(
      executeCommand(
        startRefundCommand,
        { orderId, reason: 'duplicate', ticketIds: [ticketIds[0]] },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    const pending = await executeCommand(
      startRefundCommand,
      { orderId, reason: 'requested_by_customer', ticketIds: [ticketIds[1]] },
      a.ctx(),
      ports,
    );
    await expect(
      executeCommand(
        startRefundCommand,
        { orderId, reason: 'duplicate', ticketIds: [ticketIds[1]] },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    // The provider declines it: nothing else changes, the ticket stays valid, and it can be retried.
    await executeCommand(
      completeRefundCommand,
      {
        refundId: pending.refundId,
        outcome: 'failed',
        providerRefundId: 'fakere_declined',
        failureCode: 'card_expired',
      },
      a.ctx(),
      ports,
    );
    expect(
      await executeCommand(
        completeRefundCommand,
        { refundId: pending.refundId, outcome: 'succeeded', providerRefundId: 'late' },
        a.ctx(),
        ports,
      ),
    ).toEqual({ status: 'failed', changed: false });
    const [t] = await q<{ status: string }>(
      sql`select status from ticketing.tickets where id = ${ticketIds[1]}`,
    );
    expect(t?.status).toBe('active');
  });

  it('amount refunds are capped at what is left; goodwill keeps the fee', async () => {
    await expect(
      executeCommand(startRefundCommand, { orderId, reason: 'goodwill', amountMinor: total }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'exceeds_refundable' } });
    await expect(
      executeCommand(startRefundCommand, { orderId, reason: 'goodwill' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    // Give back the kept fee of the first ticket.
    expect(await refund({ reason: 'goodwill', amountMinor: unitFee })).toMatchObject({ feeRefundedMinor: 0 });
  });

  it('the platform minimum: an event cancellation refunds face and fee, and the order is fully refunded', async () => {
    const r = await refund({ reason: 'event_cancelled', ticketIds: ticketIds.slice(1) });
    expect(r).toMatchObject({ amountMinor: 2 * 5550, feeRefundedMinor: 2 * unitFee });
    expect(await orderStatus()).toBe('refunded');
    const list = await executeQuery(orderRefundsQuery, { orderId }, a.ctx(), ports);
    expect(list.map((x) => x.status).sort()).toEqual(['failed', 'succeeded', 'succeeded', 'succeeded']);
    await expect(
      executeCommand(startRefundCommand, { orderId, reason: 'goodwill', amountMinor: 1 }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    // Everything the buyer paid came back; the ledger nets to zero for this order's cash.
    const [cash] = await q<{ s: string }>(sql`
      select sum(p.amount_minor)::text as s from payments.postings p
      join payments.journal_entries j on j.id = p.journal_id
      where j.ref_id = ${orderId} and p.account = 'platform:stripe_cash'`);
    expect(cash?.s).toBe('0');
  });

  it('only refunders refund, and orgs never see each other’s refunds', async () => {
    await expect(
      executeQuery(
        refundPreviewQuery,
        { orderId, reason: 'goodwill', amountMinor: 1 },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await executeQuery(orderRefundsQuery, { orderId }, b.ctx(), ports)).toEqual([]);
    await expect(
      executeCommand(startRefundCommand, { orderId, reason: 'goodwill', amountMinor: 1 }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
