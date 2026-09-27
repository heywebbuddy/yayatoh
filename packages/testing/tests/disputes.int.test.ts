import { setFeeOverrideCommand } from '@yayatoh/billing';
import { scanTicketCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  applyDisputeEventCommand,
  applyProviderEventCommand,
  attachPaymentCommand,
  startCheckoutCommand,
} from '@yayatoh/orders';
import { disputesQuery, markEvidenceSubmittedCommand } from '@yayatoh/payments';
import { disputeEvidenceHtml } from '@yayatoh/pdf';
import { disputeEvidenceQuery, evidenceDocument } from '@yayatoh/reports';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let typeId: string;

const q = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  withTenant(systemCtx(a.org.id), (tx) => tx.execute<T>(query));
const held = async () =>
  Number(
    (
      await q<{ b: string | null }>(sql`
        select sum(p.amount_minor)::text as b from payments.postings p
        join payments.journal_entries j on j.id = p.journal_id
        where p.account = 'org:payable_held' and j.event_id = ${eventId}`)
    )[0]?.b ?? 0,
  );
const receivable = async () =>
  Number(
    (
      await q<{ b: string | null }>(
        sql`select sum(amount_minor)::text as b from payments.postings where account = 'org:receivable'`,
      )
    )[0]?.b ?? 0,
  );

async function paidOrder(buyer: string, emailName = buyer.replace(/\W/g, '').toLowerCase()) {
  const c = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId: typeId, quantity: 2 }],
      buyer: { email: `${emailName}@example.test`, name: buyer },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  const pi = `fakepi_dispute_${c.order.id}`;
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
      id: `fakeevt_${pi}`,
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
  return { orderId: c.order.id, total: c.order.totalMinor, pi };
}

