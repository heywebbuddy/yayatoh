import {
  billingReadOnlyGate,
  billingStandingQuery,
  changeSubscriptionPlan,
  DUNNING_GRACE_DAYS,
  effectiveModules,
  type FakeBillingProvider,
  fakeBillingProvider,
  nonprofitDiscountFromCharity,
  PLACEHOLDER_PLANS,
  payOutstandingInvoice,
  planChangeHistoryQuery,
  planChangeOptionsQuery,
  previewPlanChange,
  processBillingWebhook,
  pushNonprofitDiscount,
  setNonprofitDiscountCommand,
  signFakeBillingEvent,
} from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import { consumeEvent } from '@yayatoh/platform';
import { createTrackCommand, programQuery } from '@yayatoh/program';
import { memberRoleTx } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

/*
 * M6.6b: dunning to read-only (never data loss), in-app plan changes with the proration preview
 * (modules still move only through the provider's webhook), and the nonprofit discount.
 */

const SECRET = 'billing-dunning-int-secret-'.padEnd(64, 'd');
const DAY = 86_400_000;
let provider: FakeBillingProvider;
const deliver = async (d: { body: string; headers: Record<string, string> }) => {
  const out = await processBillingWebhook(d.body, new Headers(d.headers), 'fake', {
    provider: () => provider,
    ports,
    enabled: true,
  });
  if (out.status !== 200) throw new Error(`webhook ${out.status}`);
};
provider = fakeBillingProvider({ secret: SECRET, deliver });

let a: OrgFixture;
let b: OrgFixture;
const prior = process.env.BILLING_ENABLED;
beforeAll(async () => {
  process.env.BILLING_ENABLED = '1';
  ({ a, b } = await twoOrgs());
});
afterAll(async () => {
  if (prior === undefined) delete process.env.BILLING_ENABLED;
  else process.env.BILLING_ENABLED = prior;
  await closePools();
});

const customerOf = (f: OrgFixture) => `fakecus_fixture_${f.org.id.slice(-12)}`;
const subscriptionOf = (f: OrgFixture) => `fakesub_fixture_${f.org.id.slice(-12)}`;
// Provider event times follow the real clock (the fake provider stamps its own webhooks with it),
// strictly increasing so no renewal is ever "stale" against the previous one.
let clock = 0;
const tick = () => {
  clock = Math.max(clock + 1, Date.now());
  return new Date(clock);
};

/** The provider reports the fixture subscription's status (a renewal outcome). */
async function renewal(f: OrgFixture, status: 'past_due' | 'unpaid' | 'active' | 'canceled') {
  const createdAt = tick();
  await deliver(
    signFakeBillingEvent(SECRET, {
      kind: 'subscription',
      type: 'customer.subscription.updated',
      createdAt,
      customerId: customerOf(f),
      subscriptionId: subscriptionOf(f),
      status,
      priceLookupKey: 'tier_pro_month_usd',
      currentPeriodEnd: new Date(createdAt.getTime() + 30 * DAY),
      cancelAtPeriodEnd: false,
    }),
  );
}

const standing = (f: OrgFixture, now?: Date) =>
  executeQuery(billingStandingQuery, {}, f.ctx(now ? { now } : {}), ports);
const track = (f: OrgFixture, ctx: Ctx = f.ctx()) =>
  executeCommand(
    createTrackCommand,
    { eventId: f.event.id, name: `Track ${uuidv7().slice(-6)}` },
    ctx,
    ports,
  );
async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (err) {
    if (isDomainError(err)) return err.code;
    throw err;
  }
}
const counts = (f: OrgFixture) =>
  withTenant(systemCtx(f.org.id), async (tx) => {
    const [r] = await tx.execute<{ tracks: number; events: number; subs: number }>(sql`select
      (select count(*)::int from program.tracks) as tracks,
      (select count(*)::int from events.events) as events,
      (select count(*)::int from billing.subscriptions) as subs`);
    return r;
  });

