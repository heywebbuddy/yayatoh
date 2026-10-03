import {
  type BillingProvider,
  fakeBillingCatalog,
  fakeBillingProvider,
  PLACEHOLDER_PLANS,
  type ProviderCatalog,
} from '@yayatoh/billing';
import { withoutTenant } from '@yayatoh/db';
import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { uuidv7 } from '@yayatoh/kernel';
import { MODULE_KEYS } from '@yayatoh/platform';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncBillingCatalog } from '../src/billing-catalog.ts';

const audited: string[] = [];
beforeAll(() => setPlatformAuditSink(async (a) => void audited.push(a.reason)));
afterAll(async () => {
  // Leave the catalog as the migration seeded it (the fake's placeholder tiers).
  await syncBillingCatalog(fakeBillingProvider({ secret: 'c'.repeat(64) }), 'test:cleanup');
  await closePools();
});

// The fake provider with a different catalog (M6.6b added methods this test never calls).
const withCatalog = (catalog: ProviderCatalog): BillingProvider => ({
  ...fakeBillingProvider({ secret: 'c'.repeat(64) }),
  listCatalog: async () => catalog,
});

const read = <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) =>
  withoutTenant((tx) => tx.execute<T>(q));

describe('billing catalog sync (M6.6a)', () => {
  it('mirrors the fake provider: placeholder tiers stay off, provider ids recorded, audited', async () => {
    const r = await syncBillingCatalog(fakeBillingProvider({ secret: 'c'.repeat(64) }));
    expect(r).toEqual({
      plans: PLACEHOLDER_PLANS.length,
      prices: PLACEHOLDER_PLANS.flatMap((p) => p.prices).length,
      features: MODULE_KEYS.length,
      skipped: [],
    });
    expect(audited).toContain('mirror the fake billing catalog');
    const rows = await read<{ plan_key: string; active: boolean; provider_product_id: string }>(
      sql`select plan_key, active, provider_product_id from billing.plan_catalog where plan_key like 'tier\\_%' order by sort_order`,
    );
    expect(rows.filter((x) => PLACEHOLDER_PLANS.some((p) => p.key === x.plan_key))).toEqual(
      PLACEHOLDER_PLANS.map((p) => ({
        plan_key: p.key,
        active: false,
        provider_product_id: `fakeprod_${p.key}`,
      })),
    );
    const [price] = await read<{ provider_price_id: string; active: boolean }>(
      sql`select provider_price_id, active from billing.plan_prices where lookup_key = 'tier_pro_month_usd'`,
    );
    expect(price).toEqual({ provider_price_id: 'fakeprice_tier_pro_month_usd', active: false });
    const [f] = await read<{ n: number }>(
      sql`select count(*)::int as n from billing.features where active and provider_feature_id like 'fakefeat_%'`,
    );
    expect(f?.n).toBe(MODULE_KEYS.length);
  });

  it('a plan added in the provider appears with its modules and legacy fees, and is switched off when removed', async () => {
    const key = `tier_test_${uuidv7().slice(-8)}`;
    const base = fakeBillingCatalog();
    const withPlan: ProviderCatalog = {
      ...base,
      products: [
        ...base.products,
        {
          id: `fakeprod_${key}`,
          planKey: key,
          name: 'Test plan',
          active: true,
          sortOrder: 9,
          features: ['core', 'sessions'],
        },
      ],
      prices: [
        ...base.prices,
        {
          id: `fakeprice_${key}`,
          productId: `fakeprod_${key}`,
          lookupKey: `${key}_month_usd`,
          currency: 'USD',
          interval: 'month',
          unitAmountMinor: 1500,
          active: true,
        },
      ],
    };
    await syncBillingCatalog(withCatalog(withPlan));
    const mods = await read<{ module_key: string }>(
      sql`select module_key from billing.plan_modules where plan_key = ${key} order by module_key`,
    );
    expect(mods.map((m) => m.module_key)).toEqual(['core', 'sessions']);
    const [fees] = await read<{ same: boolean; n: number }>(sql`
      select count(*)::int as n, bool_and(t.percent_bps = l.percent_bps and t.fixed_minor = l.fixed_minor) as same
      from billing.fee_schedules t join billing.fee_schedules l on l.currency = t.currency and l.plan_key = 'launch_standard'
      where t.plan_key = ${key}`);
    expect(fees?.same).toBe(true);
    expect(fees?.n).toBeGreaterThan(0);

    // Twice is the same as once.
    await syncBillingCatalog(withCatalog(withPlan));
    const [again] = await read<{ n: number }>(
      sql`select count(*)::int as n from billing.plan_modules where plan_key = ${key}`,
    );
    expect(again?.n).toBe(2);

    // Gone from the provider: switched off, never deleted (subscriptions may still point at it).
    await syncBillingCatalog(withCatalog(base));
    const [plan] = await read<{ active: boolean }>(
      sql`select active from billing.plan_catalog where plan_key = ${key}`,
    );
    const [price] = await read<{ active: boolean }>(
      sql`select active from billing.plan_prices where lookup_key = ${`${key}_month_usd`}`,
    );
    expect([plan?.active, price?.active]).toEqual([false, false]);
  });

  it('never touches the legacy plan, and the database refuses it even if asked directly', async () => {
    const before = await read<{ module_key: string }>(
      sql`select module_key from billing.plan_modules where plan_key = 'launch_standard' order by 1`,
    );
    const r = await syncBillingCatalog(
      withCatalog({
        products: [
          {
            id: 'prod_legacy',
            planKey: 'launch_standard',
            name: 'Legacy',
            active: true,
            sortOrder: 0,
            features: ['core'],
          },
        ],
        prices: [],
        features: [],
      }),
    );
    expect(r.skipped).toEqual([
      { kind: 'product', id: 'prod_legacy', reason: 'plan_key not allowed: launch_standard' },
    ]);
    const after = await read<{ module_key: string }>(
      sql`select module_key from billing.plan_modules where plan_key = 'launch_standard' order by 1`,
    );
    expect(after).toEqual(before);
  });
});
