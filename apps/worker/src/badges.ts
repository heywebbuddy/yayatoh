import { runBadgeBatch } from '@yayatoh/badges';
import { billingEntitlements } from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import type { PdfRenderer } from '@yayatoh/pdf';
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

export const BADGE_BATCH_JOB = 'badges.batch';

/**
 * The badge batch PDF job (M5.5a): renders one batch chunk by chunk through Gotenberg for up to
 * `budgetMs`, then ends; the leader's tick queues it again while the batch is unfinished. The
 * queue is `exclusive` per batch (singleton key = batch id). A crashed or lost job is safe to
 * run again (`runBadgeBatch`); a render that still fails after the adapter's own retry marks the
 * batch failed (the organizer sees it and starts a new one) rather than looping on it.
 */
export function badgeBatchJob(renderer: PdfRenderer, opts: { budgetMs?: number } = {}) {
  return defineJob({
    name: BADGE_BATCH_JOB,
    scope: 'tenant',
    policy: 'exclusive',
    retryLimit: 3,
    payload: z.object({ orgId: z.uuid(), batchId: z.uuid() }),
    handler: async ({ orgId, batchId }) => {
      const r = await runBadgeBatch({ ports, renderer }, orgId, batchId, {
        budgetMs: opts.budgetMs ?? 50_000,
        failOnError: true,
      });
      if (r.status !== 'running')
        console.info(JSON.stringify({ job: BADGE_BATCH_JOB, orgId, batchId, ...r }));
    },
  });
}

/**
 * Unfinished badge batches (platform_reader, audited), for the leader's tick: of every org, or
 * only of `onlyOrgs` (tests). The org filter is part of the query, so the limit applies to the
 * orgs asked for (filtering after it would starve them behind other orgs' older batches).
 */
export async function dueBadgeBatches(
  limit = 50,
  onlyOrgs?: ReadonlySet<string>,
): Promise<{ orgId: string; batchId: string }[]> {
  const orgs = onlyOrgs ? [...onlyOrgs] : null;
  if (orgs?.length === 0) return [];
  const rows = await withPlatformReader(
    { actor: 'system:badge-batches', reason: 'find unfinished badge batches' },
    (tx) =>
      tx.execute<{ org_id: string; id: string }>(
        sql`select org_id, id from badges.batches where status in ('queued', 'running')${
          orgs
            ? sql` and org_id in (${sql.join(
                orgs.map((o) => sql`${o}::uuid`),
                sql`, `,
              )})`
            : sql``
        } order by created_at limit ${limit}`,
      ),
  );
  return rows.map((r) => ({ orgId: r.org_id, batchId: r.id }));
}

/**
 * Queue a job for each unfinished batch (leader, every few seconds). The `exclusive` queue drops
 * a send while that batch's job is still queued or active.
 */
export async function enqueueDueBadgeBatches(
  boss: Pick<PgBoss, 'send'>,
  /** Tests: only these orgs (other test files' batches are left alone). */
  onlyOrgs?: ReadonlySet<string>,
): Promise<number> {
  const due = await dueBadgeBatches(50, onlyOrgs);
  let queued = 0;
  for (const d of due) if (await boss.send(BADGE_BATCH_JOB, d, { singletonKey: d.batchId })) queued += 1;
  return queued;
}
