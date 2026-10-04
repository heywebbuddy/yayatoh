import {
  acceptAgencyBillingCommand,
  agencyBilledClientsQuery,
  clientAgencyBillingQuery,
  effectiveModules,
  endAgencyBillingCommand,
  offerAgencyBillingCommand,
  setAgencyCommissionCommand,
  setEntitlementOverrideCommand,
  setFeeOverrideCommand,
  withdrawAgencyBillingOfferCommand,
} from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  refundOrder,
  startCheckoutCommand,
} from '@yayatoh/orders';
import {
  agencyCommissionMirror,
  agencyCommissionStatementQuery,
  applyAccountEventCommand,
  clientCommissionStatementQuery,
  commissionFor,
  cumulativeReversal,
  settleOrg,
  stripePaymentProvider,
} from '@yayatoh/payments';
import { fakeStripeApi, type StripeCall, type StripeRoute } from '@yayatoh/payments/testing';
import { catchUpSubscriber } from '@yayatoh/platform';
import {
  addMemberCommand,
  createOrganization,
  grantAgencyAccessCommand,
  revokeAgencyGrantCommand,
} from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M6.8a agency v2 money: the agency pays for a client, earns commission as a second transfer in the
 * event's transfer group (platform_mor), and refunds take it back proportionally by explicit
 * transfer reversals. The provider is the Stripe adapter over an in-memory fake Stripe API (no
 * network, no keys), so the test asserts the exact provider calls.
 */

let a: OrgFixture;
let b: OrgFixture;
let agencyId: string;
let agencySlug: string;
let grantId: string;
const agencyOwner = uuidv7();
const agencyStaff = uuidv7();
const BPS = 1234;

const errCode = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (isDomainError(err)) return err.code;
    throw err;
  }
  return 'ok';
};
const agencyCtx = () => userCtx(agencyOwner, agencyId);
const via = () => userCtx(agencyStaff, a.org.id, { viaAgency: { grantId, agencyOrgId: agencyId } });

const balance = async (orgId: string, account: string) => {
  const [r] = await withTenant(systemCtx(orgId), (tx) =>
    tx.execute<{ b: string | null }>(
      sql`select sum(amount_minor)::text as b from payments.postings where account = ${account}`,
    ),
  );
  return Number(r?.b ?? 0);
};

// --- The fake Stripe API: transfers get ids per destination; one commission reversal can fail. ---
let failCommissionReversal = false;
let transferSeq = 0;
const route = (c: StripeCall): ReturnType<StripeRoute> | undefined => {
  if (c.method === 'POST' && c.path === '/v1/refunds')
    return { json: { id: `re_${c.idempotencyKey}`, object: 'refund', status: 'succeeded' } };
  if (c.method === 'POST' && c.path === '/v1/transfers')
    return {
      json: { id: `tr_${c.body.get('destination')}_${++transferSeq}`, object: 'transfer' },
    };
  const m = /^\/v1\/transfers\/([^/]+)\/reversals$/.exec(c.path);
  if (c.method === 'POST' && m) {
    if (failCommissionReversal && m[1]?.includes('agency')) {
      failCommissionReversal = false;
      return {
        status: 400,
        json: { error: { type: 'invalid_request_error', code: 'insufficient_funds', message: 'no funds' } },
      };
    }
    return { json: { id: `trr_${c.idempotencyKey}`, object: 'transfer_reversal' } };
  }
  return undefined;
};
const routes = new Proxy({} as Record<string, StripeRoute>, {
  get: (_t, key: string) => {
    const [method, path] = key.split(' ');
    return (c: StripeCall) => route(c) ?? { status: 404, json: { error: { message: `${method} ${path}` } } };
  },
});
const api = fakeStripeApi(routes);
const provider = stripePaymentProvider({
  secretKey: 'sk_test_fake_never_live',
  webhookSecrets: ['whsec_test_0123456789abcdef'],
  fetch: api.fetch,
});
const callsSince = (n: number) => api.calls.slice(n);

