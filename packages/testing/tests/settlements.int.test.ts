import { setFeeOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  completeRefundCommand,
  startCheckoutCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import {
  addBusinessDays,
  applyAccountEventCommand,
  recordTransferCommand,
  recordTransferReversalCommand,
  releaseDueSettlementsCommand,
  setPayoutHoldCommand,
  settlementsQuery,
} from '@yayatoh/payments';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let ev1: string;
let order1: string;
let tickets1: string[];
let ev2: string;

const at = (iso: string) => ({ ...systemCtx(a.org.id), now: new Date(iso) });
const release = (iso: string) => executeCommand(releaseDueSettlementsCommand, {}, at(iso), ports);
const bal = async (account: string) => {
  const [r] = await withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{ b: string | null }>(
      sql`select sum(amount_minor)::text as b from payments.postings where account = ${account}`,
    ),
  );
  return Number(r?.b ?? 0);
};

const settlementsOf = async (eventId: string) =>
  (await executeQuery(settlementsQuery, {}, systemCtx(a.org.id), ports)).filter((x) => x.eventId === eventId);
const readyFor = <T extends { transferGroup: string }>(ready: T[], eventId: string) =>
  ready.filter((r) => r.transferGroup === `event:${eventId}`);

async function sellEvent(name: string, endsAt: string, quantity: number) {
  const e = await executeCommand(
    createEventCommand,
    { name, timezone: 'UTC', startsAt: endsAt.replace('T22', 'T18'), endsAt },
    a.ctx(),
    ports,
  );
  const tt = await executeCommand(
    createTicketTypeCommand,
    { eventId: e.id, name: 'GA', priceMinor: 5000, quantityTotal: 50 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, a.ctx(), ports);
  const c = await executeCommand(
    startCheckoutCommand,
    {
      eventId: e.id,
      items: [{ ticketTypeId: tt.id, quantity }],
      buyer: { email: 'sam@example.test', name: 'Sam Settle' },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  const pi = `fakepi_settle_${c.order.id}`;
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
      id: `fakeevt_${c.order.id}`,
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
  return { eventId: e.id, orderId: c.order.id };
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  await executeCommand(
    setFeeOverrideCommand,
    { currency: 'USD', percentBps: 1000, fixedMinor: 50, reason: 'test fee' },
    systemCtx(a.org.id),
    ports,
  );
  ({ eventId: ev1, orderId: order1 } = await sellEvent('Settle one', '2028-04-03T22:00:00Z', 2));
  // Sold while the org is still platform_mor (once payouts are active, new sales are organizer_mor).
  ({ eventId: ev2 } = await sellEvent('Settle two', '2028-05-01T22:00:00Z', 3));
  tickets1 = (
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string }>(
        sql`select id from ticketing.tickets where order_id = ${order1} order by serial`,
      ),
    )
  ).map((r) => r.id);
});
afterAll(closePools);

