import { billingEntitlements } from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { expireOrdersCommand } from '@yayatoh/orders';
import { createCommandPorts } from '@yayatoh/platform';
import { orgAuthorizer } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';

const ports = createCommandPorts({ entitlements: billingEntitlements, authorizer: orgAuthorizer });

/**
 * Hold sweeper (roadmap §5.2: every 30 s). Finds orgs with lapsed holds through a
 * SECURITY DEFINER function, then releases them per org under that org's RLS.
 */
export async function sweepExpiredHolds(): Promise<number> {
  const orgs = await withPlatformReader(
    { actor: 'system:sweeper', reason: 'find orgs with expired checkout holds' },
    (tx) => tx.execute<{ org_id: string }>(sql`select org_id from orders.orgs_with_due_holds(100)`),
  );
  let total = 0;
  for (const { org_id } of orgs) {
    const ctx = createCtx({ orgId: org_id, actor: { type: 'system', name: 'orders.sweeper' } });
    total += (await executeCommand(expireOrdersCommand, { limit: 200 }, ctx, ports)).expired;
  }
  return total;
}
