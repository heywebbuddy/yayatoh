import {
  applyBillingEventCommand,
  type BillingProvider,
  billingAccountQuery,
  effectiveModules,
  ensureBillingCustomer,
  fakeBillingProvider,
  linkBillingCustomerCommand,
  PLACEHOLDER_PLANS,
  planSummaryQuery,
  processBillingWebhook,
  setLegacyFeesCommand,
  signFakeBillingEvent,
} from '@yayatoh/billing';
import { withoutTenant, withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import { MODULE_KEYS, PHASE6_MODULE_KEYS } from '@yayatoh/platform';
import { createTrackCommand } from '@yayatoh/program';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createOrgFixture, type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

const SECRET = 'billing-int-test-secret-'.padEnd(64, 'x');
const provider: BillingProvider = fakeBillingProvider({ secret: SECRET });
const deps = { provider: () => provider, ports, enabled: true };

let a: OrgFixture;
let b: OrgFixture;
let customerA: string;
let customerB: string;

const plan = (key: string) => {
  const p = PLACEHOLDER_PLANS.find((x) => x.key === key);
  if (!p) throw new Error(key);
  return p;
};

/** Post a signed fake billing webhook through the real processor (verify → org → command). */
async function deliver(body: string, headers: Record<string, string>) {
  return processBillingWebhook(body, new Headers(headers), 'fake', deps);
}

let clock = Date.now();
const tick = () => new Date((clock += 1000));

/** The provider moves the customer to `planKey`: the subscription event, then the entitlement summary. */
async function changePlan(f: OrgFixture, planKey: string, status: 'active' | 'canceled' = 'active') {
  const createdAt = tick();
  const customerId = f === a ? customerA : customerB;
  const sub = signFakeBillingEvent(SECRET, {
    kind: 'subscription',
    type: status === 'canceled' ? 'customer.subscription.deleted' : 'customer.subscription.updated',
    createdAt,
    customerId,
    // The fixture's own subscription (one per customer, like the fake billing portal).
    subscriptionId: `fakesub_fixture_${f.org.id.slice(-12)}`,
    status,
    priceLookupKey: `${planKey}_month_usd`,
    currentPeriodEnd: new Date(createdAt.getTime() + 30 * 86_400_000),
    cancelAtPeriodEnd: false,
  });
  const ent = signFakeBillingEvent(SECRET, {
    kind: 'entitlements',
    type: 'entitlements.active_entitlement_summary.updated',
    createdAt,
    customerId,
    features: status === 'canceled' ? [] : [...plan(planKey).modules],
  });
  const r1 = await deliver(sub.body, sub.headers);
  const r2 = await deliver(ent.body, ent.headers);
  return [r1, r2];
}

const prior = process.env.BILLING_ENABLED;
beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  process.env.BILLING_ENABLED = '1';
  customerA = (await executeQuery(billingAccountQuery, {}, systemCtx(a.org.id), ports)).customerId ?? '';
  customerB = (await executeQuery(billingAccountQuery, {}, systemCtx(b.org.id), ports)).customerId ?? '';
});
afterEach(() => {
  process.env.BILLING_ENABLED = '1';
});
afterAll(async () => {
  if (prior === undefined) delete process.env.BILLING_ENABLED;
  else process.env.BILLING_ENABLED = prior;
  await closePools();
});

const track = (f: OrgFixture) =>
  executeCommand(
    createTrackCommand,
    { eventId: f.event.id, name: `Track ${uuidv7().slice(-6)}` },
    f.ctx(),
    ports,
  );
const refused = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    if (isDomainError(err)) return err.code;
    throw err;
  }
};
/** The Postgres error code a query failed with (drizzle wraps it as the cause). */
const pgError = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code ?? 'unknown';
  }
};
const modules = async (f: OrgFixture) => [...(await effectiveModules(systemCtx(f.org.id)))].sort();