describe('settlements and transfers at release (M1.6c)', () => {
  it('counts 5 business days after the event ends', () => {
    // Monday 3 April 2028 → Monday 10 April; Friday → the next Friday.
    expect(addBusinessDays(new Date('2028-04-03T22:00:00Z'), 5).toISOString()).toBe(
      '2028-04-10T22:00:00.000Z',
    );
    expect(addBusinessDays(new Date('2028-04-07T12:00:00Z'), 5).toISOString()).toBe(
      '2028-04-14T12:00:00.000Z',
    );
  });

  it('holds funds until the release date, then releases less a 5% reserve; without payouts it waits', async () => {
    expect(readyFor((await release('2028-04-07T00:00:00Z')).ready, ev1)).toEqual([]);
    expect(await settlementsOf(ev1)).toEqual([]);
    expect(await bal('org:payable_held')).toBe(-25_000);
    expect(readyFor((await release('2028-04-11T00:00:00Z')).ready, ev1)).toEqual([]);
    const [s] = await settlementsOf(ev1);
    expect(s).toMatchObject({
      kind: 'event',
      eventId: ev1,
      status: 'waiting_account',
      releasedMinor: 10_000,
      reserveMinor: 500,
      nettedMinor: 0,
      amountMinor: 9_500,
    });
    // Event two's funds are still held; the fixture's own order was settled when it was created.
    expect(await bal('org:payable_held')).toBe(-15_000);
    // Running it again releases nothing twice.
    await release('2028-04-12T00:00:00Z');
    expect(await settlementsOf(ev1)).toHaveLength(1);
  });

  it('once payouts are enabled it transfers to the connected account and books it', async () => {
    await executeCommand(
      applyAccountEventCommand,
      {
        provider: 'fake',
        id: `fakeevt_acct_${uuidv7()}`,
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
    const ready = readyFor((await release('2028-04-12T00:00:00Z')).ready, ev1);
    expect(ready).toEqual([
      expect.objectContaining({
        amountMinor: 9_500,
        destinationAccountId: `fakeacct_${a.org.slug}`,
        transferGroup: `event:${ev1}`,
      }),
    ]);
    const settlementId = ready[0]?.settlementId ?? '';
    await executeCommand(
      recordTransferCommand,
      { settlementId, outcome: 'failed', transferId: 'faketr_1', failure: 'account_closed' },
      at('2028-04-12T00:01:00Z'),
      ports,
    );
    expect(readyFor((await release('2028-04-12T00:02:00Z')).ready, ev1).map((r) => r.settlementId)).toEqual([
      settlementId,
    ]);
    expect(
      await executeCommand(
        recordTransferCommand,
        { settlementId, outcome: 'succeeded', transferId: 'faketr_1' },
        at('2028-04-12T00:03:00Z'),
        ports,
      ),
    ).toEqual({ status: 'transferred', changed: true });
    expect(readyFor((await release('2028-04-12T00:04:00Z')).ready, ev1)).toEqual([]);
    const [s] = await settlementsOf(ev1);
    expect(s?.status).toBe('transferred');
  });

  it('a refund after transfer draws on the reserve, then becomes a receivable to reverse', async () => {
    const r = await executeCommand(
      startRefundCommand,
      { orderId: order1, reason: 'requested_by_customer', ticketIds: [tickets1[0]] },
      a.ctx(),
      ports,
    );
    const done = await executeCommand(
      completeRefundCommand,
      { refundId: r.refundId, outcome: 'succeeded', providerRefundId: 'fakere_after' },
      a.ctx(),
      ports,
    );
    expect(done.reversal).toEqual({
      transferId: 'faketr_1',
      amountMinor: 4_500,
      currency: 'USD',
      eventId: ev1,
      orderId: order1,
    });
    expect(await bal('org:receivable')).toBe(4_500);
    // The reversal fails (empty balance): the debt stays a receivable.
    expect(
      await executeCommand(
        recordTransferReversalCommand,
        {
          refundId: r.refundId,
          orderId: order1,
          eventId: ev1,
          outcome: 'failed',
          reversalId: 'faketrr_x',
          amountMinor: 4_500,
          currency: 'USD',
        },
        a.ctx(),
        ports,
      ),
    ).toEqual({ receivableMinor: 4_500 });
  });

  it('the next release nets the receivable before transferring', async () => {
    const eventId = ev2;
    const { ready } = await release('2028-05-09T00:00:00Z');
    const [s] = (await executeQuery(settlementsQuery, {}, systemCtx(a.org.id), ports)).filter(
      (x) => x.eventId === eventId,
    );
    expect(s).toMatchObject({
      releasedMinor: 15_000,
      reserveMinor: 750,
      nettedMinor: 4_500,
      amountMinor: 9_750,
      status: 'ready',
    });
    expect(ready.find((x) => x.settlementId === s?.id)?.amountMinor).toBe(9_750);
    expect(await bal('org:receivable')).toBe(0);
  });

  it('reserves are released after the window; a staff hold stops everything', async () => {
    await executeCommand(
      setPayoutHoldCommand,
      { held: true, reason: 'test hold' },
      systemCtx(a.org.id),
      ports,
    );
    expect(await release('2028-09-01T00:00:00Z')).toEqual({ held: true, ready: [] });
    await executeCommand(
      setPayoutHoldCommand,
      { held: false, reason: 'cleared' },
      systemCtx(a.org.id),
      ports,
    );
    await release('2028-09-01T00:00:00Z');
    const reserves = (await executeQuery(settlementsQuery, {}, systemCtx(a.org.id), ports)).filter(
      (x) => x.kind === 'reserve',
    );
    // Event one's reserve went to the refund; event two's 750 comes back.
    expect(reserves.map((x) => x.releasedMinor).sort((x, y) => x - y)).toEqual([0, 750]);
  });

  it('the books balance, and settlements are for finance only, per org', async () => {
    const [sum] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ s: string }>(sql`select coalesce(sum(amount_minor), 0)::text as s from payments.postings`),
    );
    expect(sum?.s).toBe('0');
    await expect(
      executeQuery(settlementsQuery, {}, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeCommand(releaseDueSettlementsCommand, {}, a.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const seenByB = await executeQuery(settlementsQuery, {}, systemCtx(b.org.id), ports);
    expect(seenByB.some((x) => x.eventId === ev1 || x.eventId === ev2)).toBe(false);
  });
});
