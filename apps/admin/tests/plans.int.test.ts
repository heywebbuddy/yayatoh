import {
  assignOrganizationPlanCommand,
  changeSubscriptionPlan,
  effectiveModules,
  fakeBillingProvider,
  feeScheduleQuery,
  persistedBillingCatalog,
  planChangeOptionsQuery,
  planSummaryQuery,
  previewPlanChange,
  processBillingWebhook,
  setEntitlementOverrideCommand,
} from '@yayatoh/billing';
import { withoutTenant } from '@yayatoh/db';
import { databaseAuditSink, setPlatformAuditSink, withPlatformReader } from '@yayatoh/db/platform';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { createOrganization } from '@yayatoh/tenancy';
import { ports, userCtx } from '@yayatoh/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { listAdminPlans, saveAdminPlan } from '../src/server/plans.ts';

const admin = adminClient();
const staffId = uuidv7();
const actor = `staff:${staffId}`;
const key = `test_${staffId.replaceAll('-', '').slice(-10)}`;
const priceKey = `${key}_month_usd`;
const purchaseKey = `buy_${key}`;
const purchasePriceKey = `${purchaseKey}_month_usd`;
const input = {
  key,
  name: 'Admin test plan',
  active: true,
  sortOrder: 20,
  productId: null,
  modules: ['core', 'events', 'ticketing'],
  prices: [
    {
      lookupKey: priceKey,
      currency: 'USD',
      interval: 'month' as const,
      unitAmountMinor: 2900,
      active: true,
      priceId: null,
    },
  ],
};

beforeAll(async () => {
  setPlatformAuditSink(databaseAuditSink);
  await admin`insert into platform.staff(user_id, role, added_by) values (${staffId}, 'admin', 'test')`;
});

it('purchases an admin-created plan through signed provider webhooks and removes deactivated plans from offers', async () => {
  vi.stubEnv('BILLING_ENABLED', '1');
  vi.stubEnv('BILLING_PROVIDER', 'fake');
  try {
    const purchaseInput = {
      ...input,
      key: purchaseKey,
      prices: input.prices.map((p) => ({ ...p, lookupKey: purchasePriceKey })),
    };
    await saveAdminPlan(actor, purchaseInput, 'Create purchase test plan');
    const owner = uuidv7();
    const org = await createOrganization(
      userCtx(owner),
      { name: 'Billing flow org', slug: `billing-${staffId.slice(-8)}` },
      ports,
    );
    const system = createCtx({ orgId: org.id, actor: { type: 'system', name: actor } });
    const ctx = { ...userCtx(owner, org.id), idempotencyKey: uuidv7() };
    const provider = fakeBillingProvider({
      secret: 'admin-catalog-test-secret'.padEnd(64, 'x'),
      catalog: persistedBillingCatalog,
      deliver: async (delivery) => {
        const result = await processBillingWebhook(delivery.body, new Headers(delivery.headers), 'fake', {
          provider: () => provider,
          ports,
        });
        expect(result.status).toBe(200);
      },
    });
    const preview = await previewPlanChange(provider, ctx, ports, { priceLookupKey: purchasePriceKey });
    const result = await changeSubscriptionPlan(provider, ctx, system, ports, {
      priceLookupKey: purchasePriceKey,
      confirmRemoved: true,
      shown: {
        currency: preview.currency,
        amountDueMinor: preview.amountDueMinor,
        taxMinor: preview.taxMinor,
        discountMinor: preview.discountMinor,
      },
    });
    expect(result.outcome).toBe('submitted');
    const summary = await executeQuery(planSummaryQuery, {}, ctx, ports);
    expect(summary.plan).toMatchObject({ key: purchaseKey, name: input.name, source: 'subscription' });
    expect(summary.subscription).toMatchObject({
      live: true,
      status: 'active',
      price: { unitAmountMinor: 2900 },
    });
    expect(summary.modules).toEqual(['core', 'events', 'ticketing']);
    await saveAdminPlan(actor, { ...purchaseInput, active: false }, 'Archive test plan');
    expect(
      (await executeQuery(planChangeOptionsQuery, {}, ctx, ports)).offers.some(
        (p) => p.planKey === purchaseKey,
      ),
    ).toBe(false);
    expect([...(await effectiveModules(ctx))].sort()).toEqual(['core', 'events', 'ticketing']);
  } finally {
    vi.unstubAllEnvs();
  }
});
afterAll(async () => {
  await admin`delete from billing.subscriptions where plan_key in (${key}, ${purchaseKey})`;
  await admin`delete from billing.org_plans where plan_key in (${key}, ${purchaseKey})`;
  await admin`delete from billing.plan_changes where to_plan_key in (${key}, ${purchaseKey})`;
  await admin`delete from billing.fee_schedules where plan_key in (${key}, ${purchaseKey})`;
  await admin`delete from billing.plan_prices where plan_key in (${key}, ${purchaseKey})`;
  await admin`delete from billing.plan_modules where plan_key in (${key}, ${purchaseKey})`;
  await admin`delete from billing.plan_catalog where plan_key in (${key}, ${purchaseKey})`;
  await admin`delete from billing.plans where key in (${key}, ${purchaseKey})`;
  await admin`delete from platform.staff where user_id = ${staffId}`;
  await admin.end();
  await closePools();
});

