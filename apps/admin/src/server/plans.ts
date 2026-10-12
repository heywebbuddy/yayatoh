import 'server-only';
import { AdminPlanInput, billingProviderFromEnv } from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import { currencyExponent } from '@yayatoh/kernel';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';

export interface AdminPrice {
  lookupKey: string;
  currency: string;
  interval: 'month' | 'year';
  unitAmountMinor: number | null;
  active: boolean;
  priceId: string | null;
}
export interface AdminPlan {
  key: string;
  name: string;
  active: boolean;
  sortOrder: number;
  productId: string | null;
  managedLocally: boolean;
  modules: string[];
  prices: AdminPrice[];
  organizations: number;
  subscriptions: number;
}

export async function listAdminPlans(actor: string): Promise<AdminPlan[]> {
  return withPlatformReader({ actor, reason: 'staff console: view billing plans' }, (tx) =>
    tx.execute<AdminPlan & Record<string, unknown>>(sql`
      select p.key, p.name, coalesce(c.active, false) as active,
        coalesce(c.sort_order, -1) as "sortOrder", c.provider_product_id as "productId",
        coalesce(c.managed_locally, false) as "managedLocally",
        coalesce((select jsonb_agg(m.module_key order by m.module_key) from billing.plan_modules m where m.plan_key = p.key), '[]'::jsonb) as modules,
        coalesce((select jsonb_agg(jsonb_build_object('lookupKey', x.lookup_key, 'currency', x.currency,
          'interval', x.billing_interval, 'unitAmountMinor', x.unit_amount_minor, 'active', x.active,
          'priceId', x.provider_price_id) order by x.lookup_key) from billing.plan_prices x where x.plan_key = p.key), '[]'::jsonb) as prices,
        (select count(*)::int from tenancy.organizations o left join billing.org_plans op on op.org_id = o.id
          where coalesce(op.plan_key, 'launch_standard') = p.key) as organizations,
        (select count(*)::int from billing.subscriptions s where s.plan_key = p.key and s.status in ('active', 'trialing', 'past_due')) as subscriptions
      from billing.plans p left join billing.plan_catalog c on c.plan_key = p.key order by coalesce(c.sort_order, -1), p.key`),
  );
}

export function priceAmount(text: string, currency: string): number {
  const exponent = currencyExponent(currency);
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('invalid_price');
  const [whole = '', fraction = ''] = text.split('.');
  if (fraction.length > exponent) throw new Error('invalid_price');
  const amount = BigInt(whole) * 10n ** BigInt(exponent) + BigInt(fraction.padEnd(exponent, '0') || '0');
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('invalid_price');
  return Number(amount);
}

export function parsePlanForm(form: FormData): z.infer<typeof AdminPlanInput> {
  const key = String(form.get('key') ?? '').trim();
  const keys = form.getAll('priceKey').map(String);
  const amounts = form.getAll('amount').map(String);
  const currencies = form.getAll('currency').map((v) => String(v).trim().toUpperCase());
  const intervals = form.getAll('interval').map(String);
  const ids = form.getAll('priceId').map(String);
  const enabled = new Set(form.getAll('priceActive').map(String));
  return AdminPlanInput.parse({
    key,
    name: String(form.get('name') ?? ''),
    active: form.get('active') === 'yes',
    sortOrder: Number(form.get('sortOrder')),
    productId: String(form.get('productId') ?? '').trim() || null,
    modules: [...new Set(form.getAll('module').map(String))],
    prices: keys.flatMap((lookupKey, index) => {
      const amount = amounts[index]?.trim() ?? '';
      if (!amount && !lookupKey.trim()) return [];
      const currency = currencies[index] ?? '';
      return [
        {
          lookupKey: lookupKey.trim() || `${key}_${intervals[index]}_${currency.toLowerCase()}`,
          currency,
          interval: intervals[index],
          unitAmountMinor: amount ? priceAmount(amount, currency) : null,
          active: enabled.has(String(index)),
          priceId: ids[index]?.trim() || null,
        },
      ];
    }),
  });
}

export async function saveAdminPlan(
  actor: string,
  input: z.infer<typeof AdminPlanInput>,
  reason: string,
  create = false,
): Promise<void> {
  const plan = AdminPlanInput.parse(input);
  if (reason.trim().length < 3 || reason.length > 500) throw new Error('invalid_reason');
  if (plan.active && !plan.prices.some((p) => p.active && p.unitAmountMinor !== null))
    throw new Error('active_price_required');
  // Stripe remains the source of actual charges and subscription entitlements. Check the mirror
  // before making a plan purchasable; never advertise prices or features Stripe cannot deliver.
  if (plan.active && process.env.BILLING_PROVIDER === 'stripe') {
    const catalog = await billingProviderFromEnv().listCatalog();
    const product = catalog.products.find(
      (p) => p.id === plan.productId && p.planKey === plan.key && p.active,
    );
    if (!product || [...product.features].sort().join(',') !== [...plan.modules].sort().join(','))
      throw new Error('provider_mismatch');
    for (const price of plan.prices.filter((p) => p.active)) {
      if (
        !catalog.prices.some(
          (p) =>
            p.active &&
            p.productId === product.id &&
            p.lookupKey === price.lookupKey &&
            p.id === price.priceId &&
            p.currency === price.currency &&
            p.interval === price.interval &&
            p.unitAmountMinor === price.unitAmountMinor,
        )
      )
        throw new Error('provider_mismatch');
    }
  }
  await withPlatformReader(
    { actor, reason: `staff console: save billing plan ${plan.key}: ${reason.trim()}` },
    async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('billing.catalog'))`);
      if (create) {
        const [existing] = await tx.execute<{ key: string }>(
          sql`select key from billing.plans where key = ${plan.key}`,
        );
        if (existing) throw new Error('invalid_plan');
      }
      return tx.execute(
        sql`select billing.admin_save_plan(${JSON.stringify(plan)}::jsonb, ${actor}, ${reason.trim()})`,
      );
    },
    { callsWritingFunctions: true },
  );
}
