import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { orderByManageToken, startCheckoutCommand } from '@yayatoh/orders';
import {
  applyAccountEventCommand,
  payoutAccountIdQuery,
  payoutAccountQuery,
  recordPayoutAccountCommand,
} from '@yayatoh/payments';
import { addMemberCommand } from '@yayatoh/tenancy';
import { listTicketTypesQuery } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
const acct = (o: OrgFixture) => `fakeacct_${o.org.slug}`;

const accountEvent = (
  o: OrgFixture,
  over: Partial<{
    id: string;
    accountId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    requirementsDue: string[];
  }> = {},
) => ({
  provider: 'fake' as const,
  id: over.id ?? `fakeevt_${uuidv7()}`,
  type: 'account.updated' as const,
  orgId: o.org.id,
  account: {
    accountId: over.accountId ?? acct(o),
    chargesEnabled: over.chargesEnabled ?? false,
    payoutsEnabled: over.payoutsEnabled ?? false,
    detailsSubmitted: over.detailsSubmitted ?? false,
    requirementsDue: over.requirementsDue ?? [],
    country: 'US',
    defaultCurrency: 'usd',
  },
});
const apply = (o: OrgFixture, e: ReturnType<typeof accountEvent>) =>
  executeCommand(applyAccountEventCommand, e, systemCtx(o.org.id), ports);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

describe('payout accounts (M1.3c)', () => {
  it('starts in onboarding: orders stay platform_mor', async () => {
    expect(await executeQuery(payoutAccountQuery, {}, a.ctx(), ports)).toEqual({
      state: 'pending',
      provider: 'fake',
      requirementsDue: [],
      country: 'US',
      fundsFlow: 'platform_mor',
      onHold: false,
      // Just connected: the 24 h hold on a new payout destination (M1.2c).
      destinationHoldUntil: expect.any(Date),
    });
  });

  it('recording is idempotent for the same account and refuses a second one', async () => {
    const same = { provider: 'fake' as const, accountId: acct(a), country: 'US' };
    expect(await executeCommand(recordPayoutAccountCommand, same, a.ctx(), ports)).toEqual({
      accountId: acct(a),
    });
    await expect(
      executeCommand(recordPayoutAccountCommand, { ...same, accountId: 'fakeacct_other' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('only owners, admins and finance manage payouts', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    await expect(executeQuery(payoutAccountIdQuery, {}, viewer, ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const financeId = uuidv7();
    await executeCommand(addMemberCommand, { userId: financeId, role: 'finance' }, a.ctx(), ports);
    expect(await executeQuery(payoutAccountIdQuery, {}, userCtx(financeId, a.org.id), ports)).toEqual({
      accountId: acct(a),
    });
  });

  it('webhooks are system-only', async () => {
    await expect(
      executeCommand(applyAccountEventCommand, accountEvent(a), a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('an org cannot touch another org’s account through a webhook', async () => {
    expect(
      await apply(b, accountEvent(b, { accountId: acct(a), chargesEnabled: true, payoutsEnabled: true })),
    ).toEqual({ outcome: 'unknown_account', state: 'none' });
    expect((await executeQuery(payoutAccountQuery, {}, a.ctx(), ports)).state).toBe('pending');
  });

  it('moves through restricted to active, deduplicated by provider event id', async () => {
    const restricted = accountEvent(a, { detailsSubmitted: true, requirementsDue: ['external_account'] });
    expect(await apply(a, restricted)).toEqual({ outcome: 'applied', state: 'restricted' });
    expect(await executeQuery(payoutAccountQuery, {}, a.ctx(), ports)).toMatchObject({
      state: 'restricted',
      requirementsDue: ['external_account'],
    });
    const active = accountEvent(a, { detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true });
    expect(await apply(a, active)).toEqual({ outcome: 'applied', state: 'active' });
    expect(await apply(a, active)).toEqual({ outcome: 'duplicate', state: 'active' });
    // pending → restricted → active: one domain event per state change.
    const [evt] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.domain_events where type = 'payouts.account_updated'`,
      ),
    );
    expect(evt?.n).toBe(2);
    expect(await executeQuery(payoutAccountQuery, {}, a.ctx(), ports)).toMatchObject({
      state: 'active',
      fundsFlow: 'organizer_mor',
    });
  });

  it('an active account switches new orders to organizer_mor with the fee as application fee', async () => {
    const types = await executeQuery(listTicketTypesQuery, { eventId: a.event.id }, a.ctx(), ports);
    const paid = types.find((t) => t.priceMinor > 0);
    if (!paid) throw new Error('fixture has no paid ticket type');
    const r = await executeCommand(
      startCheckoutCommand,
      {
        eventId: a.event.id,
        items: [{ ticketTypeId: paid.id, quantity: 1 }],
        buyer: { email: 'direct@example.test', name: 'Direct Buyer' },
      },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    expect(r.payment).toEqual({
      fundsFlow: 'organizer_mor',
      connectedAccountId: acct(a),
      applicationFeeMinor: r.order.feeMinor,
    });
    const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ funds_flow: string; connected_account_id: string }>(
        sql`select funds_flow, connected_account_id from orders.orders where id = ${r.order.id}`,
      ),
    );
    expect(row).toEqual({ funds_flow: 'organizer_mor', connected_account_id: acct(a) });
    // The buyer's order page discloses the seller (roadmap §4.4).
    expect((await orderByManageToken(r.manageToken))?.fundsFlow).toBe('organizer_mor');
    // Org B (still onboarding) keeps platform_mor.
    expect((await executeQuery(payoutAccountQuery, {}, b.ctx(), ports)).fundsFlow).toBe('platform_mor');
  });
});
