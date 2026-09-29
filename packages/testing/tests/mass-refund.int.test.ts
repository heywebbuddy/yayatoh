import { setFeeOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  applyDisputeEventCommand,
  applyProviderEventCommand,
  attachPaymentCommand,
  cancellationPreviewQuery,
  completeRefundCommand,
  massRefundStatusQuery,
  massRefundsQuery,
  nextMassRefundStepCommand,
  pauseMassRefundCommand,
  recordBoxOfficeSaleCommand,
  resumeMassRefundCommand,
  runMassRefund,
  startCheckoutCommand,
  startMassRefundCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import { applyAccountEventCommand, fakePaymentProvider, type PaymentProvider } from '@yayatoh/payments';
import { addMemberCommand } from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, staleCtx, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M3.10b acceptance (roadmap M3.10): cancelling an event with 1,000 orders refunds them in a
 * resumable batch, skips disputed charges and reconciles. The batch is interrupted mid-way (the
 * provider refunded, then the process "died" before the database heard), paused and resumed, run
 * in slices, and run again: every order is refunded exactly once.
 */
const ORDERS = 1_000;
const PLATFORM = 700;
const DISPUTED = 25;
/** Slices long enough for the whole batch (the worker's job uses 25 s and is queued again). */
const LONG = 600_000;
// 5000 face + 550 fee (10% + 0.50, passed on) per ticket.
const UNIT = 5550;
const FEE = 550;

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let typeId: string;
let financeId: string;
let runId: string;
const orderIds: string[] = [];
const disputed = new Set<string>();

const q = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>, orgId = a.org.id) =>
  withTenant(systemCtx(orgId), (tx) => tx.execute<T>(query));

async function buy(i: number): Promise<string> {
  const quantity = i % 10 === 0 ? 2 : 1;
  const c = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId: typeId, quantity }],
      buyer: { email: `mass${i}@example.test`, name: `Mass Buyer ${i}` },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  const pi = `fakepi_mass_${c.order.id}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId: c.order.id, provider: 'fake', providerPaymentId: pi },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_mass_${c.order.id}`,
      type: 'payment.succeeded',
      providerPaymentId: pi,
      amountMinor: c.order.totalMinor,
      currency: 'USD',
      orgId: a.org.id,
      orderId: c.order.id,
    },
    systemCtx(a.org.id),
    ports,
  );
  return c.order.id;
}

