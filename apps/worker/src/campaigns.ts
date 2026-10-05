import { billingEntitlements } from '@yayatoh/billing';
import {
  type Allocation,
  allocate,
  campaignLanesTx,
  DEFAULT_SCHEDULER,
  dueScheduledCampaignsTx,
  finalizableCampaignsTx,
  finalizeCampaignCommand,
  releaseChunkCommand,
  startScheduledCommand,
} from '@yayatoh/campaigns';
import { withPlatformReader } from '@yayatoh/db/platform';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { createCommandPorts } from '@yayatoh/platform';
import { orgAuthorizer, orgStatusGate } from '@yayatoh/tenancy';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { defineJob } from './jobs.ts';

const ports = createCommandPorts({
  entitlements: billingEntitlements,
  authorizer: orgAuthorizer,
  orgGate: orgStatusGate,
});

export const CAMPAIGN_RELEASE_JOB = 'campaigns.release';

const systemCtx = (orgId: string, now?: Date) =>
  createCtx({ orgId, actor: { type: 'system', name: 'campaigns.scheduler' }, ...(now ? { now } : {}) });

/** Release one allocation of a campaign's recipients to the dispatcher (a system actor). */
export async function releaseAllocation(a: Allocation, now?: Date): Promise<number> {
  const r = await executeCommand(
    releaseChunkCommand,
    { campaignId: a.campaignId, max: a.size },
    systemCtx(a.orgId, now),
    ports,
  );
  return r.released;
}

/**
 * The `campaigns.release` job (M3.6b): one allocation from the fair scheduler. The queue is
 * `exclusive` per campaign, so one release per campaign runs at a time; the command claims rows
 * with SKIP LOCKED and dedupes messages per campaign + contact, so a retry never sends twice.
 */
export const campaignReleaseJob = defineJob({
  name: CAMPAIGN_RELEASE_JOB,
  scope: 'tenant',
  policy: 'exclusive',
  retryLimit: 3,
  payload: z.object({ orgId: z.uuid(), campaignId: z.uuid(), size: z.int().min(1).max(5_000) }),
  handler: async (p) => {
    await releaseAllocation(p);
  },
});

export interface CampaignTickOptions {
  readonly now?: Date;
  /** Rotates which org goes first. */
  readonly tick?: number;
  readonly capacity?: number;
  readonly chunk?: number;
  /** Tests: only these orgs (other test files' campaigns are left alone). */
  readonly onlyOrgs?: ReadonlySet<string>;
  /** Hand an allocation to a worker (pg-boss in production; tests release in-process). */
  readonly release: (a: Allocation) => Promise<unknown>;
}

/**
 * The leader's campaign tick: start schedules that came due, hand out this tick's capacity to the
 * sending campaigns with the fair scheduler (round-robin across orgs, each within its per-minute
 * rate), and finalize campaigns whose last message left the queue. Cross-org reads go through
 * `platform_reader` (audited) and return ids and counts only.
 */
export async function campaignTick(opts: CampaignTickOptions) {
  const now = opts.now ?? new Date();
  const keep = (orgId: string) => !opts.onlyOrgs || opts.onlyOrgs.has(orgId);
  const due = (
    await withPlatformReader({ actor: 'system:campaigns', reason: 'find due scheduled campaigns' }, (tx) =>
      dueScheduledCampaignsTx(tx, now),
    )
  ).filter((d) => keep(d.orgId));
  let started = 0;
  for (const d of due) {
    try {
      const r = await executeCommand(
        startScheduledCommand,
        { campaignId: d.campaignId },
        systemCtx(d.orgId, opts.now),
        ports,
      );
      if (r.status === 'sending') started += 1;
    } catch (err) {
      console.error('campaigns.start', d.campaignId, err);
    }
  }
  const lanes = (
    await withPlatformReader({ actor: 'system:campaigns', reason: 'fair scheduler lanes' }, (tx) =>
      campaignLanesTx(tx, now),
    )
  ).filter((l) => keep(l.orgId));
  const allocations = allocate(lanes, {
    capacity: opts.capacity ?? DEFAULT_SCHEDULER.capacity,
    chunk: opts.chunk ?? DEFAULT_SCHEDULER.chunk,
    tick: opts.tick ?? Math.floor(now.getTime() / 2_000),
  });
  for (const a of allocations) await opts.release(a);
  const done = (
    await withPlatformReader({ actor: 'system:campaigns', reason: 'find campaigns to finalize' }, (tx) =>
      finalizableCampaignsTx(tx),
    )
  ).filter((d) => keep(d.orgId));
  let finalized = 0;
  for (const d of done) {
    const r = await executeCommand(
      finalizeCampaignCommand,
      { campaignId: d.campaignId },
      systemCtx(d.orgId, opts.now),
      ports,
    );
    if (r.finalized) finalized += 1;
  }
  return { started, allocations, finalized };
}

/** Production wiring: allocations become exclusive pg-boss jobs keyed by campaign. */
export function bossRelease(boss: Pick<PgBoss, 'send'>) {
  return (a: Allocation) => boss.send(CAMPAIGN_RELEASE_JOB, a, { singletonKey: a.campaignId });
}