async function sell(eventId: string, ticketTypeId: string, quantity: number) {
  const c = await executeCommand(
    startCheckoutCommand,
    { eventId, items: [{ ticketTypeId, quantity }], buyer: { email: 'ana@example.test', name: 'Ana Agent' } },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  const pi = `pi_${c.order.id.replaceAll('-', '')}`;
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
  const tickets = await withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{ id: string }>(
      sql`select id from ticketing.tickets where order_id = ${c.order.id} order by serial`,
    ),
  );
  return {
    orderId: c.order.id,
    totalMinor: c.order.totalMinor,
    feeMinor: c.order.feeMinor,
    tickets: tickets.map((t) => t.id),
  };
}

async function newEvent(name: string, endsAt: string) {
  const e = await executeCommand(
    createEventCommand,
    { name, timezone: 'UTC', startsAt: endsAt.replace('T22', 'T18'), endsAt },
    a.ctx(),
    ports,
  );
  const tt = await executeCommand(
    createTicketTypeCommand,
    { eventId: e.id, name: 'GA', priceMinor: 4999, quantityTotal: 50 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, a.ctx(), ports);
  return { eventId: e.id, ticketTypeId: tt.id };
}

const enablePayouts = (orgId: string, accountId: string) =>
  executeCommand(
    applyAccountEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_acct_${uuidv7()}`,
      type: 'account.updated',
      orgId,
      account: {
        accountId,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        requirementsDue: [],
        country: 'US',
        defaultCurrency: 'usd',
      },
    },
    systemCtx(orgId),
    ports,
  );

/** Refunds run now (before the 2028 events, inside the refund policy). */
const refundTickets = (orderId: string, ticketIds: string[], _label: string) =>
  refundOrder({ orderId, reason: 'requested_by_customer', ticketIds }, a.ctx(), ports, provider);

let ev1: { eventId: string; ticketTypeId: string };
let o1: Awaited<ReturnType<typeof sell>>;
let o2: Awaited<ReturnType<typeof sell>>;
let c1 = 0;
let c2 = 0;
let reversed1 = 0;
let refunded1 = 0;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const tag = uuidv7().slice(-8);
  agencySlug = `fern-${tag}`;
  agencyId = (
    await createOrganization(
      userCtx(agencyOwner),
      { slug: agencySlug, name: 'Fern Agency', kind: 'agency' },
      ports,
    )
  ).id;
  await executeCommand(
    addMemberCommand,
    { userId: agencyStaff, role: 'manager' },
    userCtx(agencyOwner, agencyId),
    ports,
  );
  await executeCommand(
    setEntitlementOverrideCommand,
    { moduleKey: 'agency', effect: 'grant', reason: 'agency v2 fixture' },
    systemCtx(agencyId),
    ports,
  );
  await executeCommand(
    setFeeOverrideCommand,
    { currency: 'USD', percentBps: 700, fixedMinor: 33, reason: 'test fee' },
    systemCtx(a.org.id),
    ports,
  );
  grantId = (
    await executeCommand(
      grantAgencyAccessCommand,
      { agency: agencySlug, role: 'manager', finance: false },
      a.ctx(),
      ports,
    )
  ).id;
}, 240_000);
afterAll(async () => {
  delete process.env.AGENCY_V2_ENABLED;
  await closePools();
});

describe('agency v2: the agency pays for clients (M6.8a)', () => {
  it('is off behind the agency_v2 flag (AGENCY_V2_ENABLED unset): no offer, nothing in force', async () => {
    delete process.env.AGENCY_V2_ENABLED;
    expect(
      await errCode(executeCommand(offerAgencyBillingCommand, { clientOrgId: a.org.id }, agencyCtx(), ports)),
    ).toBe('module_not_enabled');
    expect(
      await errCode(executeCommand(acceptAgencyBillingCommand, { agencyOrgId: agencyId }, a.ctx(), ports)),
    ).toBe('module_not_enabled');
    expect(await executeQuery(clientAgencyBillingQuery, {}, a.ctx(), ports)).toMatchObject({
      offers: [],
      inForce: false,
    });
    process.env.AGENCY_V2_ENABLED = '1';
  });

  it('needs the agency entitlement to offer, the agency’s offer to accept, and a member with billing:manage', async () => {
    // A second agency whose `agency` entitlement staff switched off (it is on every plan in beta).
    const other = await createOrganization(
      userCtx(agencyOwner),
      { slug: `moss-${uuidv7().slice(-8)}`, name: 'Moss Agency', kind: 'agency' },
      ports,
    );
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'agency', effect: 'revoke', reason: 'not this agency' },
      systemCtx(other.id),
      ports,
    );
    expect(
      await errCode(
        executeCommand(
          offerAgencyBillingCommand,
          { clientOrgId: a.org.id },
          userCtx(agencyOwner, other.id),
          ports,
        ),
      ),
    ).toBe('module_not_enabled');
    // An org that gave the agency no access cannot be offered.
    expect(
      await errCode(executeCommand(offerAgencyBillingCommand, { clientOrgId: b.org.id }, agencyCtx(), ports)),
    ).toBe('not_found');
    // Nothing to accept yet.
    expect(
      await errCode(executeCommand(acceptAgencyBillingCommand, { agencyOrgId: agencyId }, a.ctx(), ports)),
    ).toBe('not_found');
    // Agency staff (manager) may not offer: billing:manage is the agency's owners and admins.
    expect(
      await errCode(
        executeCommand(
          offerAgencyBillingCommand,
          { clientOrgId: a.org.id },
          userCtx(agencyStaff, agencyId),
          ports,
        ),
      ),
    ).toBe('forbidden');
    expect(
      await executeCommand(offerAgencyBillingCommand, { clientOrgId: a.org.id }, agencyCtx(), ports),
    ).toMatchObject({
      created: true,
    });
    // Offering twice keeps one offer.
    expect(
      await executeCommand(offerAgencyBillingCommand, { clientOrgId: a.org.id }, agencyCtx(), ports),
    ).toMatchObject({
      created: false,
    });
    const seen = await executeQuery(clientAgencyBillingQuery, {}, a.ctx(), ports);
    expect(seen.offers).toEqual([expect.objectContaining({ agencyOrgId: agencyId, grantId })]);
    expect(seen.inForce).toBe(false);
    // The agency acting in the client cannot accept for it, and neither can a viewer.
    expect(
      await errCode(executeCommand(acceptAgencyBillingCommand, { agencyOrgId: agencyId }, via(), ports)),
    ).toBe('forbidden');
    expect(
      await errCode(
        executeCommand(
          acceptAgencyBillingCommand,
          { agencyOrgId: agencyId },
          userCtx(a.viewerId, a.org.id),
          ports,
        ),
      ),
    ).toBe('forbidden');
    const accepted = await executeCommand(
      acceptAgencyBillingCommand,
      { agencyOrgId: agencyId },
      a.ctx(),
      ports,
    );
    expect(accepted).toMatchObject({ agencyOrgId: agencyId, commissionBps: 1000, endedAt: null });
    expect(
      await errCode(executeCommand(acceptAgencyBillingCommand, { agencyOrgId: agencyId }, a.ctx(), ports)),
    ).toBe('conflict');
    // Staff set this client's rate (P6-8: the owner's default is a placeholder).
    expect(
      await executeCommand(setAgencyCommissionCommand, { commissionBps: BPS }, systemCtx(a.org.id), ports),
    ).toEqual({ commissionBps: BPS });
    expect(
      await errCode(executeCommand(setAgencyCommissionCommand, { commissionBps: BPS }, a.ctx(), ports)),
    ).toBe('forbidden');
    expect((await executeQuery(clientAgencyBillingQuery, {}, a.ctx(), ports)).inForce).toBe(true);
    expect(await executeQuery(agencyBilledClientsQuery, {}, agencyCtx(), ports)).toEqual([
      expect.objectContaining({ clientOrgId: a.org.id, commissionBps: BPS }),
    ]);
  });

  it('the agency’s plan covers the client while it is in force, and stops when the offer is withdrawn', async () => {
    await withTenant(systemCtx(agencyId), (tx) =>
      tx.execute(
        sql`insert into billing.org_plans (org_id, plan_key) values (${agencyId}, 'tier_enterprise')`,
      ),
    );
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`insert into billing.org_plans (org_id, plan_key) values (${a.org.id}, 'tier_free')
        on conflict (org_id) do update set plan_key = 'tier_free'`),
    );
    const mods = await effectiveModules(systemCtx(a.org.id));
    expect(mods.has('virtual')).toBe(true);
    // Never the agency's own agency keys.
    expect(mods.has('agency')).toBe(false);
    expect(mods.has('agency_v2')).toBe(false);
    await executeCommand(withdrawAgencyBillingOfferCommand, { clientOrgId: a.org.id }, agencyCtx(), ports);
    expect((await effectiveModules(systemCtx(a.org.id))).has('virtual')).toBe(false);
    expect((await executeQuery(clientAgencyBillingQuery, {}, a.ctx(), ports)).inForce).toBe(false);
    await executeCommand(offerAgencyBillingCommand, { clientOrgId: a.org.id }, agencyCtx(), ports);
    expect((await effectiveModules(systemCtx(a.org.id))).has('virtual')).toBe(true);
    // B is untouched.
    expect((await executeQuery(clientAgencyBillingQuery, {}, b.ctx(), ports)).offers).toEqual([]);
    // Back to the client's own plan for the money tests (modules other tests rely on).
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`delete from billing.org_plans where org_id = ${a.org.id}`),
    );
    await withTenant(systemCtx(agencyId), (tx) =>
      tx.execute(sql`delete from billing.org_plans where org_id = ${agencyId}`),
    );
  });
});

describe('agency v2: commission as a second transfer, reversed proportionally (M6.8a)', () => {
  it('a platform_mor sale earns the agency its commission on the organizer’s share', async () => {
    ev1 = await newEvent('Commission gala', '2028-06-06T22:00:00Z');
    o1 = await sell(ev1.eventId, ev1.ticketTypeId, 3);
    o2 = await sell(ev1.eventId, ev1.ticketTypeId, 1);
    c1 = commissionFor(o1.totalMinor - o1.feeMinor, BPS);
    c2 = commissionFor(o2.totalMinor - o2.feeMinor, BPS);
    expect(c1).toBeGreaterThan(0);
    expect(await balance(a.org.id, 'agency:commission_held')).toBe(-(c1 + c2));
    expect(await balance(a.org.id, 'org:payable_held')).toBe(
      -(o1.totalMinor - o1.feeMinor + o2.totalMinor - o2.feeMinor - c1 - c2) + (await fixtureHeld()),
    );
  });

  it('a partial refund before release takes back the commission in proportion, in the ledger only', async () => {
    const n = api.calls.length;
    const r = await refundTickets(o1.orderId, [o1.tickets[0] as string], '2028-06-07T10:00:00Z');
    expect(r.status).toBe('succeeded');
    refunded1 += r.amountMinor - r.feeRefundedMinor;
    reversed1 = cumulativeReversal(c1, o1.totalMinor - o1.feeMinor, refunded1);
    expect(reversed1).toBeGreaterThan(0);
    expect(await balance(a.org.id, 'agency:commission_held')).toBe(-(c1 + c2 - reversed1));
    // One refund on the platform charge; no transfer to reverse yet; never reverse_transfer.
    const calls = callsSince(n);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /v1/refunds']);
    expect([...(calls[0]?.body.keys() ?? [])]).not.toContain('reverse_transfer');
  });

  it('at release the commission is a second transfer in the same transfer group', async () => {
    await enablePayouts(a.org.id, `fakeacct_${a.org.slug}`);
    // The agency's connected account (onboarded earlier; past its new-destination hold).
    await withTenant(systemCtx(agencyId), (tx) =>
      tx.execute(sql`insert into payments.payment_accounts (org_id, provider, account_id, charges_enabled,
        payouts_enabled, details_submitted, country) values (${agencyId}, 'fake', 'acct_agency', true, true, true, 'US')`),
    );
    const n = api.calls.length;
    const out = await settleOrg(provider, a.org.id, ports, { now: new Date('2028-06-15T00:00:00Z') });
    expect(out.failed).toBe(0);
    const transfers = callsSince(n).filter((c) => c.path === '/v1/transfers');
    const group = `event:${ev1.eventId}`;
    const ofGroup = transfers.filter((c) => c.body.get('transfer_group') === group);
    expect(ofGroup.map((c) => c.body.get('destination')).sort()).toEqual(
      ['acct_agency', `fakeacct_${a.org.slug}`].sort(),
    );
    const commissionCall = ofGroup.find((c) => c.body.get('destination') === 'acct_agency');
    expect(Number(commissionCall?.body.get('amount'))).toBe(c1 + c2 - reversed1);
    expect(await balance(a.org.id, 'agency:commission_held')).toBe(0);
    // The agency's commission never sits in the organizer's transfer.
    const orgCall = ofGroup.find((c) => c.body.get('destination') === `fakeacct_${a.org.slug}`);
    expect(Number(orgCall?.body.get('amount'))).toBeLessThan(
      o1.totalMinor - o1.feeMinor + o2.totalMinor - o2.feeMinor - (c1 + c2 - reversed1),
    );
  });

  it('a refund after transfer reverses the commission transfer explicitly, proportionally, to the cent', async () => {
    const n = api.calls.length;
    const r = await refundTickets(o1.orderId, [o1.tickets[1] as string], '2028-06-20T10:00:00Z');
    refunded1 += r.amountMinor - r.feeRefundedMinor;
    const target = cumulativeReversal(c1, o1.totalMinor - o1.feeMinor, refunded1);
    const expected = target - reversed1;
    reversed1 = target;
    const calls = callsSince(n);
    const reversals = calls.filter((c) => c.path.endsWith('/reversals'));
    const commissionRev = reversals.find((c) => c.path.includes('acct_agency'));
    expect(commissionRev?.idempotencyKey).toBe(`commission_reversal:${r.refundId}`);
    expect(Number(commissionRev?.body.get('amount'))).toBe(expected);
    // The organizer's share comes back by its own explicit reversal, from its own transfer.
    expect(reversals.filter((c) => c.path.includes(`fakeacct_${a.org.slug}`))).toHaveLength(1);
    // Separate charges & transfers: no call ever carries reverse_transfer.
    for (const c of api.calls) expect([...c.body.keys()]).not.toContain('reverse_transfer');
    expect(await balance(a.org.id, 'agency:commission_receivable')).toBe(0);
  });

  it('a full refund reverses exactly the whole commission; a failed reversal stays owed and is netted', async () => {
    failCommissionReversal = true;
    const r = await refundTickets(o1.orderId, [o1.tickets[2] as string], '2028-06-21T10:00:00Z');
    refunded1 += r.amountMinor - r.feeRefundedMinor;
    expect(refunded1).toBe(o1.totalMinor - o1.feeMinor);
    const last = c1 - reversed1;
    reversed1 = c1;
    // The whole commission of the fully refunded order is reversed, to the cent.
    const [sum] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: string }>(sql`select coalesce(sum((memo->>'amountMinor')::bigint), 0)::text as n
        from payments.journal_entries where kind = 'agency_commission_reversal' and ref_id = ${o1.orderId}`),
    );
    expect(Number(sum?.n)).toBe(c1);
    // The reversal failed: the agency owes it.
    expect(await balance(a.org.id, 'agency:commission_receivable')).toBe(last);
    // The next commission nets it before transferring.
    const ev2 = await newEvent('Commission brunch', '2028-07-04T22:00:00Z');
    await enablePayoutsHoldOff();
    const o3 = await settleAfterSale(ev2);
    const c3 = commissionFor(o3.totalMinor - o3.feeMinor, BPS);
    const [s] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ released_minor: string; netted_minor: string; amount_minor: string }>(sql`
        select released_minor, netted_minor, amount_minor from payments.settlements
        where kind = 'commission' and event_id = ${ev2.eventId}`),
    );
    expect(Number(s?.released_minor)).toBe(c3);
    expect(Number(s?.netted_minor)).toBe(Math.min(last, c3));
    expect(Number(s?.amount_minor)).toBe(c3 - Math.min(last, c3));
    expect(await balance(a.org.id, 'agency:commission_receivable')).toBe(last - Math.min(last, c3));
  });

  it('statements for client and agency come from ledger entries and agree; the mirror is idempotent', async () => {
    await catchUpSubscriber(agencyCommissionMirror, a.org.id);
    await catchUpSubscriber(agencyCommissionMirror, a.org.id);
    const client = await executeQuery(clientCommissionStatementQuery, {}, a.ctx(), ports);
    const agency = await executeQuery(agencyCommissionStatementQuery, {}, agencyCtx(), ports);
    expect(agency.totals).toEqual(client.totals);
    const [usd] = client.totals;
    expect(usd?.pendingMinor).toBe(0);
    expect(usd?.earnedMinor).toBe(usd ? usd.paidMinor - usd.owedMinor : NaN);
    // Each movement once on the agency's side.
    expect(new Set(agency.entries.map((e) => e.journalId)).size).toBe(agency.entries.length);
    expect(agency.entries.every((e) => e.counterpartyOrgId === a.org.id)).toBe(true);
    expect(
      agency.entries
        .filter((e) => e.kind === 'accrued')
        .map((e) => e.amountMinor)
        .sort((x, y) => x - y),
    ).toEqual(
      client.entries
        .filter((e) => e.kind === 'accrued')
        .map((e) => e.amountMinor)
        .sort((x, y) => x - y),
    );
    // The agency's ledger never touches platform cash, and balances.
    expect(await balance(agencyId, 'platform:stripe_cash')).toBe(0);
    const [all] = await withTenant(systemCtx(agencyId), (tx) =>
      tx.execute<{ s: string }>(sql`select coalesce(sum(amount_minor), 0)::text as s from payments.postings`),
    );
    expect(all?.s).toBe('0');
    // The client's books balance too.
    const [allA] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ s: string }>(sql`select coalesce(sum(amount_minor), 0)::text as s from payments.postings`),
    );
    expect(allA?.s).toBe('0');
  });

  it('an agency without a finance grant still never reads client money tables', async () => {
    for (const table of ['payments.journal_entries', 'payments.postings', 'payments.settlements']) {
      const n = await withTenant(via(), async (tx) => {
        const [r] = await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table}`));
        return r?.n ?? 0;
      });
      expect(n).toBe(0);
    }
    expect(await errCode(executeQuery(clientCommissionStatementQuery, {}, via(), ports))).toBe('forbidden');
    expect(await errCode(executeQuery(clientAgencyBillingQuery, {}, via(), ports))).toBe('forbidden');
    // Agency staff without finance:read in the agency don't see its statement either.
    expect(
      await errCode(executeQuery(agencyCommissionStatementQuery, {}, userCtx(agencyStaff, agencyId), ports)),
    ).toBe('forbidden');
    // Org B sees none of it.
    expect((await executeQuery(clientCommissionStatementQuery, {}, b.ctx(), ports)).entries).toEqual([]);
  });

  it('revoking the grant ends agency billing: no commission on new sales', async () => {
    await executeCommand(revokeAgencyGrantCommand, { grantId }, a.ctx(), ports);
    expect((await executeQuery(clientAgencyBillingQuery, {}, a.ctx(), ports)).inForce).toBe(false);
    const ev = await newEvent('After revoke', '2028-08-01T22:00:00Z');
    const before = await balance(a.org.id, 'agency:commission_held');
    // Payouts are active now, so this sale is organizer_mor: still no commission either way.
    await sell(ev.eventId, ev.ticketTypeId, 1);
    expect(await balance(a.org.id, 'agency:commission_held')).toBe(before);
    const { agencyBillingGrantRevoked } = await import('@yayatoh/billing');
    await catchUpSubscriber(agencyBillingGrantRevoked, a.org.id);
    const state = await executeQuery(clientAgencyBillingQuery, {}, a.ctx(), ports);
    expect(state.current).toBeNull();
    expect(state.history[0]).toMatchObject({ agencyOrgId: agencyId, endReason: 'grant_revoked' });
    expect(await executeCommand(endAgencyBillingCommand, {}, a.ctx(), ports)).toEqual({ ended: false });
  });
});

/** What the fixture's own orders left in org A's held funds (its fixture sale), to compare against. */
async function fixtureHeld(): Promise<number> {
  const [r] = await withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{ b: string | null }>(sql`select sum(p.amount_minor)::text as b from payments.postings p
      join payments.journal_entries j on j.id = p.journal_id
      where p.account = 'org:payable_held' and (j.event_id is distinct from ${ev1.eventId})`),
  );
  return Number(r?.b ?? 0);
}

/**
 * A sale on a second event while the client is platform_mor: payouts went active above (new sales
 * would be organizer_mor), so the order is marked platform_mor the way a sale before activation is.
 */
async function enablePayoutsHoldOff() {
  await withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute(sql`update payments.payment_accounts set charges_enabled = false where org_id = ${a.org.id}`),
  );
}

async function settleAfterSale(ev: { eventId: string; ticketTypeId: string }) {
  const o = await sell(ev.eventId, ev.ticketTypeId, 2);
  await withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute(sql`update payments.payment_accounts set charges_enabled = true where org_id = ${a.org.id}`),
  );
  await settleOrg(provider, a.org.id, ports, { now: new Date('2028-07-14T00:00:00Z') });
  return o;
}
