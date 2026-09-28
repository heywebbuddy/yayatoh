import { withPlatformReader } from '@yayatoh/db/platform';
import { rebuildOrgMetrics } from '@yayatoh/reports';
import { sql } from 'drizzle-orm';

/**
 * Rebuild the metric projections of every org (or the given ones) from the source tables
 * (M3.1): after the migration that adds them, after a backfill, or to repair drift. Orgs are
 * listed through platform_reader (audited); each org is rebuilt under its own RLS.
 */
export async function runMetricsRebuild(opts: { onlyOrgs?: readonly string[] } = {}) {
  const rows = opts.onlyOrgs
    ? opts.onlyOrgs.map((org_id) => ({ org_id }))
    : await withPlatformReader(
        { actor: 'system:metrics-rebuild', reason: 'list organizations to rebuild metric projections' },
        (tx) =>
          tx.execute<{ org_id: string }>(
            sql`select id as org_id from tenancy.organizations where status <> 'terminated' order by id`,
          ),
      );
  let events = 0;
  let failed = 0;
  for (const { org_id } of rows) {
    try {
      events += (await rebuildOrgMetrics(org_id)).events;
    } catch (err) {
      failed++;
      console.error(JSON.stringify({ job: 'metrics-rebuild', org: org_id, error: String(err) }));
    }
  }
  return { orgs: rows.length, events, failed };
}