describe('plan change through the webhook alone (M6.6a acceptance)', () => {
  it('a downgrade removes a module and an upgrade brings it back, with no feature-code change', async () => {
    // Fixture orgs start on a Pro-like subscription whose entitlements are every module key.
    expect(await refused(track(a))).toBeNull();

    const down = await changePlan(a, 'tier_free');
    expect(down.map((r) => [r.status, r.body])).toEqual([
      [200, { outcome: 'applied' }],
      [200, { outcome: 'applied' }],
    ]);
    expect(await modules(a)).toEqual([...plan('tier_free').modules].sort());
    expect(await modules(a)).not.toContain('sessions');
    // The program module's own entitlement check refuses it now: nothing in its code changed.
    expect(await refused(track(a))).toBe('module_not_enabled');

    await changePlan(a, 'tier_pro');
    expect(await modules(a)).toContain('sessions');
    expect(await refused(track(a))).toBeNull();

    // The other org never moved.
    expect(await modules(b)).toEqual([...MODULE_KEYS].sort());
  });

  it('the plan page shows the subscribed plan, its price and the modules', async () => {
    await changePlan(a, 'tier_pro');
    const s = await executeQuery(planSummaryQuery, {}, a.ctx(), ports);
    expect(s).toMatchObject({
      billingEnabled: true,
      active: true,
      plan: { key: 'tier_pro', name: 'Pro', source: 'subscription' },
      subscription: {
        status: 'active',
        live: true,
        price: { lookupKey: 'tier_pro_month_usd', currency: 'USD', interval: 'month', unitAmountMinor: 9900 },
        cancelAtPeriodEnd: false,
      },
      // Fixture orgs are grandfathered: the fee plan stays the legacy one.
      feePlan: { key: 'launch_standard' },
      legacyFees: { grandfathered: true, reason: 'staff' },
    });
    expect(s.modules).toEqual([...plan('tier_pro').modules].sort());
    expect(s.catalog.map((c) => [c.key, c.active])).toEqual(PLACEHOLDER_PLANS.map((p) => [p.key, false]));
    // The allowlist: no provider or customer ids reach the page.
    expect(JSON.stringify(s)).not.toContain(customerA);
    expect(JSON.stringify(s)).not.toContain('fakesub_');
  });

  it('entitlements apply only while the subscription is live; a cancel returns the org to its plan', async () => {
    await changePlan(a, 'tier_free');
    expect(await modules(a)).not.toContain('sessions');
    await changePlan(a, 'tier_free', 'canceled');
    // Grandfathered fixture org: back to its legacy plan (launch_standard: every module).
    expect(await modules(a)).toEqual([...MODULE_KEYS].sort());
    const s = await executeQuery(planSummaryQuery, {}, a.ctx(), ports);
    expect(s.plan).toEqual({ key: 'launch_standard', name: 'Launch standard', source: 'plan' });
    expect(s.subscription).toMatchObject({ status: 'canceled', live: false });
    await changePlan(a, 'tier_pro');
  });

  it('a live subscription with an empty summary still keeps core (no console lock-out)', async () => {
    const ent = signFakeBillingEvent(SECRET, {
      kind: 'entitlements',
      type: 'entitlements.active_entitlement_summary.updated',
      createdAt: tick(),
      customerId: customerA,
      features: ['not_a_module'],
    });
    expect((await deliver(ent.body, ent.headers)).body).toEqual({ outcome: 'applied' });
    expect(await modules(a)).toEqual(['ai', 'core']); // `ai` is the fixture's grant override
    await changePlan(a, 'tier_pro');
  });
});

