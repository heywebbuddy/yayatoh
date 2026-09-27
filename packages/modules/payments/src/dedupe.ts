import type { TenantTx } from '@yayatoh/db';
import type { ProviderEvent } from './port.ts';
import { providerEvents } from './schema.ts';

/** Record a provider event inside the fulfilment transaction; false if already processed. */
export async function claimProviderEventTx(tx: TenantTx, e: ProviderEvent): Promise<boolean> {
  const rows = await tx
    .insert(providerEvents)
    .values({ orgId: e.orgId, provider: e.provider, providerEventId: e.id, type: e.type })
    .onConflictDoNothing()
    .returning({ id: providerEvents.id });
  return rows.length === 1;
}
