import { setFeeOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  addOrderNoteCommand,
  applyProviderEventCommand,
  attachPaymentCommand,
  completeRefundCommand,
  declineRefundRequestCommand,
  orderByManageToken,
  orderDetailQuery,
  orderRefundsQuery,
  postponementMailer,
  refundDeclineMailer,
  refundRequestCountsQuery,
  refundRequestNotifier,
  refundRequestsQuery,
  requestRefundCommand,
  setRefundPolicyCommand,
  startCheckoutCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import { addBusinessDays } from '@yayatoh/payments';
import { consumeEvent, eventKey, memoryNotifier, recentEventsTx } from '@yayatoh/platform';
import { orderTimelineQuery } from '@yayatoh/reports';
import { addMemberCommand } from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M3.10b: buyers ask for refunds from their order page within the policy the order was bought
 * under; organizers answer from a queue with an SLA (approve through the refund command, or
 * decline with a reason the buyer is sent); tightening a policy only reaches later orders; the
 * order timeline; notes; the postponement notice.
 */
let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let typeId: string;
let financeId: string;
// Saturday 1 May 2027, 19:00 in Chicago: "until 7 days before" closes at midnight after 24 April
// (05:00Z on 25 April).
// Everything else happens now (the database's own timestamps must line up with the commands').
const STARTS = '2027-05-02T00:00:00Z';
const CLOSED = new Date('2027-04-25T15:00:00Z');

interface Bought {
  orderId: string;
  token: string;
  ticketIds: string[];
  total: number;
}

const q = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>, orgId = a.org.id) =>
  withTenant(systemCtx(orgId), (tx) => tx.execute<T>(query));
const buyer = (now?: Date) => createCtx({ orgId: a.org.id, ...(now ? { now } : {}) });

async function buy(email: string, quantity: number): Promise<Bought> {
  const c = await executeCommand(
    startCheckoutCommand,
    { eventId, items: [{ ticketTypeId: typeId, quantity }], buyer: { email, name: `Buyer ${email}` } },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  const pi = `fakepi_rr_${c.order.id}`;
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
      id: `fakeevt_rr_${c.order.id}`,
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
  const ticketIds = (
    await q<{ id: string }>(
      sql`select id from ticketing.tickets where order_id = ${c.order.id} order by serial`,
    )
  ).map((r) => r.id);
  return { orderId: c.order.id, token: c.manageToken, ticketIds, total: c.order.totalMinor };
}

const request = (o: Bought, extra: Record<string, unknown> = {}, now?: Date) =>
  executeCommand(requestRefundCommand, { manageToken: o.token, ...extra }, buyer(now), ports);
const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err as { code: string; details?: Record<string, unknown> };
  }
  throw new Error('expected a refusal');
};
const requestsOf = async (orderId: string) => executeQuery(refundRequestsQuery, { orderId }, a.ctx(), ports);

let baseline: { open: number; overdue: number };
let early: Bought;
let second: Bought;
let later: Bought;

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
        name: 'Request Night',
        timezone: 'America/Chicago',
        startsAt: STARTS,
        endsAt: '2027-05-02T04:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
  typeId = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'GA', priceMinor: 5000, quantityTotal: 50 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  // Refunds on request until 7 days before, 1.00 kept per ticket: what the first buyers see.
  await executeCommand(
    setRefundPolicyCommand,
    { eventId, kind: 'until', daysBefore: 7, retainedMinor: 100 },
    a.ctx(),
    ports,
  );
  baseline = await executeQuery(refundRequestCountsQuery, {}, a.ctx(), ports);
  early = await buy('early@example.test', 3);
  second = await buy('second@example.test', 2);
});
afterAll(closePools);