const dispute = (
  pi: string,
  amount: number,
  type: 'dispute.created' | 'dispute.closed',
  extra: Record<string, unknown> = {},
) =>
  executeCommand(
    applyDisputeEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_${uuidv7()}`,
      type,
      orgId: a.org.id,
      providerPaymentId: pi,
      providerDisputeId: `fakedp_${pi}`,
      amountMinor: amount,
      currency: 'USD',
      reason: 'fraudulent',
      ...extra,
    },
    systemCtx(a.org.id),
    ports,
  );

let first: Awaited<ReturnType<typeof paidOrder>>;
let disputeId: string;

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
    {
      name: 'Disputed gala',
      timezone: 'UTC',
      startsAt: '2028-06-01T18:00:00Z',
      endsAt: '2028-06-01T22:00:00Z',
    },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  typeId = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'GA', priceMinor: 5000, quantityTotal: 20 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  first = await paidOrder('Dana "D" & O\'Dispute');
});
afterAll(closePools);

describe('disputes (M1.6d)', () => {
  it('a dispute places the hold: held funds first, then a receivable', async () => {
    expect(await held()).toBe(-10_000);
    expect(
      await dispute(first.pi, first.total, 'dispute.created', { evidenceDueBy: '2028-07-01T00:00:00Z' }),
    ).toEqual({
      outcome: 'applied',
      status: 'open',
    });
    expect(await held()).toBe(0);
    expect(await receivable()).toBe(first.total - 10_000);
    const [d] = await executeQuery(disputesQuery, { orderId: first.orderId }, a.ctx(), ports);
    expect(d).toMatchObject({ status: 'open', amountMinor: first.total, fundsFlow: 'platform_mor' });
    disputeId = d?.id ?? '';
    const [evt] = await q<{ n: number }>(
      sql`select count(*)::int as n from platform.domain_events where type = 'order.disputed' and aggregate_id = ${first.orderId}`,
    );
    expect(evt?.n).toBe(1);
    // A redelivered webhook changes nothing.
    await dispute(first.pi, first.total, 'dispute.created', { id: 'fakeevt_same' });
    expect((await dispute(first.pi, first.total, 'dispute.created', { id: 'fakeevt_same' })).outcome).toBe(
      'duplicate',
    );
    expect(await held()).toBe(0);
  });

  it('builds the evidence packet: order, event, admissions, refund policy, escaped in the PDF', async () => {
    const [ticket] = await q<{ short_code: string }>(
      sql`select short_code from ticketing.tickets where order_id = ${first.orderId} order by serial limit 1`,
    );
    await executeCommand(
      scanTicketCommand,
      { eventId, code: ticket?.short_code ?? '' },
      a.ctx({ now: new Date('2028-06-01T18:30:00Z') }),
      ports,
    );
    const ev = await executeQuery(disputeEvidenceQuery, { disputeId }, a.ctx(), ports);
    expect(ev.order).toMatchObject({ buyerName: 'Dana "D" & O\'Dispute', totalMinor: first.total });
    expect(ev.tickets.map((t) => t.admittedAt.length).sort()).toEqual([0, 1]);
    expect(ev.refundPolicy?.body).toContain('Refunds for');
    expect(ev.seller).toEqual({ name: 'Alpha Events', fundsFlow: 'platform_mor' });
    const doc = evidenceDocument(ev, {
      locale: 'en',
      label: (k, v) => `${k}${v ? JSON.stringify(v) : ''}`,
      money: (m, c) => `${c} ${m}`,
    });
    const out = disputeEvidenceHtml(doc);
    expect(out).toContain('Dana &quot;D&quot; &amp; O&#39;Dispute');
    expect(out).not.toContain('"D"');
  });

  it('only staff submit evidence, once', async () => {
    await expect(
      executeCommand(markEvidenceSubmittedCommand, { disputeId }, a.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(
      (await executeCommand(markEvidenceSubmittedCommand, { disputeId }, systemCtx(a.org.id), ports)).status,
    ).toBe('evidence_submitted');
    await expect(
      executeCommand(markEvidenceSubmittedCommand, { disputeId }, systemCtx(a.org.id), ports),
    ).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });

  it('won: the hold is undone exactly', async () => {
    await dispute(first.pi, first.total, 'dispute.closed', { outcome: 'won' });
    expect(await held()).toBe(-10_000);
    expect(await receivable()).toBe(0);
    const [d] = await executeQuery(disputesQuery, { orderId: first.orderId }, a.ctx(), ports);
    expect(d?.status).toBe('won');
  });

  it('lost: the buyer keeps the money, the tickets stop working and the order counts as refunded', async () => {
    const second = await paidOrder('Lou Lost');
    await dispute(second.pi, second.total, 'dispute.created');
    await dispute(second.pi, second.total, 'dispute.closed', { outcome: 'lost' });
    const tickets = await q<{ status: string; void_reason: string }>(
      sql`select status, void_reason from ticketing.tickets where order_id = ${second.orderId}`,
    );
    expect(tickets).toEqual([
      { status: 'void', void_reason: 'dispute_lost' },
      { status: 'void', void_reason: 'dispute_lost' },
    ]);
    const [o] = await q<{ status: string }>(
      sql`select status from orders.orders where id = ${second.orderId}`,
    );
    expect(o?.status).toBe('refunded');
    const [sum] = await q<{ s: string }>(
      sql`select coalesce(sum(amount_minor), 0)::text as s from payments.postings`,
    );
    expect(sum?.s).toBe('0');
  });

  it('refuses a close for an unknown dispute, and keeps disputes to finance, per org', async () => {
    const third = await paidOrder('Olly Order');
    await expect(dispute(third.pi, third.total, 'dispute.closed', { outcome: 'won' })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(executeQuery(disputesQuery, {}, userCtx(a.viewerId, a.org.id), ports)).rejects.toMatchObject(
      { code: 'forbidden' },
    );
    await expect(executeQuery(disputeEvidenceQuery, { disputeId }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect((await executeQuery(disputesQuery, {}, b.ctx(), ports)).some((d) => d.id === disputeId)).toBe(
      false,
    );
  });
});