describe('replays and ordering (M6.6a)', () => {
  it('a replayed webhook is a no-op, recorded once', async () => {
    const e = signFakeBillingEvent(SECRET, {
      kind: 'entitlements',
      type: 'entitlements.active_entitlement_summary.updated',
      createdAt: tick(),
      customerId: customerA,
      features: [...plan('tier_starter').modules],
    });
    expect((await deliver(e.body, e.headers)).body).toEqual({ outcome: 'applied' });
    const before = await modules(a);
    for (let i = 0; i < 3; i++)
      expect((await deliver(e.body, e.headers)).body).toEqual({ outcome: 'duplicate' });
    expect(await modules(a)).toEqual(before);
    const id = JSON.parse(e.body).id as string;
    const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from billing.provider_events where provider_event_id = ${id}`,
      ),
    );
    expect(row?.n).toBe(1);
    await changePlan(a, 'tier_pro');
  });

  it('an older event delivered late never rolls the plan back', async () => {
    await changePlan(a, 'tier_pro');
    const old = new Date(clock - 3_600_000);
    const lateSub = signFakeBillingEvent(SECRET, {
      kind: 'subscription',
      type: 'customer.subscription.updated',
      createdAt: old,
      customerId: customerA,
      subscriptionId: `fakesub_fixture_${a.org.id.slice(-12)}`,
      status: 'active',
      priceLookupKey: 'tier_free_month_usd',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
    const lateEnt = signFakeBillingEvent(SECRET, {
      kind: 'entitlements',
      type: 'entitlements.active_entitlement_summary.updated',
      createdAt: old,
      customerId: customerA,
      features: [...plan('tier_free').modules],
    });
    expect((await deliver(lateSub.body, lateSub.headers)).body).toEqual({ outcome: 'stale' });
    expect((await deliver(lateEnt.body, lateEnt.headers)).body).toEqual({ outcome: 'stale' });
    expect(await modules(a)).toContain('sessions');
    expect((await executeQuery(planSummaryQuery, {}, a.ctx(), ports)).plan.key).toBe('tier_pro');
  });
});

describe('billing off (BILLING_ENABLED unset): nothing changes (M6.6a)', () => {
  it('the webhook answers 404 and writes nothing', async () => {
    delete process.env.BILLING_ENABLED;
    const e = signFakeBillingEvent(SECRET, {
      kind: 'entitlements',
      type: 'entitlements.active_entitlement_summary.updated',
      createdAt: tick(),
      customerId: customerA,
      features: ['core'],
    });
    const out = await processBillingWebhook(e.body, new Headers(e.headers), 'fake', {
      provider: () => provider,
      ports,
    });
    expect(out).toEqual({ status: 404, body: null, verified: true });
    const id = JSON.parse(e.body).id as string;
    const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from billing.provider_events where provider_event_id = ${id}`,
      ),
    );
    expect(row?.n).toBe(0);
  });

  it('modules come from the plan exactly as before, even for an org with synced entitlements', async () => {
    await changePlan(a, 'tier_free');
    expect(await modules(a)).not.toContain('sessions');
    delete process.env.BILLING_ENABLED;
    expect(await modules(a)).toEqual([...MODULE_KEYS].sort());
    expect(await refused(track(a))).toBeNull();
    const s = await executeQuery(planSummaryQuery, {}, a.ctx(), ports);
    expect(s).toMatchObject({
      billingEnabled: false,
      active: false,
      plan: { key: 'launch_standard', source: 'plan' },
      subscription: null,
    });
    process.env.BILLING_ENABLED = '1';
    await changePlan(a, 'tier_pro');
  });
});

describe('webhook verification and routing (M6.6a)', () => {
  it('refuses a forged body (400, counted as unverified) and another provider’s endpoint (404)', async () => {
    const e = signFakeBillingEvent('f'.repeat(64), {
      kind: 'entitlements',
      type: 'entitlements.active_entitlement_summary.updated',
      customerId: customerA,
      features: ['core'],
    });
    expect(await deliver(e.body, e.headers)).toEqual({ status: 400, body: null, verified: false });
    const good = signFakeBillingEvent(SECRET, {
      kind: 'entitlements',
      type: 'entitlements.active_entitlement_summary.updated',
      customerId: customerA,
      features: ['core'],
    });
    expect(await processBillingWebhook(good.body, new Headers(good.headers), 'stripe', deps)).toEqual({
      status: 404,
      body: null,
      verified: true,
    });
  });

  it('acknowledges an unknown customer without touching any org', async () => {
    const e = signFakeBillingEvent(SECRET, {
      kind: 'entitlements',
      type: 'entitlements.active_entitlement_summary.updated',
      customerId: 'fakecus_nobody',
      features: ['core'],
    });
    expect((await deliver(e.body, e.headers)).body).toEqual({ outcome: 'unknown_customer' });
  });
});

