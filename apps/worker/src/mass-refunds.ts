import { billingEntitlements } from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import { runMassRefund } from '@yayatoh/orders';
import type { PaymentProvider } from '@yayatoh/payments';
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

export const MASS_REFUND_JOB = 'orders.mass-refund';

/**
 * The mass refund batch job (M3.10b): works one run for up to `budgetMs`, order by order, then
 * ends; the leader's tick queues it again while the run is still running. The queue is
 * `exclusive` per run (singleton key = run id), so one job at a time works a run; a crash or a
 * pause leaves nothing half-done that the next job cannot resume (see `runMassRefund`).
 */
export function massRefundJob(provider: PaymentProvider, opts: { budgetMs?: number } = {}) {
  return defineJob({
    name: MASS_REFUND_JOB,
    scope: 'tenant',
    policy: 'exclusive',
    retryLimit: 3,
    payload: z.object({ orgId: z.uuid(), runId: z.uuid() }),
    handler: async ({ orgId, runId }) => {
      const r = await runMassRefund(provider, ports, orgId, runId, { budgetMs: opts.budgetMs ?? 25_000 });
      if (r.settled) console.info(JSON.stringify({ job: MASS_REFUND_JOB, orgId, runId, ...r }));
    },
  });
}

/** Running mass refunds of every org (platform_reader, audited), for the leader's tick. */
export async function dueMassRefunds(limit = 50): Promise<{ orgId: string; runId: string }[]> {
  const rows = await withPlatformReader(
    { actor: 'system:mass-refunds', reason: 'find running mass refunds' },
    (tx) =>
      tx.execute<{ org_id: string; id: string }>(
        sql`select org_id, id from orders.mass_refunds where status = 'running' order by created_at limit ${limit}`,
      ),
  );
  return rows.map((r) => ({ orgId: r.org_id, runId: r.id }));
}

/**
 * Queue a job for each running mass refund (leader, every few seconds). The `exclusive` queue
 * drops a send while that run's job is still queued or active.
 */
export async function enqueueDueMassRefunds(boss: Pick<PgBoss, 'send'>): Promise<number> {
  const due = await dueMassRefunds();
  for (const d of due) await boss.send(MASS_REFUND_JOB, d, { singletonKey: d.runId });
  return due.length;
}