it('saves real plans, preserves other plans during sync, assigns access and fees, and refuses subscription overwrite', async () => {
  const prior = await listAdminPlans(actor);
  await saveAdminPlan(actor, input, 'Testing admin plan creation');
  expect(await listAdminPlans(actor)).toContainEqual(
    expect.objectContaining({ key, managedLocally: true, modules: ['core', 'events', 'ticketing'] }),
  );
  expect((await listAdminPlans(actor)).length).toBe(prior.length + 1);
  const features =
    await admin`select module_key as "moduleKey", provider_feature_id as "featureId", active from billing.features`;
  const restore = {
    plans: prior.filter((p) => p.key !== 'launch_standard'),
    prices: prior.flatMap((p) => p.prices.map((price) => ({ ...price, planKey: p.key }))),
    features,
  };
  await withPlatformReader(
    { actor, reason: 'test provider sync preserves admin plans' },
    (tx) => tx.execute(sql`select billing.apply_catalog('{"plans":[],"prices":[],"features":[]}'::jsonb)`),
    { callsWritingFunctions: true },
  );
  const saved = (await listAdminPlans(actor)).find((p) => p.key === key);
  expect(saved?.active).toBe(true);
  expect(saved?.prices[0]?.unitAmountMinor).toBe(2900);
  await withPlatformReader(
    { actor, reason: 'restore provider catalog after sync test' },
    (tx) => tx.execute(sql`select billing.apply_catalog(${JSON.stringify(restore)}::jsonb)`),
    { callsWritingFunctions: true },
  );
  await expect(saveAdminPlan(`staff:${uuidv7()}`, input, 'Not an admin')).rejects.toThrow();
  await expect(
    withoutTenant((tx) =>
      tx.execute(
        sql`select billing.admin_save_plan(${JSON.stringify(input)}::jsonb, ${actor}, 'Forbidden app write')`,
      ),
    ),
  ).rejects.toThrow();
  const owner = uuidv7();
  const org = await createOrganization(
    userCtx(owner),
    { name: 'Plan test org', slug: `plan-${staffId.slice(-8)}` },
    ports,
  );
  const ctx = createCtx({ orgId: org.id, actor: { type: 'system', name: actor } });
  const ownerCtx = userCtx(owner, org.id);
  await executeCommand(
    setEntitlementOverrideCommand,
    { moduleKey: 'reports', effect: 'grant', reason: 'Keep existing override' },
    ctx,
    ports,
  );
  const feesBefore = await executeQuery(feeScheduleQuery, { currency: 'USD' }, ownerCtx, ports);
  await executeCommand(
    assignOrganizationPlanCommand,
    { planKey: key, reason: 'Test assigned plan' },
    ctx,
    ports,
  );
  expect([...(await effectiveModules(ownerCtx))].sort()).toEqual(['core', 'events', 'reports', 'ticketing']);
  expect((await executeQuery(planSummaryQuery, {}, ownerCtx, ports)).plan.key).toBe(key);
  expect(await executeQuery(feeScheduleQuery, { currency: 'USD' }, ownerCtx, ports)).toEqual(feesBefore);
  await admin`insert into billing.subscriptions (org_id, provider, provider_subscription_id, provider_customer_id, status, plan_key, price_lookup_key, last_event_at)
    values (${org.id}, 'fake', ${`sub_${key}`}, ${`customer_${key}`}, 'active', ${key}, ${priceKey}, now())`;
  await expect(
    executeCommand(
      assignOrganizationPlanCommand,
      { planKey: 'launch_standard', reason: 'Must not override' },
      ctx,
      ports,
    ),
  ).rejects.toThrow();
  await expect(
    saveAdminPlan(
      actor,
      { ...input, prices: input.prices.map((price) => ({ ...price, unitAmountMinor: 9900 })) },
      'Edit used price',
    ),
  ).rejects.toThrow();
});
