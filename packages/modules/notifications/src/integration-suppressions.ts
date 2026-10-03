import { normalizeEmail } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { addressSuppressions, type INTEGRATION_SUPPRESSION_SOURCES, suppressions } from './schema.ts';

/**
 * Suppressions a connected marketing tool reports (M6.4d). An unsubscribe there stops marketing
 * mail here (`suppressions`, category `marketing`, the provider as `source`); an address the
 * provider cleaned (hard bounce) or a complaint stops every category (`address_suppressions`).
 * Both are idempotent: a replayed sync writes nothing. Returns whether a row was written.
 */
export async function suppressFromIntegrationTx(
  tx: TenantTx,
  orgId: string,
  email: string,
  source: (typeof INTEGRATION_SUPPRESSION_SOURCES)[number],
): Promise<boolean> {
  const rows = await tx
    .insert(suppressions)
    .values({ orgId, emailNorm: normalizeEmail(email), category: 'marketing', source })
    .onConflictDoNothing()
    .returning({ id: suppressions.id });
  return rows.length > 0;
}

export async function suppressAddressFromIntegrationTx(
  tx: TenantTx,
  orgId: string,
  email: string,
  reason: 'hard_bounce' | 'complaint',
): Promise<boolean> {
  const rows = await tx
    .insert(addressSuppressions)
    .values({ orgId, channel: 'email', addressNorm: normalizeEmail(email), reason })
    .onConflictDoNothing()
    .returning({ id: addressSuppressions.id });
  return rows.length > 0;
}