const dispute = (orderId: string, type: 'dispute.created' | 'dispute.closed', outcome?: 'won' | 'lost') =>
  executeCommand(
    applyDisputeEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_massdp_${type}_${orderId}`,
      type,
      orgId: a.org.id,
      providerPaymentId: `fakepi_mass_${orderId}`,
      providerDisputeId: `fakedp_mass_${orderId}`,
      amountMinor: UNIT,
      currency: 'USD',
      reason: 'product_not_received',
      ...(outcome ? { outcome } : {}),
    },
    systemCtx(a.org.id),
    ports,
  );

/**
 * The fake provider, counting refund calls per idempotency key; `crashAfter` makes the Nth
 * refund succeed at the provider and then throw, as if the process died before recording it.
 */
function countingProvider(crashAfter: number | null = null) {
  const inner = fakePaymentProvider({
    secret: 'mass-refund-test-secret-0123456789abcdef',
    appOrigin: 'https://app.test',
  });
  const calls = new Map<string, number>();
  let n = 0;
  let crashed = false;
  const provider: PaymentProvider = {
    ...inner,
    async refund(i) {
      const r = await inner.refund(i);
      calls.set(i.idempotencyKey, (calls.get(i.idempotencyKey) ?? 0) + 1);
      n += 1;
      if (crashAfter !== null && n === crashAfter && !crashed) {
        crashed = true;
        throw new Error('worker lost after the provider refunded');
      }
      return r;
    },
  };
  return { provider, calls };
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  financeId = uuidv7();
  await executeCommand(addMemberCommand, { userId: financeId, role: 'finance' }, a.ctx(), ports);
  await executeCommand(
    setFeeOverrideCommand,
    { currency: 'USD', percentBps: 1000, fixedMinor: 50, reason: 'test fee' },
    systemCtx(a.org.id),
    ports,
  );
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: 'Mass Night',
        timezone: 'America/Chicago',
        startsAt: '2027-06-05T00:00:00Z',
        endsAt: '2027-06-05T04:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
  typeId = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'GA', priceMinor: 5000, quantityTotal: 2_000 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  // 700 platform charges, then the organizer's account goes live: 300 direct charges.
  for (let i = 0; i < ORDERS; i += 10) {
    if (i === PLATFORM)
      await executeCommand(
        applyAccountEventCommand,
        {
          provider: 'fake',
          id: `fakeevt_mass_acct_${uuidv7()}`,
          type: 'account.updated',
          orgId: a.org.id,
          account: {
            accountId: `fakeacct_${a.org.slug}`,
            chargesEnabled: true,
            payoutsEnabled: true,
            detailsSubmitted: true,
            requirementsDue: [],
            country: 'US',
            defaultCurrency: 'usd',
          },
        },
        systemCtx(a.org.id),
        ports,
      );
    orderIds.push(...(await Promise.all(Array.from({ length: 10 }, (_, k) => buy(i + k)))));
  }
  // 25 open chargebacks (every 40th order), one won (refundable again) and one lost (refunded).
  for (let i = 3; disputed.size < DISPUTED; i += 40) {
    const id = orderIds[i] as string;
    disputed.add(id);
    await dispute(id, 'dispute.created');
  }
  await dispute(orderIds[5] as string, 'dispute.created');
  await dispute(orderIds[5] as string, 'dispute.closed', 'won');
  await dispute(orderIds[6] as string, 'dispute.created');
  await dispute(orderIds[6] as string, 'dispute.closed', 'lost');
  // A goodwill amount already refunded on one order (less than its ticket is left), and one
  // order refunded in full before the cancellation (no longer sold).
  for (const [orderId, input] of [
    [orderIds[7], { reason: 'goodwill', amountMinor: 1_000 }],
    [orderIds[8], { reason: 'duplicate', amountMinor: UNIT }],
  ] as const) {
    const r = await executeCommand(startRefundCommand, { orderId, ...input }, a.ctx(), ports);
    await executeCommand(
      completeRefundCommand,
      { refundId: r.refundId, outcome: 'succeeded', providerRefundId: `fakere_${r.refundId}` },
      a.ctx(),
      ports,
    );
  }
  // A box-office sale: the organizer holds that money and refunds it in person.
  await executeCommand(
    recordBoxOfficeSaleCommand,
    {
      eventId,
      items: [{ ticketTypeId: typeId, quantity: 1 }],
      buyer: { email: 'cash@example.test', name: 'Cash Buyer' },
      method: 'cash',
    },
    a.ctx(),
    ports,
  );
}, 600_000);
afterAll(closePools);

describe('cancellation preview (M3.10b)', () => {
  it('orders, gross, fees, refunds per funds flow; disputed and organizer-collected left out', async () => {
    const p = await executeQuery(cancellationPreviewQuery, { eventId }, userCtx(financeId, a.org.id), ports);
    const tickets = (i: number) => (i % 10 === 0 ? 2 : 1);
    const allTickets = orderIds.reduce((n, _, i) => n + tickets(i), 0);
    const disputedTickets = [...disputed].reduce((n, id) => n + tickets(orderIds.indexOf(id)), 0);
    // Orders 6 (lost dispute) and 8 (refunded in full) are no longer sold; the box-office sale is.
    expect(p.orders).toBe(ORDERS - 2 + 1);
    expect(p.disputed).toEqual({ orders: DISPUTED, grossMinor: disputedTickets * UNIT });
    expect(p.organizerCollected.orders).toBe(1);
    expect(p.nothingLeft).toBe(0);
    const refundable = ORDERS - DISPUTED - 2;
    expect(p.refund.orders).toBe(refundable);
    expect(p.byFlow.platform_mor.orders + p.byFlow.organizer_mor.orders).toBe(refundable);
    expect(p.byFlow.organizer_mor.orders).toBe(
      300 - orderIds.slice(PLATFORM).filter((id) => disputed.has(id)).length,
    );
    // Whole tickets back with their fee, except order 7: after its 10.00 goodwill refund the rest
    // (45.50) goes back as an amount, still with the whole fee (the platform minimum).
    const wholeTickets = allTickets - disputedTickets - 3;
    expect(p.refund.amountMinor).toBe(wholeTickets * UNIT + (UNIT - 1_000));
    expect(p.refund.feeBackMinor).toBe((wholeTickets + 1) * FEE);
    expect(p.refund.organizerMinor).toBe(p.refund.amountMinor - p.refund.feeBackMinor);
    expect(p.currency).toBe('USD');
    await expect(
      executeQuery(cancellationPreviewQuery, { eventId }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeQuery(cancellationPreviewQuery, { eventId }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('resumable mass refund (M3.10b acceptance)', () => {
  it('needs a cancelled event, orders:refund, a fresh step-up, and the org', async () => {
    await expect(executeCommand(startMassRefundCommand, { eventId }, a.ctx(), ports)).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'not_cancelled' },
    });
    await executeCommand(transitionEventCommand, { eventId, transition: 'cancel' }, a.ctx(), ports);
    await expect(
      executeCommand(startMassRefundCommand, { eventId }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(startMassRefundCommand, { eventId }, staleCtx(a.ctx()), ports),
    ).rejects.toMatchObject({ code: 'step_up_required' });
    await expect(executeCommand(startMassRefundCommand, { eventId }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    const started = await executeCommand(
      startMassRefundCommand,
      { eventId },
      userCtx(financeId, a.org.id),
      ports,
    );
    runId = started.runId;
    // Every sold order with money on it is snapshotted: 998 online (orders 6 and 8 are refunded
    // already) plus the box-office sale.
    expect(started.total).toBe(ORDERS - 1);
    await expect(executeCommand(startMassRefundCommand, { eventId }, a.ctx(), ports)).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'already_running' },
    });
  });

  it('only the platform works the batch; other orgs cannot see or steer it', async () => {
    await expect(executeCommand(nextMassRefundStepCommand, { runId }, a.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(executeQuery(massRefundStatusQuery, { runId }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(executeCommand(pauseMassRefundCommand, { runId }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      executeCommand(pauseMassRefundCommand, { runId }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('interrupted mid-way, paused, resumed and run in slices: each order refunded exactly once', {
    timeout: 600_000,
  }, async () => {
    const { provider, calls } = countingProvider(400);
    // The first slice dies right after the provider's 400th refund, before the database heard.
    await expect(runMassRefund(provider, ports, a.org.id, runId, { budgetMs: LONG })).rejects.toThrow(
      'worker lost',
    );
    let s = await executeQuery(massRefundStatusQuery, { runId }, a.ctx(), ports);
    expect(s.status).toBe('running');
    expect(s.refunded).toBe(399);
    const [inFlight] = await q<{ n: number }>(sql`
      select count(*)::int as n from orders.mass_refund_items i join orders.refunds r on r.id = i.refund_id
      where i.run_id = ${runId} and i.status = 'pending' and r.status = 'pending'`);
    expect(inFlight?.n).toBe(1);

    // Paused: the job does nothing until resumed.
    await executeCommand(pauseMassRefundCommand, { runId }, a.ctx(), ports);
    expect(await runMassRefund(provider, ports, a.org.id, runId)).toEqual({
      settled: 0,
      stoppedBy: 'paused',
    });
    s = await executeQuery(massRefundStatusQuery, { runId }, a.ctx(), ports);
    expect(s).toMatchObject({ status: 'paused', refunded: 399 });
    expect(s.pausedAt).not.toBeNull();
    await executeCommand(resumeMassRefundCommand, { runId }, userCtx(financeId, a.org.id), ports);

    // Resumed in slices of 250 orders (the job's budget), until done.
    let slices = 0;
    for (;;) {
      const r = await runMassRefund(provider, ports, a.org.id, runId, { maxItems: 250, budgetMs: LONG });
      slices += 1;
      if (r.stoppedBy === 'done') break;
      expect(r.stoppedBy).toBe('budget');
    }
    expect(slices).toBeGreaterThanOrEqual(3);

    s = await executeQuery(massRefundStatusQuery, { runId }, a.ctx(), ports);
    const refundable = ORDERS - DISPUTED - 2;
    expect(s).toMatchObject({
      status: 'done',
      total: ORDERS - 1,
      processed: ORDERS - 1,
      refunded: refundable,
      skippedDisputed: DISPUTED,
      skipped: 1,
      failed: 0,
    });
    expect(s.finishedAt).not.toBeNull();
    // The crashed refund was asked again with the same key (the provider dedupes it); every other
    // order exactly once.
    expect(calls.size).toBe(refundable);
    expect([...calls.values()].filter((n) => n === 2)).toHaveLength(1);
    expect([...calls.values()].every((n) => n <= 2)).toBe(true);
    const perOrder = await q<{ order_id: string; n: number }>(sql`
      select r.order_id, count(*)::int as n from orders.refunds r
      join orders.mass_refund_items i on i.refund_id = r.id where i.run_id = ${runId}
      group by r.order_id having count(*) > 1`);
    expect(perOrder).toEqual([]);
    expect(s.exceptions.map((e) => e.code).sort()).toEqual([
      ...Array.from({ length: DISPUTED }, () => 'disputed'),
      'organizer_collected',
    ]);
  });

  it('disputed charges are left alone: no refund, tickets still live', async () => {
    const ids = [...disputed];
    const [r] = await q<{ refunds: number; live: number }>(sql`
      select (select count(*)::int from orders.refunds where order_id = any(${sql.param(ids)}::uuid[])) as refunds,
        (select count(*)::int from ticketing.tickets where order_id = any(${sql.param(ids)}::uuid[]) and status = 'active') as live`);
    expect(r?.refunds).toBe(0);
    expect(r?.live).toBe(DISPUTED + ids.filter((id) => orderIds.indexOf(id) % 10 === 0).length);
  });

  it('refunded orders are refunded, their tickets void; the platform minimum gave the fee back', async () => {
    const [r] = await q<{ statuses: string[]; live: number; fee_back: string; won: string }>(sql`
      select array_agg(distinct o.status) as statuses,
        (select count(*)::int from ticketing.tickets t join orders.mass_refund_items i on i.order_id = t.order_id
          where i.run_id = ${runId} and i.status = 'refunded' and t.status = 'active') as live,
        (select sum(r.fee_refunded_minor)::text from orders.refunds r join orders.mass_refund_items i on i.refund_id = r.id
          where i.run_id = ${runId}) as fee_back,
        (select status from orders.orders where id = ${orderIds[5] as string}) as won
      from orders.orders o join orders.mass_refund_items i on i.order_id = o.id
      where i.run_id = ${runId} and i.status = 'refunded'`);
    expect(r?.statuses).toEqual(['refunded']);
    expect(r?.live).toBe(0);
    // The dispute that was won is refunded like any other order.
    expect(r?.won).toBe('refunded');
    const p = await executeQuery(cancellationPreviewQuery, { eventId }, a.ctx(), ports);
    expect(p.refund.orders).toBe(0);
    expect(Number(r?.fee_back)).toBeGreaterThan(0);
  });

  it('reconciles: the ledger moved exactly what was refunded, per funds flow, and nothing is owed', async () => {
    const s = await executeQuery(massRefundStatusQuery, { runId }, a.ctx(), ports);
    // The organizer carries each open chargeback in full, fee included (M1.6d), as it did the lost
    // one and the fee-less duplicate refund before the cancellation: 550 over its share each. The
    // shared held funds run that much short while the run refunds everyone else, and the rest is
    // owed (a receivable, netted from the next release).
    const platformDisputes = orderIds.slice(0, PLATFORM).filter((id) => disputed.has(id)).length;
    expect(s.reconciliation).toMatchObject({
      reconciled: true,
      receivableMinor: (platformDisputes + 2) * FEE,
    });
    expect(s.reconciliation?.ledgerCashMinor).toBe(s.reconciliation?.expectedCashMinor);
    const [sums] = await q<{ platform: string; direct_fee: string; items: string }>(sql`
      select
        sum(r.amount_minor) filter (where o.funds_flow = 'platform_mor')::text as platform,
        sum(r.fee_refunded_minor) filter (where o.funds_flow = 'organizer_mor')::text as direct_fee,
        sum(i.amount_minor)::text as items
      from orders.mass_refund_items i join orders.refunds r on r.id = i.refund_id
      join orders.orders o on o.id = i.order_id where i.run_id = ${runId}`);
    expect(s.reconciliation?.expectedCashMinor).toBe(-(Number(sums?.platform) + Number(sums?.direct_fee)));
    expect(Number(sums?.items)).toBe(s.refundedMinor);
    // Every journal balances; the organizer's debt in the ledger is what the run reported.
    const [books] = await q<{ unbalanced: number; receivable: string | null }>(sql`
      select (select count(*)::int from (select j.id from payments.journal_entries j join payments.postings p on p.journal_id = j.id
          where j.event_id = ${eventId} group by j.id, p.currency having sum(p.amount_minor) <> 0) x) as unbalanced,
        (select sum(p.amount_minor)::text from payments.postings p join payments.journal_entries j on j.id = p.journal_id
          where j.event_id = ${eventId} and j.kind in ('refund', 'transfer_reversal') and p.account = 'org:receivable') as receivable`);
    expect(books?.unbalanced).toBe(0);
    expect(Number(books?.receivable ?? 0)).toBe(s.reconciliation?.receivableMinor);
  });

  it('running it again changes nothing; a new run over the same event only meets the disputed charges', async () => {
    const { provider, calls } = countingProvider();
    expect(await runMassRefund(provider, ports, a.org.id, runId)).toEqual({ settled: 0, stoppedBy: 'done' });
    await expect(executeCommand(resumeMassRefundCommand, { runId }, a.ctx(), ports)).rejects.toMatchObject({
      code: 'invalid_state',
    });
    const again = await executeCommand(startMassRefundCommand, { eventId }, a.ctx(), ports);
    // Still sold: the disputed orders and the box-office sale.
    expect(again.total).toBe(DISPUTED + 1);
    expect(await runMassRefund(provider, ports, a.org.id, again.runId, { budgetMs: LONG })).toMatchObject({
      stoppedBy: 'done',
    });
    expect(calls.size).toBe(0);
    const s = await executeQuery(massRefundStatusQuery, { runId: again.runId }, a.ctx(), ports);
    expect(s).toMatchObject({ refunded: 0, skippedDisputed: DISPUTED, skipped: 1, refundedMinor: 0 });
    expect(s.reconciliation).toMatchObject({ reconciled: true, ledgerCashMinor: 0, expectedCashMinor: 0 });
    const runs = await executeQuery(massRefundsQuery, { eventId }, a.ctx(), ports);
    expect(runs.map((r) => r.id)).toEqual([again.runId, runId]);
    expect(await executeQuery(massRefundsQuery, { eventId }, b.ctx(), ports)).toEqual([]);
  });
});