describe('dunning to read-only (M6.6b acceptance)', () => {
  beforeEach(async () => {
    await renewal(a, 'active');
  });

  it('a failed renewal starts the grace period: writes still work, the standing says until when', async () => {
    await renewal(a, 'past_due');
    const s = await standing(a);
    expect(s.standing).toBe('grace');
    expect(s.readOnlyFrom && s.failedAt && s.readOnlyFrom.getTime() - s.failedAt.getTime()).toBe(
      DUNNING_GRACE_DAYS * DAY,
    );
    expect(await codeOf(track(a))).toBeNull();
  });

  it('after the grace period the org is read-only: reads work, writes are refused, nothing is deleted', async () => {
    await renewal(a, 'past_due');
    const before = await counts(a);
    const later = new Date(Date.now() + (DUNNING_GRACE_DAYS + 1) * DAY);
    expect((await standing(a, later)).standing).toBe('read_only');
    // Writes by members refuse with a clear code (HTTP 402) and the reason.
    try {
      await track(a, a.ctx({ now: later }));
      expect.unreachable();
    } catch (err) {
      expect(isDomainError(err) && err.code).toBe('read_only_billing');
      expect(isDomainError(err) && err.status).toBe(402);
      expect(isDomainError(err) && err.details).toMatchObject({ reason: 'billing_read_only' });
    }
    // Reads keep working.
    const program = await executeQuery(programQuery, { eventId: a.event.id }, a.ctx({ now: later }), ports);
    expect(program.tracks.length).toBeGreaterThan(0);
    // The platform still writes (webhooks, the worker).
    expect(await codeOf(track(a, { ...systemCtx(a.org.id), now: later }))).toBeNull();
    // Nothing was deleted by any of it.
    const after = await counts(a);
    expect(after?.events).toBe(before?.events);
    expect(after?.tracks).toBe((before?.tracks ?? 0) + 1);
  });

  it('the provider giving up makes it read-only at once; paying restores writes', async () => {
    await renewal(a, 'unpaid');
    expect((await standing(a)).standing).toBe('read_only');
    expect(await codeOf(track(a))).toBe('read_only_billing');
    // Paying is allowed while read-only (owners and admins), and the webhook restores writes.
    const paid = await payOutstandingInvoice(
      provider,
      a.ctx({ idempotencyKey: `pay-${uuidv7()}` }),
      systemCtx(a.org.id),
      ports,
    );
    expect(paid).toEqual({ paid: true });
    expect((await standing(a)).standing).toBe('good');
    expect(await codeOf(track(a))).toBeNull();
  });

  it('a declined payment changes nothing; paying needs billing:manage and something due', async () => {
    await renewal(a, 'unpaid');
    const declining = fakeBillingProvider({ secret: SECRET, deliver, declinePayments: true });
    expect(
      await payOutstandingInvoice(declining, a.ctx({ idempotencyKey: uuidv7() }), systemCtx(a.org.id), ports),
    ).toEqual({ paid: false });
    expect((await standing(a)).standing).toBe('read_only');
    const viewer = a.ctx({ actor: { type: 'user', userId: a.viewerId }, idempotencyKey: uuidv7() });
    expect(await codeOf(payOutstandingInvoice(provider, viewer, systemCtx(a.org.id), ports))).toBe(
      'forbidden',
    );
    await renewal(a, 'active');
    expect(
      await codeOf(
        payOutstandingInvoice(provider, a.ctx({ idempotencyKey: uuidv7() }), systemCtx(a.org.id), ports),
      ),
    ).toBe('invalid_state');
  });

  it('a subscription that ends unpaid stays read-only; the gate spares buyers, exports and the door', async () => {
    await renewal(a, 'past_due');
    await renewal(a, 'canceled');
    expect((await standing(a)).standing).toBe('read_only');
    const gate = billingReadOnlyGate({ memberRole: memberRoleTx });
    const check = (ctx: Ctx, name: string, category?: 'export' | 'money') =>
      codeOf(
        withTenant(systemCtx(a.org.id), (tx) =>
          gate.check(tx, ctx, { name, ...(category ? { category } : {}) }),
        ),
      );
    const owner = a.ctx();
    expect(await check(owner, 'program.createTrack')).toBe('read_only_billing');
    expect(await check(owner, 'reports.startAttendeeExport', 'export')).toBeNull();
    expect(await check(owner, 'checkin.scanTicket')).toBeNull();
    expect(await check(owner, 'billing.changePlan')).toBeNull();
    const apiKey = createCtx({ orgId: a.org.id, actor: { type: 'api_key', keyId: uuidv7() } });
    expect(await check(apiKey, 'program.createTrack')).toBe('read_only_billing');
    const buyer = createCtx({ orgId: a.org.id, actor: { type: 'user', userId: uuidv7() } });
    expect(await check(buyer, 'orders.checkout')).toBeNull();
    expect(await check(createCtx({ orgId: a.org.id }), 'orders.checkout')).toBeNull();
    // The other org is untouched.
    expect((await standing(b)).standing).toBe('good');
    expect(await codeOf(track(b))).toBeNull();
  });

  it('billing switched off: never read-only, whatever the stored state', async () => {
    await renewal(a, 'unpaid');
    delete process.env.BILLING_ENABLED;
    try {
      expect((await standing(a)).standing).toBe('good');
      expect(await codeOf(track(a))).toBeNull();
    } finally {
      process.env.BILLING_ENABLED = '1';
    }
  });
});

