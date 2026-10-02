import { billingEntitlements } from '@yayatoh/billing';
import { scanDuplicatesCommand } from '@yayatoh/crm';
import { withPlatformReader } from '@yayatoh/db/platform';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { createCommandPorts } from '@yayatoh/platform';
import { orgAuthorizer, orgStatusGate } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { defineJob } from './jobs.ts';

const ports = createCommandPorts({
  entitlements: billingEntitlements,
  authorizer: orgAuthorizer,
  orgGate: orgStatusGate,
});

export const DUPLICATE_SCAN_JOB = 'crm.duplicate-scan';

/**
 * Duplicate detection (M6.1a): one org's incremental scan (contacts created or changed since the
 * last one, compared with everyone), through the same command as "Look for duplicates now". The
 * queue is `exclusive` per org. Orgs without the module are skipped quietly.
 */
export function duplicateScanJob() {
  return defineJob({
    name: DUPLICATE_SCAN_JOB,
    scope: 'tenant',
    policy: 'exclusive',
    retryLimit: 2,
    payload: z.object({ orgId: z.uuid() }),
    handler: async ({ orgId }) => {
      const ctx = createCtx({ orgId, actor: { type: 'system', name: 'crm.duplicates' } });
      try {
        const r = await executeCommand(scanDuplicatesCommand, { full: false }, ctx, ports);
        if (r.found) console.info(JSON.stringify({ job: DUPLICATE_SCAN_JOB, orgId, ...r }));
      } catch (err) {
        if (isDomainError(err) && (err.code === 'module_not_enabled' || err.code === 'read_only_freeze')) return;
        throw err;
      }
    },
  });
}

/** Orgs with contacts changed since their last scan (platform_reader, audited). */
export async function orgsNeedingDuplicateScan(limit = 100): Promise<string[]> {
  const rows = await withPlatformReader(
    { actor: 'system:crm.duplicates', reason: 'find orgs with new or changed contacts to scan for duplicates' },
    (tx) => tx.execute<{ org_id: string }>(sql`select org_id from crm.orgs_needing_duplicate_scan(${limit})`),
  );
  return rows.map((r) => r.org_id);
}

/** Queue one scan per org with new contacts (leader, every few minutes). */
export async function enqueueDuplicateScans(boss: Pick<PgBoss, 'send'>): Promise<number> {
  let queued = 0;
  for (const orgId of await orgsNeedingDuplicateScan())
    if (await boss.send(DUPLICATE_SCAN_JOB, { orgId }, { singletonKey: orgId })) queued += 1;
  return queued;
}