describe('tenant isolation (M6.6a)', () => {
  it('an event for one org’s customer changes that org only', async () => {
    await changePlan(b, 'tier_free');
    expect(await modules(b)).not.toContain('sessions');
    expect(await modules(a)).toContain('sessions');
    await changePlan(b, 'tier_pro');
  });

  it('the apply command refuses another org’s customer even when run in the wrong org', async () => {
    const out = await executeCommand(
      applyBillingEventCommand,
      {
        kind: 'entitlements',
        provider: 'fake',
        id: `fakeevt_${uuidv7()}`,
        type: 'entitlements.active_entitlement_summary.updated',
        createdAt: tick(),
        customerId: customerB,
        features: ['core'],
      },
      systemCtx(a.org.id),
      ports,
    );
    expect(out.outcome).toBe('unknown_customer');
    expect(await modules(a)).toContain('sessions');
  });

  it('an org sees only its own billing rows', async () => {
    const rows = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ org_id: string }>(sql`
        select org_id from billing.org_billing union all select org_id from billing.subscriptions
        union all select org_id from billing.org_entitlements union all select org_id from billing.provider_events`),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.org_id))).toEqual(new Set([a.org.id]));
  });

  it('the customer lookup resolves each customer to its own org only', async () => {
    const [r] = await withoutTenant((tx) =>
      tx.execute<{ a: string | null; b: string | null; x: string | null }>(sql`
        select billing.org_for_customer('fake', ${customerA}) as a,
               billing.org_for_customer('fake', ${customerB}) as b,
               billing.org_for_customer('stripe', ${customerA}) as x`),
    );
    expect(r).toEqual({ a: a.org.id, b: b.org.id, x: null });
  });
});

