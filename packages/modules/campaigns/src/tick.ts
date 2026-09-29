import { type TenantTx, withTenant } from '@yayatoh/db';
import { type CommandPorts, createCtx, executeCommand } from '@yayatoh/kernel';
import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import type { OrgLane } from './domain/scheduler.ts';
import { campaigns } from './schema.ts';
import { finalizeCampaignCommand, releaseChunkCommand, startScheduledCommand } from './send.ts';

/** Versioned outbox events this module emits (consumers: M3.2b alerts, M3.8b analytics). */
export const CAMPAIGN_EVENTS = [
  'campaigns.send_started@1',
  'campaigns.send_completed@1',
  'campaigns.send_failed@1',
] as const;

/*
 * Cross-org reads for the leader's tick. They run under `platform_reader` in apps/worker only
 * (audited there) and return ids and counts, never content.
 */

/** Scheduled campaigns whose time came, oldest first. */
export async function dueScheduledCampaignsTx(
  tx: TenantTx,
  now: Date,
  limit = 50,
): Promise<{ orgId: string; campaignId: string }[]> {
  const rows = await tx.execute<{ org_id: string; id: string }>(sql`
    select org_id, id from campaigns.campaigns
    where status = 'scheduled' and scheduled_at <= ${now.toISOString()}::timestamptz
    order by scheduled_at, id limit ${limit}`);
  return rows.map((r) => ({ orgId: r.org_id, campaignId: r.id }));
}

/**
 * The fair scheduler's input: every org with a sending campaign, its remaining budget this
 * minute (its rate minus what it released in the last 60 s) and its campaigns' pending counts.
 */
export async function campaignLanesTx(tx: TenantTx, now: Date): Promise<OrgLane[]> {
  const rows = await tx.execute<{ org_id: string; id: string; rate: number | null; pending: number }>(sql`
    select c.org_id, c.id, c.rate_per_minute as rate,
      (select count(*)::int from campaigns.campaign_recipients r
        where r.org_id = c.org_id and r.campaign_id = c.id and r.status = 'pending') as pending
    from campaigns.campaigns c
    where c.status = 'sending'
    order by c.started_at, c.id`);
  if (rows.length === 0) return [];
  const recent = await tx.execute<{ org_id: string; n: number }>(sql`
    select org_id, count(*)::int as n from campaigns.campaign_recipients
    where released_at > ${new Date(now.getTime() - 60_000).toISOString()}::timestamptz
      and org_id = any(ARRAY[${sql.join(
        [...new Set(rows.map((r) => r.org_id))].map((id) => sql`${id}`),
        sql`, `,
      )}]::uuid[])
    group by org_id`);
  const released = new Map(recent.map((r) => [r.org_id, Number(r.n)]));
  const lanes = new Map<string, { rate: number; campaigns: { campaignId: string; pending: number }[] }>();
  for (const r of rows) {
    const lane = lanes.get(r.org_id) ?? { rate: 0, campaigns: [] };
    lane.rate = Math.max(lane.rate, Number(r.rate ?? 30));
    lane.campaigns.push({ campaignId: r.id, pending: Number(r.pending) });
    lanes.set(r.org_id, lane);
  }
  return [...lanes].map(([orgId, l]) => ({
    orgId,
    budget: Math.max(0, l.rate - (released.get(orgId) ?? 0)),
    campaigns: l.campaigns,
  }));
}

/** Sent campaigns whose results are not final yet (the tick finalizes them when the queue empties). */
export async function finalizableCampaignsTx(
  tx: TenantTx,
  limit = 100,
): Promise<{ orgId: string; campaignId: string }[]> {
  const rows = await tx.execute<{ org_id: string; id: string }>(sql`
    select org_id, id from campaigns.campaigns
    where status = 'sent' and finalized_at is null
    order by completed_at, id limit ${limit}`);
  return rows.map((r) => ({ orgId: r.org_id, campaignId: r.id }));
}

const systemCtx = (orgId: string, now?: Date) =>
  createCtx({ orgId, actor: { type: 'system', name: 'campaigns.scheduler' }, ...(now ? { now } : {}) });

/**
 * One org's campaigns worked in this process (dev/CI's `/api/dev/campaigns/run` and the
 * integration tests; the worker splits the same steps into the tick and pg-boss jobs): start due
 * schedules, release pending recipients within the org's rate, finalize what is done.
 */
export async function runOrgCampaigns(
  orgId: string,
  ports: CommandPorts<TenantTx>,
  opts: { now?: Date; chunk?: number; maxRounds?: number } = {},
): Promise<{ started: number; released: number; finalized: number }> {
  const ctx = systemCtx(orgId, opts.now);
  const now = ctx.now;
  const due = await withTenant(ctx, (tx) =>
    tx
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.status, 'scheduled'), lte(campaigns.scheduledAt, now))),
  );
  let started = 0;
  for (const c of due) {
    const r = await executeCommand(startScheduledCommand, { campaignId: c.id }, systemCtx(orgId, opts.now), ports);
    if (r.status === 'sending') started += 1;
  }
  let released = 0;
  const active = await withTenant(ctx, (tx) =>
    tx.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.status, 'sending')),
  );
  for (const c of active) {
    for (let round = 0; round < (opts.maxRounds ?? 20); round++) {
      const r = await executeCommand(
        releaseChunkCommand,
        { campaignId: c.id, max: opts.chunk ?? 500 },
        systemCtx(orgId, opts.now),
        ports,
      );
      released += r.released;
      if (r.released === 0 || r.status !== 'sending') break;
    }
  }
  let finalized = 0;
  const done = await withTenant(ctx, (tx) =>
    tx
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.status, 'sent'), isNull(campaigns.finalizedAt))),
  );
  for (const c of done) {
    const r = await executeCommand(finalizeCampaignCommand, { campaignId: c.id }, systemCtx(orgId, opts.now), ports);
    if (r.finalized) finalized += 1;
  }
  return { started, released, finalized };
}
