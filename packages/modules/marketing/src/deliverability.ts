import type { TenantTx } from '@yayatoh/db';
import type { Ctx } from '@yayatoh/kernel';
import {
  DELIVERABILITY_THRESHOLDS,
  deliverabilityBreakdownTx,
  deliverabilityVerdict,
  latestAutoPauseTx,
  type SendTally,
} from '@yayatoh/notifications';
import { tenantQuery } from '@yayatoh/platform';
import { desc, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { trackingLinks } from './schema.ts';

/**
 * Email deliverability (M3.8b): bounce and complaint rates over the alert engine's window (the
 * last 7 days) for the org, each sending domain and each campaign, against the same thresholds
 * the M3.2b `deliverability` alert uses, plus the M3.5a complaint auto-pause state. Numbers and
 * domain names only; the addresses themselves stay on the suppression list.
 */

const Count = z.int().min(0);
const Rates = z.object({
  sent: Count,
  delivered: Count,
  bounced: Count,
  complained: Count,
  bounceBps: Count,
  complaintBps: Count,
  /** Enough email was sent for the rates to count (the threshold's minimum). */
  enough: z.boolean(),
  bounceOver: z.boolean(),
  complaintOver: z.boolean(),
});

export const DeliverabilityDto = z.object({
  from: z.date(),
  to: z.date(),
  thresholds: z.object({ minSent: Count, bounceBps: Count, complaintBps: Count, windowDays: Count }),
  org: Rates,
  domains: z.array(Rates.extend({ domain: z.string().nullable(), platform: z.boolean() })),
  campaigns: z.array(Rates.extend({ campaignId: z.uuid(), name: z.string().nullable() })),
  autoPause: z
    .object({ active: z.boolean(), since: z.date(), rateBps: Count, complaints: Count, sent: Count })
    .nullable(),
});
export type DeliverabilityDto = z.infer<typeof DeliverabilityDto>;

const rates = (t: SendTally) => {
  const v = deliverabilityVerdict(t);
  return {
    sent: t.sent,
    delivered: t.delivered,
    bounced: t.bounced,
    complained: t.complained,
    bounceBps: v.bounceBps,
    complaintBps: v.complaintBps,
    enough: v.enough,
    bounceOver: v.bounceOver,
    complaintOver: v.complaintOver,
  };
};

export async function deliverabilityReportTx(tx: TenantTx, ctx: Ctx): Promise<DeliverabilityDto> {
  const b = await deliverabilityBreakdownTx(tx, ctx.now, DELIVERABILITY_THRESHOLDS.windowMs);
  const ids = b.campaigns.map((c) => c.campaignId);
  // A campaign's name is its links' label (M3.6b names them after the campaign).
  const names = new Map<string, string>();
  if (ids.length)
    for (const l of await tx
      .select({
        campaignId: trackingLinks.campaignId,
        label: trackingLinks.label,
        utm: trackingLinks.utmCampaign,
      })
      .from(trackingLinks)
      .where(inArray(trackingLinks.campaignId, ids))
      .orderBy(desc(trackingLinks.createdAt)))
      if (l.campaignId && !names.has(l.campaignId)) names.set(l.campaignId, l.label ?? l.utm);
  const pause = await latestAutoPauseTx(tx);
  return DeliverabilityDto.parse({
    from: b.from,
    to: b.to,
    thresholds: {
      minSent: DELIVERABILITY_THRESHOLDS.minSent,
      bounceBps: DELIVERABILITY_THRESHOLDS.bounceBps,
      complaintBps: DELIVERABILITY_THRESHOLDS.complaintBps,
      windowDays: Math.round(DELIVERABILITY_THRESHOLDS.windowMs / 86_400_000),
    },
    org: rates(b.org),
    domains: b.domains.map((d) => ({ ...rates(d), domain: d.domain, platform: d.platform })),
    campaigns: b.campaigns.map((c) => ({
      ...rates(c),
      campaignId: c.campaignId,
      name: names.get(c.campaignId) ?? null,
    })),
    autoPause: pause
      ? {
          active: pause.active,
          since: pause.since,
          rateBps: pause.rateBps,
          complaints: pause.complaints,
          sent: pause.sent,
        }
      : null,
  });
}

export const deliverabilityReportQuery = tenantQuery({
  name: 'marketing.deliverability',
  input: z.object({}),
  output: DeliverabilityDto,
  entitlement: 'marketing',
  permission: 'messages:read',
  handler: ({ ctx, tx }) => deliverabilityReportTx(tx, ctx),
});