describe('permissions (M6.6a)', () => {
  it('members cannot apply provider events or link customers; only the system can', async () => {
    const input = {
      kind: 'entitlements' as const,
      provider: 'fake' as const,
      id: `fakeevt_${uuidv7()}`,
      type: 'x',
      createdAt: tick(),
      customerId: customerA,
      features: [...MODULE_KEYS],
    };
    expect(await refused(executeCommand(applyBillingEventCommand, input, a.ctx(), ports))).toBe('forbidden');
    expect(
      await refused(
        executeCommand(
          linkBillingCustomerCommand,
          { provider: 'fake', customerId: 'fakecus_x' },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('forbidden');
    expect(
      await refused(
        executeCommand(setLegacyFeesCommand, { grandfathered: false, note: 'nope' }, a.ctx(), ports),
      ),
    ).toBe('forbidden');
  });

  it('owners read the plan page; viewers are refused', async () => {
    expect((await executeQuery(planSummaryQuery, {}, a.ctx(), ports)).plan.key).toBeTruthy();
    expect(await refused(executeQuery(planSummaryQuery, {}, userCtx(a.viewerId, a.org.id), ports))).toBe(
      'forbidden',
    );
  });
});

describe('billing customers and legacy fees (M6.6a)', () => {
  it('links a customer once through the provider; a different one is refused', async () => {
    const c = await createOrgFixture(`billing-${uuidv7().slice(-8)}`, 'Billing Charlie');
    const ctx = systemCtx(c.org.id);
    // The fixture linked its own customer: ensure keeps it.
    const existing = await ensureBillingCustomer(provider, ctx, ports);
    expect(existing).toMatch(/^fakecus_fixture_/);
    const again = await executeCommand(
      linkBillingCustomerCommand,
      { provider: 'fake', customerId: existing },
      ctx,
      ports,
    );
    expect(again.linked).toBe(false);
    expect(
      await refused(
        executeCommand(
          linkBillingCustomerCommand,
          { provider: 'fake', customerId: 'fakecus_other' },
          ctx,
          ports,
        ),
      ),
    ).toBe('conflict');
  });

  it('a non-grandfathered org’s fee plan follows its subscription; a grandfathered one keeps legacy fees', async () => {
    const ctx = systemCtx(b.org.id);
    await executeCommand(
      setLegacyFeesCommand,
      { grandfathered: false, note: 'test: new pricing' },
      ctx,
      ports,
    );
    await changePlan(b, 'tier_starter');
    const s1 = await executeQuery(planSummaryQuery, {}, b.ctx(), ports);
    expect(s1.feePlan.key).toBe('tier_starter');
    expect(s1.legacyFees).toEqual({ grandfathered: false, reason: null });
    // Tier fee schedules are copies of the legacy one until the owner prices plans (D22).
    const [fees] = await withoutTenant((tx) =>
      tx.execute<{ same: boolean }>(sql`
        select bool_and(t.percent_bps = l.percent_bps and t.fixed_minor = l.fixed_minor) as same
        from billing.fee_schedules t join billing.fee_schedules l on l.currency = t.currency
        where t.plan_key = 'tier_starter' and l.plan_key = 'launch_standard'`),
    );
    expect(fees?.same).toBe(true);
    await changePlan(b, 'tier_starter', 'canceled');
    expect((await executeQuery(planSummaryQuery, {}, b.ctx(), ports)).feePlan.key).toBe('launch_standard');

    await executeCommand(
      setLegacyFeesCommand,
      { grandfathered: true, note: 'test: back to legacy' },
      ctx,
      ports,
    );
    await changePlan(b, 'tier_agency');
    const s2 = await executeQuery(planSummaryQuery, {}, b.ctx(), ports);
    expect(s2.plan.key).toBe('tier_agency');
    expect(s2.feePlan.key).toBe('launch_standard');
    expect(s2.legacyFees).toEqual({ grandfathered: true, reason: 'staff' });
  });
});

describe('seeded catalog (M6.6a migration)', () => {
  it('matches the placeholder plans, switched off', async () => {
    const rows = await withoutTenant((tx) =>
      tx.execute<{ key: string; name: string; active: boolean; sort_order: number; modules: string[] }>(sql`
        select p.key, p.name, c.active, c.sort_order,
          (select array_agg(m.module_key order by m.module_key) from billing.plan_modules m where m.plan_key = p.key) as modules
        from billing.plans p join billing.plan_catalog c on c.plan_key = p.key
        where p.key like 'tier\\_%' and p.key in (${sql.join(
          PLACEHOLDER_PLANS.map((x) => sql`${x.key}`),
          sql`, `,
        )}) order by c.sort_order`),
    );
    expect(rows).toEqual(
      PLACEHOLDER_PLANS.map((p) => ({
        key: p.key,
        name: p.name,
        active: false,
        sort_order: p.sortOrder,
        modules: [...p.modules].sort(),
      })),
    );
    const prices = await withoutTenant((tx) =>
      tx.execute<{ lookup_key: string; unit_amount_minor: string | null; active: boolean }>(
        sql`select lookup_key, unit_amount_minor, active from billing.plan_prices where plan_key like 'tier\\_%' order by lookup_key`,
      ),
    );
    const want = PLACEHOLDER_PLANS.flatMap((p) => p.prices)
      .map((x) => ({
        lookup_key: x.lookupKey,
        unit_amount_minor: x.unitAmountMinor === null ? null : String(x.unitAmountMinor),
        active: false,
      }))
      .sort((x, y) => x.lookup_key.localeCompare(y.lookup_key));
    expect(prices.filter((p) => want.some((w) => w.lookup_key === p.lookup_key))).toEqual(want);
  });

  it('registers every Phase 6 module key (P6-13) on the legacy plan', async () => {
    const rows = await withoutTenant((tx) =>
      tx.execute<{ module_key: string }>(
        sql`select module_key from billing.plan_modules where plan_key = 'launch_standard'`,
      ),
    );
    const keys = rows.map((r) => r.module_key);
    for (const k of PHASE6_MODULE_KEYS) expect(keys).toContain(k);
    expect([...keys].sort()).toEqual([...MODULE_KEYS].sort());
  });

  it('app_user cannot write the catalog or call the catalog sync', async () => {
    for (const stmt of [
      sql`insert into billing.plan_prices (lookup_key, plan_key, currency, billing_interval) values ('x_month_usd', 'tier_pro', 'USD', 'month')`,
      sql`update billing.plan_catalog set active = true`,
      sql`select billing.apply_catalog('{}'::jsonb)`,
    ])
      expect(await pgError(withoutTenant((tx) => tx.execute(stmt)))).toBe('42501');
  });
});
