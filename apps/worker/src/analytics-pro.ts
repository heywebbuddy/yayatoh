import { analyticsOrgTick, type ReportDeps } from '@yayatoh/analytics';
import { withPlatformReader } from '@yayatoh/db/platform';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { defineJob } from './jobs.ts';

export const ANALYTICS_TICK_JOB = 'analytics.tick';

/**
 * M6.2b: one org's analytics tick — its organizer alert rules evaluated (changes go to the alerts
 * engine through the outbox) and its due scheduled reports sent. The queue is `exclusive` per org;
 * each report period is sent once whatever runs it (the run table and the notification keys).
 */
export function analyticsTickJob(deps: ReportDeps) {
  return defineJob({
    name: ANALYTICS_TICK_JOB,
    scope: 'tenant',
    policy: 'exclusive',
    retryLimit: 2,
    payload: z.object({ orgId: z.uuid() }),
    handler: async ({ orgId }) => {
      const r = await analyticsOrgTick(orgId, deps);
      if (r.rules.emitted || r.reports.sent || r.reports.failed)
        console.info(JSON.stringify({ job: ANALYTICS_TICK_JOB, orgId, ...r }));
    },
  });
}

/**
 * Orgs with switched-on alert rules (or a firing one to resolve) or report schedules (platform_reader,
 * audited). Read in pages of `pageSize` by org id, so every org is found however many have work.
 */
export async function orgsWithAnalyticsWork(pageSize = 500): Promise<string[]> {
  const orgs: string[] = [];
  let after: string | null = null;
  for (;;) {
    const from = after;
    const rows = await withPlatformReader(
      { actor: 'system:analytics', reason: 'find orgs with alert rules or report schedules' },
      (tx) =>
        tx.execute<{ org_id: string }>(sql`
          select org_id from (
            select org_id from analytics.alert_rules where enabled or last_state = 'firing'
            union
            select org_id from analytics.report_schedules where enabled
          ) work
          ${from ? sql`where org_id > ${from}` : sql``}
          order by org_id
          limit ${pageSize}`),
    );
    for (const r of rows) orgs.push(r.org_id);
    const last = rows.at(-1);
    if (rows.length < pageSize || !last) return orgs;
    after = last.org_id;
  }
}

/** Queue one tick per org with work (leader, every minute). */
export async function enqueueAnalyticsTicks(
  boss: Pick<PgBoss, 'send'>,
  /** Tests: only these orgs. */
  onlyOrgs?: ReadonlySet<string>,
): Promise<number> {
  let queued = 0;
  for (const orgId of await orgsWithAnalyticsWork())
    if (!onlyOrgs || onlyOrgs.has(orgId))
      if (await boss.send(ANALYTICS_TICK_JOB, { orgId }, { singletonKey: orgId })) queued += 1;
  return queued;
}
