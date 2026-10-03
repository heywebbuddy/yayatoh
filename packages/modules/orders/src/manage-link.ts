import type { TenantTx } from '@yayatoh/db';
import { keyVault } from '@yayatoh/platform';
import { eq } from 'drizzle-orm';
import { orders } from './schema.ts';

/**
 * M5.2b: an order's manage token and locale, for an email that links back to the buyer's pages
 * (the session schedule). Decrypted from its envelope under the org's RLS; never stored in an
 * event payload. Null when the order is unknown or its token was erased (DSAR).
 */
export async function orderManageTokenTx(
  tx: TenantTx,
  orgId: string,
  orderId: string,
): Promise<{ token: string; locale: string } | null> {
  const [o] = await tx
    .select({ ciphertext: orders.manageTokenCiphertext, locale: orders.locale })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!o?.ciphertext) return null;
  const token = new TextDecoder().decode(await keyVault().decrypt(orgId, o.ciphertext));
  return { token, locale: o.locale };
}
