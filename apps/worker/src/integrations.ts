import { billingEntitlements } from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import {
  type IntegrationAuth,
  integrationAuthFromEnv,
  runSlackDispatch,
  runSync,
} from '@yayatoh/integrations';
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

export const SLACK_JOB = 'integrations.slack';

/**
 * Slack messages (M6.4c): one org's pass of `runSlackDispatch` (queue due digests, claim due
 * messages with a lease, check each connection through the port, post, record). Exclusive per
 * org, on top of the messages' own claim, so two passes never post the same message. Logs carry
 * ids and counts only.
 */
export function slackJob(
  auth: IntegrationAuth | null = integrationAuthFromEnv(process.env),
  appOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'http://localhost:3000',
) {
  return defineJob({
    name: SLACK_JOB,
    scope: 'tenant',
    policy: 'exclusive',
    retryLimit: 2,
    payload: z.object({ orgId: z.uuid() }),
    handler: async ({ orgId }) => {
      if (!auth) return;
      const r = await runSlackDispatch(orgId, { auth, appOrigin }, ports);
      if (r.sent || r.failed || r.cancelled || r.revoked.length)
        console.info(
          JSON.stringify({
            job: SLACK_JOB,
            orgId,
            queued: r.queued,
            sent: r.sent,
            failed: r.failed,
            cancelled: r.cancelled,
            revoked: r.revoked,
          }),
        );
    },
  });
}

/** Orgs with Slack work now: due messages or digests (platform_reader, audited). */
export async function orgsWithSlackWork(limit = 200): Promise<string[]> {
  const rows = await withPlatformReader(
    { actor: 'system:integrations', reason: 'find orgs with due Slack messages' },
    (tx) =>
      tx.execute<{ org_id: string }>(sql`select org_id from integrations.orgs_with_slack_work(${limit})`),
  );
  return rows.map((r) => r.org_id);
}

/** Queue one Slack job per org with work (leader, every few seconds). */
export async function enqueueSlackWork(
  boss: Pick<PgBoss, 'send'>,
  /** Tests: only these orgs. */
  onlyOrgs?: ReadonlySet<string>,
): Promise<number> {
  let queued = 0;
  for (const orgId of await orgsWithSlackWork())
    if (!onlyOrgs || onlyOrgs.has(orgId))
      if (await boss.send(SLACK_JOB, { orgId }, { singletonKey: orgId })) queued += 1;
  return queued;
}
