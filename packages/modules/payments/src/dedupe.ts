import type { TenantTx } from '@yayatoh/db';
import { providerEvents } from './schema.ts';

/** Record a provider event inside the fulfilment transaction; false if already processed. */
export async function claimProviderEventTx(
  tx: TenantTx,
  e: { orgId: string; provider: string; id: string; type: string },
): Promise<boolean> {
  const rows = await tx
    .insert(providerEvents)
    .values({ orgId: e.orgId, provider: e.provider, providerEventId: e.id, type: e.type })
    .onConflictDoNothing()
    .returning({ id: providerEvents.id });
  return rows.length === 1;
}
