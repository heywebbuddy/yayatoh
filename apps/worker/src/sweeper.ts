import { billingEntitlements } from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { expireOrdersCommand, sweepWaitlistsCommand } from '@yayatoh/orders';
import { createCommandPorts, localKeyVault, setKeyVault } from '@yayatoh/platform';
import { orgAuthorizer, orgStatusGate } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';

if (process.env.LOCAL_KMS_KEY) setKeyVault(localKeyVault(process.env.LOCAL_KMS_KEY));

// The org gate (M1.3f) lets system actors through; wired for parity with the apps.
const ports = createCommandPorts({
  entitlements: billingEntitlements,
  authorizer: orgAuthorizer,
  orgGate: orgStatusGate,
});

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

/**
 * Waitlist sweeper (M3.10a), right after the hold sweeper: lapsed offers release their stock and
 * freed stock is offered to the next people in line, per org under that org's RLS.
 */
export async function sweepWaitlists(): Promise<{ expired: number; offered: number }> {
  const orgs = await withPlatformReader(
    { actor: 'system:sweeper', reason: 'find orgs with waitlist offers to make or expire' },
    (tx) => tx.execute<{ org_id: string }>(sql`select org_id from orders.orgs_with_waitlist_work(100)`),
  );
  const total = { expired: 0, offered: 0 };
  for (const { org_id } of orgs) {
    const ctx = createCtx({ orgId: org_id, actor: { type: 'system', name: 'orders.waitlist-sweeper' } });
    try {
      const r = await executeCommand(sweepWaitlistsCommand, { limit: 200 }, ctx, ports);
      total.expired += r.expired;
      total.offered += r.offered;
    } catch (err) {
      // One org's failure (a lock timeout, a deadlock) never stops the others; the next tick retries.
      console.error('waitlist sweeper', org_id, err);
    }
  }
  return total;
}
