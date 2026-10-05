import { type AnalyticsWarehouse, runBackfill } from '@yayatoh/analytics';
import { withPlatformReader } from '@yayatoh/db/platform';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { defineJob } from './jobs.ts';

export const BACKFILL_JOB = 'analytics.backfill';

/**
 * The warehouse backfill job (M6.2a): works one run for up to `budgetMs`, a page at a time at the
 * run's own pace (`pages_per_minute`), then ends; the leader's tick queues it again while the run
 * has a page due. The queue is `exclusive` per run (singleton key = run id). A crash rolls back
 * the page in progress and the next job resumes from the run's cursor.
 */
export function backfillJob(warehouse: AnalyticsWarehouse, opts: { budgetMs?: number } = {}) {
  return defineJob({
    name: BACKFILL_JOB,
    scope: 'tenant',
    policy: 'exclusive',
    retryLimit: 3,
    payload: z.object({ orgId: z.uuid(), runId: z.uuid() }),
    handler: async ({ orgId, runId }) => {
      const r = await runBackfill(orgId, runId, warehouse, { budgetMs: opts.budgetMs ?? 25_000 });
      if (r.pages) console.info(JSON.stringify({ job: BACKFILL_JOB, orgId, runId, ...r }));
    },
  });
}

/** Running backfills with a page due now, of every org (platform_reader, audited). */
export async function dueBackfills(limit = 50): Promise<{ orgId: string; runId: string }[]> {
  const rows = await withPlatformReader(
    { actor: 'system:analytics', reason: 'find warehouse backfills with a page due' },
    (tx) =>
      tx.execute<{ org_id: string; id: string }>(
        sql`select org_id, id from analytics.backfill_runs
          where status = 'running' and next_page_at <= now() order by next_page_at limit ${limit}`,
      ),
  );
  return rows.map((r) => ({ orgId: r.org_id, runId: r.id }));
}

/** Queue a job for each backfill with a page due (leader, every few seconds). */
export async function enqueueDueBackfills(
  boss: Pick<PgBoss, 'send'>,
  /** Tests: only these orgs (other test files' runs are left alone). */
  onlyOrgs?: ReadonlySet<string>,
): Promise<number> {
  const due = (await dueBackfills()).filter((d) => !onlyOrgs || onlyOrgs.has(d.orgId));
  let queued = 0;
  for (const d of due) if (await boss.send(BACKFILL_JOB, d, { singletonKey: d.runId })) queued += 1;
  return queued;
}