describe('in-app plan changes (M6.6b)', () => {
  beforeAll(async () => {
    await renewal(a, 'active');
  });

  it('offers the placeholder tiers with the fake provider, each with what it turns off', async () => {
    const o = await executeQuery(planChangeOptionsQuery, {}, a.ctx(), ports);
    expect(o.available).toBe(true);
    expect(o.currentLookupKey).toBe('tier_pro_month_usd');
    const free = o.offers.find((x) => x.lookupKey === 'tier_free_month_usd');
    expect(free).toMatchObject({ direction: 'downgrade', current: false });
    const freePlan = PLACEHOLDER_PLANS.find((p) => p.key === 'tier_free');
    expect(free?.removedModules.length).toBeGreaterThan(0);
    for (const m of free?.removedModules ?? []) expect(freePlan?.modules).not.toContain(m);
    expect(o.offers.find((x) => x.lookupKey === 'tier_pro_month_usd')?.current).toBe(true);
    expect(o.offers.find((x) => x.lookupKey === 'tier_agency_month_usd')?.direction).toBe('upgrade');
    // Quoted prices (Enterprise) are never offered in-app.
    expect(o.offers.some((x) => x.planKey === 'tier_enterprise')).toBe(false);
  });

  it('previews the proration through the provider; a downgrade needs the modules confirmed', async () => {
    const at = new Date();
    const p = await previewPlanChange(provider, a.ctx(), ports, {
      priceLookupKey: 'tier_free_month_usd',
      at,
    });
    expect(p.offer.direction).toBe('downgrade');
    expect(p.amountDueMinor).toBe(0);
    expect(p.creditBalanceMinor).toBeGreaterThan(0);
    const shown = { currency: p.currency, amountDueMinor: 0, taxMinor: 0, discountMinor: 0 };
    const key = uuidv7();
    const change = (confirmRemoved: boolean, idem = key) =>
      changeSubscriptionPlan(provider, a.ctx({ idempotencyKey: idem }), systemCtx(a.org.id), ports, {
        priceLookupKey: 'tier_free_month_usd',
        confirmRemoved,
        shown,
        at,
      });
    expect(await codeOf(change(false, uuidv7()))).toBe('validation_failed');
    expect((await effectiveModules(systemCtx(a.org.id))).has('sessions')).toBe(true);
    const done = await change(true);
    expect(done).toMatchObject({ direction: 'downgrade', outcome: 'submitted' });
    // The provider's webhook (not the command) moved the plan and the modules.
    expect((await effectiveModules(systemCtx(a.org.id))).has('sessions')).toBe(false);
    const history = await executeQuery(planChangeHistoryQuery, {}, a.ctx(), ports);
    expect(history[0]).toMatchObject({ toPlanKey: 'tier_free', direction: 'downgrade', status: 'submitted' });
    // An upgrade brings the module back.
    const up = await previewPlanChange(provider, a.ctx(), ports, { priceLookupKey: 'tier_pro_month_usd' });
    expect(up.offer.direction).toBe('upgrade');
    expect(up.amountDueMinor).toBeGreaterThan(0);
    expect(up.taxMinor).toBeGreaterThan(0);
    await changeSubscriptionPlan(provider, a.ctx({ idempotencyKey: uuidv7() }), systemCtx(a.org.id), ports, {
      priceLookupKey: 'tier_pro_month_usd',
      shown: { currency: 'USD', amountDueMinor: up.amountDueMinor, taxMinor: up.taxMinor, discountMinor: 0 },
    });
    expect((await effectiveModules(systemCtx(a.org.id))).has('sessions')).toBe(true);
  });

  it('owners and admins only; the same plan, unknown prices and billing off are refused', async () => {
    const viewer = a.ctx({ actor: { type: 'user', userId: a.viewerId }, idempotencyKey: uuidv7() });
    expect(
      await codeOf(previewPlanChange(provider, viewer, ports, { priceLookupKey: 'tier_free_month_usd' })),
    ).toBe('forbidden');
    expect(
      await codeOf(previewPlanChange(provider, a.ctx(), ports, { priceLookupKey: 'tier_pro_month_usd' })),
    ).toBe('invalid_state');
    expect(
      await codeOf(previewPlanChange(provider, a.ctx(), ports, { priceLookupKey: 'nope_month_usd' })),
    ).toBe('validation_failed');
    delete process.env.BILLING_ENABLED;
    try {
      expect(
        await codeOf(previewPlanChange(provider, a.ctx(), ports, { priceLookupKey: 'tier_free_month_usd' })),
      ).toBe('invalid_state');
    } finally {
      process.env.BILLING_ENABLED = '1';
    }
  });

  it('a plan change is idempotent per key: a retry neither records nor charges twice', async () => {
    const key = uuidv7();
    const run = () =>
      changeSubscriptionPlan(provider, a.ctx({ idempotencyKey: key }), systemCtx(a.org.id), ports, {
        priceLookupKey: 'tier_agency_month_usd',
        shown: { currency: 'USD', amountDueMinor: 1, taxMinor: 0, discountMinor: 0 },
      });
    const first = await run();
    const again = await run();
    expect(again.changeId).toBe(first.changeId);
    const rows = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from billing.plan_changes where id = ${first.changeId}`,
      ),
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe('nonprofit discount (M6.6b)', () => {
  it('a verified charity gets the coupon; it shows in the options and the preview, and reaches the provider', async () => {
    const sub = nonprofitDiscountFromCharity();
    const id = uuidv7();
    await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute(sql`insert into platform.domain_events (id, org_id, type, version, aggregate_type, aggregate_id, payload, actor, request_id)
        values (${id}, ${b.org.id}, 'donations.charity_verified', 1, 'charity_profile', ${uuidv7()},
          ${JSON.stringify({ orgId: b.org.id })}::jsonb, 'system:test', ${uuidv7()})`),
    );
    await consumeEvent(sub, {
      id,
      orgId: b.org.id,
      type: 'donations.charity_verified',
      version: 1,
      aggregateType: 'charity_profile',
      aggregateId: id,
      payload: { orgId: b.org.id },
      logSeq: 0,
    });
    const o = await executeQuery(planChangeOptionsQuery, {}, b.ctx(), ports);
    expect(o).toMatchObject({ discountPercent: 20, discountSource: 'verified_charity' });
    const p = await previewPlanChange(provider, b.ctx(), ports, { priceLookupKey: 'tier_agency_month_usd' });
    expect(p.discountMinor).toBeGreaterThan(0);
    expect(await pushNonprofitDiscount(b.org.id, provider, ports, { enabled: true })).toBe(true);
    expect(provider.discounts.get(subscriptionOf(b))).toBe('nonprofit');
    // Pushed once: nothing changed since.
    expect(await pushNonprofitDiscount(b.org.id, provider, ports, { enabled: true })).toBe(false);
  });

  it('staff grant or remove it by hand (audited, platform only)', async () => {
    expect(
      await codeOf(
        executeCommand(setNonprofitDiscountCommand, { enabled: true, note: 'church' }, a.ctx(), ports),
      ),
    ).toBe('forbidden');
    const out = await executeCommand(
      setNonprofitDiscountCommand,
      { enabled: true, note: 'church, by email' },
      systemCtx(a.org.id),
      ports,
    );
    expect(out).toEqual({ source: 'staff', changed: true });
    expect((await executeQuery(planChangeOptionsQuery, {}, a.ctx(), ports)).discountSource).toBe('staff');
    await executeCommand(
      setNonprofitDiscountCommand,
      { enabled: false, note: 'ended' },
      systemCtx(a.org.id),
      ports,
    );
    expect((await executeQuery(planChangeOptionsQuery, {}, a.ctx(), ports)).discountPercent).toBeNull();
    const [audit] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.audit_events where action = 'billing.nonprofit_discount'`,
      ),
    );
    expect(audit?.n).toBe(2);
  });

  it('roles: billing:manage is owners and admins; finance reads but cannot change', async () => {
    const { roleCan } = await import('@yayatoh/tenancy');
    expect(roleCan('owner', 'billing:manage')).toBe(true);
    expect(roleCan('admin', 'billing:manage')).toBe(true);
    expect(roleCan('finance', 'billing:manage')).toBe(false);
    expect(roleCan('finance', 'billing:read')).toBe(true);
  });
});
