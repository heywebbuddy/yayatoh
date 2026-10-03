import { billingEntitlements } from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import { type IntegrationAuth, integrationAuthFromEnv, runSync } from '@yayatoh/integrations';
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

export const SYNC_JOB = 'integrations.sync';

/**
 * Integration syncs (M6.4a): one connection's run by `runSync` (claim, auth check through the
 * port, pull and push page by page, finish). The queue is `exclusive` per connection (singleton
 * key = connection id), on top of the run's own claim, so a connection is worked by one job at a
 * time. The engine records provider failures on the run and backs the schedule off itself, so the
 * job is retried only when the engine could not run at all. Logs carry ids, codes and counts only.
 */
export function syncJob(auth: IntegrationAuth | null = integrationAuthFromEnv(process.env)) {
  return defineJob({
    name: SYNC_JOB,
    scope: 'tenant',
    policy: 'exclusive',
    retryLimit: 2,
    payload: z.object({ orgId: z.uuid(), connectionId: z.uuid() }),
    handler: async ({ orgId, connectionId }) => {
      if (!auth) return;
      const r = await runSync(orgId, connectionId, { auth }, ports);
      if (r.status === 'claimed')
        console.info(
          JSON.stringify({ job: SYNC_JOB, orgId, connectionId, runId: r.runId, status: r.runStatus }),
        );
    },
  });
}

/** Connections with sync work now (platform_reader, audited). */
export async function connectionsWithSyncWork(
  limit = 200,
): Promise<{ orgId: string; connectionId: string }[]> {
  const rows = await withPlatformReader(
    { actor: 'system:integrations', reason: 'find connections with due syncs' },
    (tx) =>
      tx.execute<{ org_id: string; connection_id: string }>(
        sql`select org_id, connection_id from integrations.connections_with_sync_work(${limit})`,
      ),
  );
  return rows.map((r) => ({ orgId: r.org_id, connectionId: r.connection_id }));
}

/** Queue one job per connection with work (leader, every few seconds). */
export async function enqueueSyncWork(
  boss: Pick<PgBoss, 'send'>,
  /** Tests: only these orgs. */
  onlyOrgs?: ReadonlySet<string>,
): Promise<number> {
  let queued = 0;
  for (const w of await connectionsWithSyncWork())
    if (!onlyOrgs || onlyOrgs.has(w.orgId))
      if (await boss.send(SYNC_JOB, w, { singletonKey: w.connectionId })) queued += 1;
  return queued;
}
