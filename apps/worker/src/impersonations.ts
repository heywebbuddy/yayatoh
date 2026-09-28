import { dueImpersonations, endImpersonation, purgeHandoffCodes } from '@yayatoh/auth';
import { billingEntitlements } from '@yayatoh/billing';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { createCommandPorts } from '@yayatoh/platform';
import { endImpersonationCommand, orgAuthorizer } from '@yayatoh/tenancy';

const ports = createCommandPorts({ entitlements: billingEntitlements, authorizer: orgAuthorizer });

/**
 * Staff impersonations end after one hour (M1.2e). Their sessions already expire with them; this
 * marks them ended, deletes any session left, and writes the end into the org's audit log. Old
 * handoff codes (M1.2d) are purged on the same tick.
 */
export async function endExpiredImpersonations(now: Date = new Date()): Promise<number> {
  let ended = 0;
  for (const due of await dueImpersonations(now)) {
    const row = await endImpersonation(due.id, 'expired', now);
    if (!row) continue;
    const ctx = createCtx({ orgId: row.orgId, actor: { type: 'system', name: 'auth.impersonation-expiry' } });
    await executeCommand(
      endImpersonationCommand,
      { impersonationId: row.id, userId: row.userId, how: 'expired' },
      ctx,
      ports,
    );
    ended += 1;
  }
  await purgeHandoffCodes(now);
  return ended;
}
