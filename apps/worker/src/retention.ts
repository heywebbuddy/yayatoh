import { billingEntitlements } from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import { purgeGuestImportsCommand } from '@yayatoh/guests';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { createCommandPorts, purgeRateLimits } from '@yayatoh/platform';
import { type RetentionResult, retentionCommand } from '@yayatoh/privacy';
import { LAG_RETENTION_MS, purgeProjectorLag } from '@yayatoh/reports';
import { orgAuthorizer, orgStatusGate } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';

// The org gate (M1.3f) lets system actors through; wired for parity with the apps.
const ports = createCommandPorts({
  entitlements: billingEntitlements,
  authorizer: orgAuthorizer,
  orgGate: orgStatusGate,
});

export interface RetentionRun {
  readonly orgs: number;
  readonly failed: number;
  readonly totals: RetentionResult;
  readonly rateLimits: number;
  readonly accessLog: number | null;
}

/**
 * The daily retention pass (M1.14c; leader only). Lists orgs through platform_reader (audited),
 * then runs `privacy.retention` per org under its own RLS as a system actor. Global housekeeping
 * follows: expired rate-limit counters, and (only once the owner has an off-account WORM
 * archive, `ACCESS_LOG_ARCHIVED=1`) platform access-log rows older than 12 months.
 */
export async function runRetention(opts: { onlyOrgs?: readonly string[] } = {}): Promise<RetentionRun> {
  const rows = opts.onlyOrgs
    ? opts.onlyOrgs.map((org_id) => ({ org_id }))
    : await withPlatformReader(
        { actor: 'system:retention', reason: 'list organizations for the daily retention pass' },
        (tx) =>
          tx.execute<{ org_id: string }>(
            sql`select id as org_id from tenancy.organizations where status <> 'terminated' order by id`,
          ),
      );
  const totals: Record<string, number> = {};
  let failed = 0;
  for (const { org_id } of rows) {
    const ctx = createCtx({ orgId: org_id, actor: { type: 'system', name: 'privacy.retention' } });
    try {
      const r = await executeCommand(retentionCommand, {}, ctx, ports);
      for (const [k, v] of Object.entries(r)) totals[k] = (totals[k] ?? 0) + v;
      // Metrics projector lag samples (M3.1): 7 days.
      await purgeProjectorLag(org_id, new Date(Date.now() - LAG_RETENTION_MS));
      // Guest-list imports (M4.1b): sealed staged rows are purged 72 hours after staging.
      await executeCommand(purgeGuestImportsCommand, {}, ctx, ports);
    } catch (err) {
      failed++;
      console.error(JSON.stringify({ job: 'retention', org: org_id, error: String(err) }));
    }
  }
  const rateLimits = await purgeRateLimits();
  let accessLog: number | null = null;
  if (process.env.ACCESS_LOG_ARCHIVED === '1') {
    const [row] = await withPlatformReader(
      { actor: 'system:retention', reason: 'purge platform access log older than 12 months (archived)' },
      (tx) =>
        tx.execute<{ n: number }>(sql`select platform.purge_access_log(now() - interval '12 months') as n`),
      { callsWritingFunctions: true },
    );
    accessLog = row?.n ?? 0;
  }
  return { orgs: rows.length, failed, totals: totals as RetentionResult, rateLimits, accessLog };
}
