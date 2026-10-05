import { rescoreOrgContacts } from '@yayatoh/audiences';
import { withPlatformReader } from '@yayatoh/db/platform';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { defineJob } from './jobs.ts';

export const CONTACT_STATS_JOB = 'audiences.contact-stats';

/**
 * Contact stats (M6.1b): recompute one org's contact stats from the sources, a page per
 * transaction. It is the backfill (after the migration that adds them) and the daily rescore
 * (registrations whose events ended since become attended or no-shows). Idempotent; the queue
 * is `exclusive` per org, so one job at a time works an org.
 */
export function contactStatsJob() {
  return defineJob({
    name: CONTACT_STATS_JOB,
    scope: 'tenant',
    policy: 'exclusive',
    retryLimit: 3,
    payload: z.object({ orgId: z.uuid() }),
    handler: async ({ orgId }) => {
      const contacts = await rescoreOrgContacts(orgId);
      if (contacts) console.info(JSON.stringify({ job: CONTACT_STATS_JOB, orgId, contacts }));
    },
  });
}

/** Orgs with contacts (platform_reader, audited): the ones the rescore visits. */
export async function orgsWithContacts(): Promise<string[]> {
  const rows = await withPlatformReader(
    { actor: 'system:contact-stats', reason: 'list organizations to recompute contact stats' },
    (tx) =>
      tx.execute<{ org_id: string }>(
        sql`select o.id as org_id from tenancy.organizations o
            where o.status <> 'terminated' and exists (select 1 from crm.contacts c where c.org_id = o.id)
            order by o.id`,
      ),
  );
  return rows.map((r) => r.org_id);
}

/** Queue one rescore per org (leader: once after start, then daily). */
export async function enqueueContactStats(boss: Pick<PgBoss, 'send'>): Promise<number> {
  let queued = 0;
  for (const orgId of await orgsWithContacts())
    if (await boss.send(CONTACT_STATS_JOB, { orgId }, { singletonKey: orgId })) queued += 1;
  return queued;
}

/** The backfill run inline (`pnpm --filter @yayatoh/worker contact-stats [-- --org <id>]`). */
export async function runContactStatsBackfill(opts: { onlyOrgs?: readonly string[] } = {}) {
  const orgs = opts.onlyOrgs ?? (await orgsWithContacts());
  let contacts = 0;
  let failed = 0;
  for (const orgId of orgs) {
    try {
      contacts += await rescoreOrgContacts(orgId);
    } catch (err) {
      failed++;
      console.error(JSON.stringify({ job: CONTACT_STATS_JOB, org: orgId, error: String(err) }));
    }
  }
  return { orgs: orgs.length, contacts, failed };
}
