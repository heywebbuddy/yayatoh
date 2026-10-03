import { type BillingProvider, catalogSyncPayload } from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import { sql } from 'drizzle-orm';

export interface CatalogSyncResult {
  readonly plans: number;
  readonly prices: number;
  readonly features: number;
  readonly skipped: readonly { kind: string; id: string; reason: string }[];
}

/**
 * Mirror the billing provider's catalog into the plan tables (M6.6a, P6-7): products → plans and
 * their modules (Entitlement Features), prices by lookup key, features by module key. Runs as
 * platform_reader through the SECURITY DEFINER `billing.apply_catalog`, audited; the worker runs
 * it hourly while billing is switched on, and staff run it by hand (`billing:sync-catalog`).
 */
export async function syncBillingCatalog(provider: BillingProvider, by = 'system:billing-catalog') {
  const payload = catalogSyncPayload(await provider.listCatalog());
  const [row] = await withPlatformReader(
    { actor: by, reason: `mirror the ${provider.name} billing catalog` },
    (tx) =>
      tx.execute<{ applied: { plans: number; prices: number; features: number } }>(
        sql`select billing.apply_catalog(${JSON.stringify({
          plans: payload.plans,
          prices: payload.prices,
          features: payload.features,
        })}::jsonb) as applied`,
      ),
    { callsWritingFunctions: true },
  );
  const applied = row?.applied ?? { plans: 0, prices: 0, features: 0 };
  return { ...applied, skipped: payload.skipped } satisfies CatalogSyncResult;
}