describe('buyer refund requests (M3.10b)', () => {
  it('the policy is snapshotted on the order at purchase', async () => {
    const [row] = await q<{ snapshot: unknown }>(
      sql`select refund_policy_snapshot as snapshot from orders.orders where id = ${early.orderId}`,
    );
    expect(row?.snapshot).toEqual({ kind: 'until', daysBefore: 7, retainedMinor: 100 });
  });

  it('a buyer asks for some of their tickets with a message; the SLA is 5 business days', async () => {
    const r = await request(early, { ticketIds: [early.ticketIds[0]], message: '  Flight cancelled.  ' });
    expect(r).toMatchObject({ status: 'open', tickets: 1, declineReason: null });
    const [row] = await requestsOf(early.orderId);
    expect(row).toMatchObject({
      status: 'open',
      message: 'Flight cancelled.',
      tickets: 1,
      overdue: false,
      buyerEmail: 'early@example.test',
      eventName: 'Request Night',
    });
    if (!row) throw new Error('no request');
    // Five business days (UTC weekdays) from the moment it was asked.
    expect(row.dueAt.toISOString()).toBe(addBusinessDays(row.createdAt, 5).toISOString());
    expect(row.dueAt.getTime() - row.createdAt.getTime()).toBeGreaterThanOrEqual(5 * 86_400_000);
    // The fixture's own order has an open request too (createOrgFixture).
    const counts = await executeQuery(refundRequestCountsQuery, {}, a.ctx(), ports);
    expect(counts).toEqual({ open: baseline.open + 1, overdue: 0 });
    // Past the SLA: overdue in the queue and the counts.
    const late = a.ctx({ now: new Date(row.dueAt.getTime() + 1_000) });
    expect((await executeQuery(refundRequestsQuery, { eventId }, late, ports))[0]?.overdue).toBe(true);
    expect(await executeQuery(refundRequestCountsQuery, {}, late, ports)).toEqual({
      open: baseline.open + 1,
      overdue: baseline.open + 1,
    });
  });

  it('one open request per order; unknown tickets, tokens and other orgs are refused', async () => {
    expect(await refusal(request(early))).toMatchObject({
      code: 'conflict',
      details: { reason: 'request_open' },
    });
    expect(await refusal(request(second, { ticketIds: [early.ticketIds[1]] }))).toMatchObject({
      code: 'validation_failed',
    });
    expect(
      await refusal(executeCommand(requestRefundCommand, { manageToken: 'x'.repeat(43) }, buyer(), ports)),
    ).toMatchObject({ code: 'not_found' });
    // The token resolves only under its own org (RLS): another org's context finds nothing.
    expect(
      await refusal(
        executeCommand(
          requestRefundCommand,
          { manageToken: second.token },
          createCtx({ orgId: b.org.id }),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'not_found' });
  });

  it('outside the window the request is refused with the deadline', async () => {
    expect(await refusal(request(second, {}, CLOSED))).toMatchObject({
      code: 'invalid_state',
      details: { reason: 'policy_window_closed', deadline: '2027-04-25T05:00:00.000Z' },
    });
  });

  it('owners, admins and finance see the queue and a count; viewers read it but cannot answer; other orgs see none', async () => {
    expect(
      await executeQuery(refundRequestsQuery, { eventId }, userCtx(a.viewerId, a.org.id), ports),
    ).toHaveLength(1);
    expect(
      await executeQuery(refundRequestsQuery, { eventId }, userCtx(financeId, a.org.id), ports),
    ).toHaveLength(1);
    expect(await executeQuery(refundRequestsQuery, { eventId }, b.ctx(), ports)).toHaveLength(0);
    // Org B's queue holds only its own fixture request.
    const theirs = await executeQuery(refundRequestsQuery, {}, b.ctx(), ports);
    expect(theirs.every((r) => r.eventId === b.event.id)).toBe(true);
    const [req] = await requestsOf(early.orderId);
    await expect(
      executeCommand(
        declineRefundRequestCommand,
        { requestId: req?.id, reason: 'No thanks' },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        declineRefundRequestCommand,
        { requestId: req?.id, reason: 'No thanks' },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(
        startRefundCommand,
        {
          orderId: early.orderId,
          reason: 'requested_by_customer',
          ticketIds: [early.ticketIds[0]],
          refundRequestId: req?.id,
        },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('the organizer is alerted (owners, admins, finance)', async () => {
    const memory = memoryNotifier();
    const events = await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, ['order.refund_requested'], 3_600_000),
    );
    const sub = refundRequestNotifier({ notifier: memory.notifier });
    for (const e of events.filter((x) => (x.payload as { eventId?: string }).eventId === eventId))
      if (sub.events.includes(eventKey(e))) await consumeEvent(sub, e);
    expect(memory.members).toHaveLength(1);
    expect(memory.members[0]).toMatchObject({
      kind: 'orders.refund-requested',
      params: { name: 'Buyer early@example.test', eventName: 'Request Night', count: 1 },
      href: '/refund-requests',
    });
  });

  it('approving is the refund itself, under the policy the order was bought under; it is answered once', async () => {
    const [req] = await requestsOf(early.orderId);
    if (!req) throw new Error('no request');
    const started = await executeCommand(
      startRefundCommand,
      {
        orderId: early.orderId,
        reason: 'requested_by_customer',
        ticketIds: req.ticketIds,
        refundRequestId: req.id,
      },
      userCtx(financeId, a.org.id),
      ports,
    );
    // 5000 face (the 550 fee is kept on a buyer's request), less the 100 kept by the policy.
    expect(started).toMatchObject({ amountMinor: 4900, retainedMinor: 100 });
    await executeCommand(
      completeRefundCommand,
      { refundId: started.refundId, outcome: 'succeeded', providerRefundId: `fakere_${started.refundId}` },
      a.ctx(),
      ports,
    );
    const [after] = await requestsOf(early.orderId);
    expect(after).toMatchObject({
      status: 'approved',
      refund: { id: started.refundId, amountMinor: 4900, status: 'succeeded' },
    });
    expect(
      await refusal(
        executeCommand(
          startRefundCommand,
          { orderId: early.orderId, reason: 'goodwill', amountMinor: 100, refundRequestId: req.id },
          a.ctx(),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'conflict', details: { reason: 'request_answered' } });
    const [audit] = await q<{ data: { refundRequestId?: string } }>(
      sql`select data from platform.audit_events where action = 'order.refund_start' and data->>'refundId' = ${started.refundId}`,
    );
    expect(audit?.data.refundRequestId).toBe(req.id);
  });

  it('a request asked in time is still approved after the window closed (the policy as it stood then)', async () => {
    const waiting = await buy('waiting@example.test', 1);
    await request(waiting);
    const [req] = await requestsOf(waiting.orderId);
    // Without the request, the same refund after the deadline is refused.
    expect(
      await refusal(
        executeCommand(
          startRefundCommand,
          { orderId: waiting.orderId, reason: 'requested_by_customer', ticketIds: waiting.ticketIds },
          a.ctx({ now: CLOSED }),
          ports,
        ),
      ),
    ).toMatchObject({ details: { reason: 'policy_window_closed' } });
    const started = await executeCommand(
      startRefundCommand,
      {
        orderId: waiting.orderId,
        reason: 'requested_by_customer',
        ticketIds: waiting.ticketIds,
        refundRequestId: req?.id,
      },
      a.ctx({ now: CLOSED }),
      ports,
    );
    expect(started).toMatchObject({ amountMinor: 4900, retainedMinor: 100 });
    await executeCommand(
      completeRefundCommand,
      { refundId: started.refundId, outcome: 'succeeded', providerRefundId: `fakere_${started.refundId}` },
      a.ctx(),
      ports,
    );
  });

  it('a partial approval the provider declines reopens the request', async () => {
    const r = await request(second);
    expect(r.tickets).toBe(2);
    const [req] = await requestsOf(second.orderId);
    const started = await executeCommand(
      startRefundCommand,
      { orderId: second.orderId, reason: 'goodwill', amountMinor: 2000, refundRequestId: req?.id },
      a.ctx(),
      ports,
    );
    expect((await requestsOf(second.orderId))[0]?.status).toBe('approved');
    await executeCommand(
      completeRefundCommand,
      { refundId: started.refundId, outcome: 'failed', providerRefundId: `fakere_${started.refundId}` },
      a.ctx(),
      ports,
    );
    expect((await requestsOf(second.orderId))[0]).toMatchObject({
      status: 'open',
      refund: null,
      decidedAt: null,
    });
  });

  it('declining needs a reason; the buyer sees it on their order page and is emailed it', async () => {
    const [req] = await requestsOf(second.orderId);
    await expect(
      executeCommand(declineRefundRequestCommand, { requestId: req?.id, reason: 'no' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await executeCommand(
      declineRefundRequestCommand,
      { requestId: req?.id, reason: 'Tickets are transferable; please pass them on.' },
      a.ctx(),
      ports,
    );
    expect((await requestsOf(second.orderId))[0]).toMatchObject({
      status: 'declined',
      declineReason: 'Tickets are transferable; please pass them on.',
    });
    await expect(
      executeCommand(declineRefundRequestCommand, { requestId: req?.id, reason: 'Again' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'conflict' });
    const page = await orderByManageToken(second.token);
    expect(page?.refundRequest).toMatchObject({
      latest: { status: 'declined', declineReason: 'Tickets are transferable; please pass them on.' },
    });
    const memory = memoryNotifier();
    const sub = refundDeclineMailer({ notifier: memory.notifier, appOrigin: 'https://app.test' });
    const events = await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, ['order.refund_request_declined'], 3_600_000),
    );
    for (const e of events.filter((x) => (x.payload as { orderId?: string }).orderId === second.orderId))
      if (sub.events.includes(eventKey(e))) await consumeEvent(sub, e);
    expect(memory.sent).toHaveLength(1);
    expect(memory.sent[0]).toMatchObject({
      kind: 'orders.refund-declined',
      to: { email: 'second@example.test' },
      params: { eventName: 'Request Night', reason: 'Tickets are transferable; please pass them on.' },
    });
    expect(String(memory.sent[0]?.params.url)).toMatch(/^https:\/\/app\.test\/orders\/[A-Za-z0-9_-]{43}$/);
  });
});

describe('policy tightening applies to future orders only (M3.10b)', () => {
  it('tightening says so and counts the orders that keep their terms', async () => {
    const r = await executeCommand(setRefundPolicyCommand, { eventId, kind: 'none' }, a.ctx(), ports);
    // early, second and waiting (partly refunded) were bought under the old policy.
    expect(r).toMatchObject({ kind: 'none', tightened: true, ordersKeepingTerms: 3 });
    const loosened = await executeCommand(
      setRefundPolicyCommand,
      { eventId, kind: 'until', daysBefore: 3, retainedMinor: 0 },
      a.ctx(),
      ports,
    );
    expect(loosened).toMatchObject({ tightened: false, ordersKeepingTerms: 0 });
    await executeCommand(setRefundPolicyCommand, { eventId, kind: 'none' }, a.ctx(), ports);
  });

  it('an order bought before keeps its terms; one bought after follows the new policy', async () => {
    later = await buy('later@example.test', 1);
    // Bought under "no refunds": the buyer cannot ask.
    expect(await refusal(request(later))).toMatchObject({ details: { reason: 'policy_no_refunds' } });
    const page = await orderByManageToken(later.token);
    expect(page?.refundPolicy).toMatchObject({ kind: 'none' });
    expect(page?.refundRequest).toMatchObject({ canRequest: false, refusal: 'policy_no_refunds' });
    // Bought under "until 7 days, 1.00 kept": still so, on the page and in the refund.
    const kept = await orderByManageToken(second.token);
    expect(kept?.refundPolicy).toMatchObject({ kind: 'until', daysBefore: 7, retainedMinor: 100 });
    expect(kept?.refundRequest).toMatchObject({ canRequest: true, refusal: null });
    const detail = await executeQuery(orderDetailQuery, { orderId: second.orderId }, a.ctx(), ports);
    expect(detail.refundPolicy).toMatchObject({ kind: 'until', daysBefore: 7 });
    const r = await executeCommand(
      startRefundCommand,
      { orderId: second.orderId, reason: 'requested_by_customer', ticketIds: [second.ticketIds[0]] },
      a.ctx(),
      ports,
    );
    expect(r).toMatchObject({ amountMinor: 4900, retainedMinor: 100 });
    await executeCommand(
      completeRefundCommand,
      { refundId: r.refundId, outcome: 'succeeded', providerRefundId: `fakere_${r.refundId}` },
      a.ctx(),
      ports,
    );
  });

  it('a loosening reaches every order', async () => {
    await executeCommand(
      setRefundPolicyCommand,
      { eventId, kind: 'always', retainedMinor: 0 },
      a.ctx(),
      ports,
    );
    expect((await orderByManageToken(later.token))?.refundRequest).toMatchObject({ canRequest: true });
    expect((await orderByManageToken(second.token))?.refundPolicy).toMatchObject({ kind: 'always' });
    const r = await request(later);
    expect(r.status).toBe('open');
  });

  it('a full refund answers an open request', async () => {
    const [req] = await requestsOf(later.orderId);
    const started = await executeCommand(
      startRefundCommand,
      { orderId: later.orderId, reason: 'duplicate', ticketIds: later.ticketIds },
      a.ctx(),
      ports,
    );
    await executeCommand(
      completeRefundCommand,
      { refundId: started.refundId, outcome: 'succeeded', providerRefundId: `fakere_${started.refundId}` },
      a.ctx(),
      ports,
    );
    expect((await requestsOf(later.orderId)).find((x) => x.id === req?.id)).toMatchObject({
      status: 'approved',
      refund: { id: started.refundId },
    });
  });
});

describe('order timeline and notes (M3.10b)', () => {
  it('notes need orders:note; viewers cannot add them; other orgs cannot reach the order', async () => {
    await expect(
      executeCommand(
        addOrderNoteCommand,
        { orderId: early.orderId, body: 'x' },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(addOrderNoteCommand, { orderId: early.orderId, body: 'x' }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(addOrderNoteCommand, { orderId: early.orderId, body: '   ' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await executeCommand(
      addOrderNoteCommand,
      { orderId: early.orderId, body: 'Buyer called about the flight.' },
      userCtx(financeId, a.org.id),
      ports,
    );
  });

  it('purchase, payment, tickets, request, refund and notes in time order, in the event timezone', async () => {
    const t = await executeQuery(
      orderTimelineQuery,
      { orderId: early.orderId },
      userCtx(a.viewerId, a.org.id),
      ports,
    );
    expect(t.timezone).toBe('America/Chicago');
    const kinds = t.items.map((i) => i.kind);
    expect(kinds.slice(0, 2)).toEqual(['order_placed', 'payment_received']);
    for (const k of [
      'ticket_issued',
      'refund_requested',
      'refund_request_approved',
      'refund_started',
      'refund_succeeded',
      'ticket_voided',
      'note',
    ] as const)
      expect(kinds).toContain(k);
    expect(kinds.filter((k) => k === 'ticket_issued')).toHaveLength(3);
    const times = t.items.map((i) => i.at.getTime());
    expect([...times].sort((x, y) => x - y)).toEqual(times);
    expect(t.items.find((i) => i.kind === 'refund_requested')?.text).toBe('Flight cancelled.');
    expect(t.items.find((i) => i.kind === 'ticket_voided')).toMatchObject({
      code: 'refunded',
      ticketSerial: 1,
    });
    expect(t.items.find((i) => i.kind === 'refund_succeeded')).toMatchObject({ amountMinor: 4900 });
    expect(t.items.at(-1)).toMatchObject({ kind: 'note', text: 'Buyer called about the flight.' });
    // Allowlisted: nothing but the declared fields leaves.
    for (const i of t.items)
      expect(Object.keys(i).sort()).toEqual([
        'amountMinor',
        'at',
        'code',
        'kind',
        'text',
        'ticketSerial',
        'who',
      ]);
    await expect(
      executeQuery(orderTimelineQuery, { orderId: early.orderId }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await executeQuery(orderRefundsQuery, { orderId: early.orderId }, a.ctx(), ports)).toHaveLength(1);
  });
});

describe('postponement (M3.10b)', () => {
  it('postponing tells every buyer with a live order, once, that tickets stay valid', async () => {
    await executeCommand(transitionEventCommand, { eventId, transition: 'postpone' }, a.ctx(), ports);
    const memory = memoryNotifier();
    const sub = postponementMailer({ notifier: memory.notifier, appOrigin: 'https://app.test' });
    const events = await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, ['event.postponed'], 3_600_000),
    );
    const mine = events.filter((e) => (e.payload as { eventId?: string }).eventId === eventId);
    expect(mine).toHaveLength(1);
    for (const e of mine) await consumeEvent(sub, e);
    for (const e of mine) await consumeEvent(sub, e);
    // early and second still hold tickets; waiting and later hold none any more.
    expect(memory.sent.map((s) => s.to.email).sort()).toEqual(['early@example.test', 'second@example.test']);
    expect(memory.sent[0]).toMatchObject({
      kind: 'events.postponed',
      params: { eventName: 'Request Night' },
    });
    await executeCommand(transitionEventCommand, { eventId, transition: 'reschedule' }, a.ctx(), ports);
  });
});
