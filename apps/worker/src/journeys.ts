import { runDueActions } from '@yayatoh/automations';
import { billingEntitlements } from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import { createNotifier } from '@yayatoh/notifications';
import { createCommandPorts } from '@yayatoh/platform';
import { orgAuthorizer, orgStatusGate } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { defineJob } from './jobs.ts';

// The org gate (M1.3f) lets system actors through; wired for parity with the apps.
const ports = createCommandPorts({
  entitlements: billingEntitlements,
  authorizer: orgAuthorizer,
  orgGate: orgStatusGate,
});

export const JOURNEY_JOB = 'automations.run-due';

/**
 * Journeys (M3.7a): one org's due journey steps, run by `runDueActions` (each step in its own
 * transaction, claimed with SKIP LOCKED). The queue is `exclusive` per org (singleton key = org
 * id): one job at a time works an org, and the leader's tick queues it again while work is due.
 * Messages are only queued here; the notifications dispatcher sends them.
 */
export function journeyJob() {
  const notifier = createNotifier();
  return defineJob({
    name: JOURNEY_JOB,
    scope: 'tenant',
    policy: 'exclusive',
    retryLimit: 3,
    payload: z.object({ orgId: z.uuid() }),
    handler: async ({ orgId }) => {
      // M4.1f: RSVP reminders carry the party's link (the app's origin).
      const appOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN;
      const r = await runDueActions(orgId, { notifier, ...(appOrigin ? { appOrigin } : {}) }, ports, {
        limit: 500,
      });
      if (r.done || r.failed || r.enrolled) console.info(JSON.stringify({ job: JOURNEY_JOB, orgId, ...r }));
    },
  });
}

/** Orgs with journey steps due now or `event_time` journeys on (platform_reader, audited). */
export async function orgsWithJourneyWork(limit = 100): Promise<string[]> {
  const rows = await withPlatformReader(
    { actor: 'system:journeys', reason: 'find orgs with due journey steps' },
    (tx) =>
      tx.execute<{ org_id: string }>(sql`select org_id from automations.orgs_with_journey_work(${limit})`),
  );
  return rows.map((r) => r.org_id);
}

/** Queue one job per org with journey work (leader, every few seconds). */
export async function enqueueJourneyWork(
  boss: Pick<PgBoss, 'send'>,
  /** Tests: only these orgs. */
  onlyOrgs?: ReadonlySet<string>,
): Promise<number> {
  let queued = 0;
  for (const orgId of await orgsWithJourneyWork())
    if (!onlyOrgs || onlyOrgs.has(orgId))
      if (await boss.send(JOURNEY_JOB, { orgId }, { singletonKey: orgId })) queued += 1;
  return queued;
}
