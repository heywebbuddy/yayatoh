import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { campaignClicksTx } from '@yayatoh/marketing';
import { applyMerge } from '@yayatoh/notifications/merge';
import { deliveryReasonsTx, sendOutcomesTx } from '@yayatoh/notifications';
import { tenantQuery } from '@yayatoh/platform';
import { organizationBrandTx } from '@yayatoh/tenancy';
import { count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { loadCampaignTx } from './campaigns.ts';
import { CampaignContent, linkBlocks } from './domain/blocks.ts';
import { EXCLUSION_REASONS, type ExclusionReason } from './domain/lifecycle.ts';
import { renderCampaign } from './domain/render.ts';
import { type CampaignResultsDto, CampaignResultsDto as ResultsSchema, campaignResultsSerializer, PreviewDto } from './dto.ts';
import { campaignLinks, campaignRecipients } from './schema.ts';
import { sendPrefix } from './send.ts';

/**
 * A campaign's results (M3.6b; M3.8b's marketing analytics read the same): the snapshot (who got
 * it and why not), the scheduler's progress, and what the dispatcher and the provider reported,
 * plus clicks on its tracked links. Test sends are never counted (their own dedupe prefix).
 */
export async function campaignResults(tx: TenantTx, campaignId: string): Promise<CampaignResultsDto> {
  const rows = await tx
    .select({ status: campaignRecipients.status, reason: campaignRecipients.reason, n: count() })
    .from(campaignRecipients)
    .where(eq(campaignRecipients.campaignId, campaignId))
    .groupBy(campaignRecipients.status, campaignRecipients.reason);
  let total = 0;
  let pending = 0;
  let released = 0;
  const excluded = new Map<ExclusionReason, number>();
  for (const r of rows) {
    total += r.n;
    if (r.status === 'pending') pending += r.n;
    if (r.status === 'queued') released += r.n;
    if (r.status === 'excluded' && r.reason)
      excluded.set(r.reason as ExclusionReason, (excluded.get(r.reason as ExclusionReason) ?? 0) + r.n);
  }
  const excludedTotal = [...excluded.values()].reduce((a, b) => a + b, 0);
  const prefix = sendPrefix(campaignId);
  const [o, reasons, clicks] = await Promise.all([
    sendOutcomesTx(tx, prefix),
    deliveryReasonsTx(tx, prefix),
    campaignClicksTx(tx, campaignId),
  ]);
  return campaignResultsSerializer.serialize({
    reach: {
      total,
      eligible: total - excludedTotal,
      excluded: EXCLUSION_REASONS.filter((k) => excluded.has(k)).map((reason) => ({
        reason,
        count: excluded.get(reason) ?? 0,
      })),
    },
    pending,
    released,
    sent: o.sent,
    waiting: o.queued,
    notSent: o.suppressed + o.canceled,
    failed: o.failed,
    delivered: o.delivered,
    bounced: o.bounced,
    complained: o.complained,
    unsubscribed: o.unsubscribed,
    opened: null,
    clicked: clicks.clicks,
    clickDevices: clicks.devices,
    reasons,
  });
}

export const campaignResultsQuery = tenantQuery({
  name: 'campaigns.campaignResults',
  input: z.object({ campaignId: z.uuid() }),
  output: ResultsSchema,
  entitlement: 'marketing',
  permission: 'marketing:read',
  handler: async ({ input, tx }) => {
    await loadCampaignTx(tx, input.campaignId);
    return campaignResults(tx, input.campaignId);
  },
});

/**
 * The editor's preview (desktop and mobile frames): the email as recipients will see it, merge
 * fields showing their fallbacks, links to the tracked link when it exists (else the event page).
 * `origin` is the app origin the web shows links on.
 */
export const campaignPreviewQuery = tenantQuery({
  name: 'campaigns.campaignPreview',
  input: z.object({
    campaignId: z.uuid(),
    origin: z.url().max(200),
    /** Preview unsaved editor content (validated like a save). */
    content: CampaignContent.optional(),
  }),
  output: PreviewDto,
  entitlement: 'marketing',
  permission: 'marketing:read',
  handler: async ({ input, ctx, tx }) => {
    const row = await loadCampaignTx(tx, input.campaignId);
    const parsed = input.content ? { success: true as const, data: input.content } : CampaignContent.safeParse(row.content);
    if (!parsed.success)
      throw new DomainError('invalid_state', 'The campaign needs fixing', { reason: 'content_invalid' });
    const content = parsed.data;
    const org = await organizationBrandTx(tx, requireOrg(ctx));
    if (!org) throw new DomainError('not_found');
    const origin = input.origin.replace(/\/$/, '');
    const stored = await tx.select().from(campaignLinks).where(eq(campaignLinks.campaignId, row.id));
    const codes = new Map(stored.map((l) => [l.blockId, l.code]));
    const links = new Map<string, string>();
    const events = new Map<string, { name: string; startsAt: Date; timezone: string; venue: string | null }>();
    for (const b of linkBlocks(content)) {
      const e = await findEventTx(tx, b.eventId);
      if (!e) continue;
      events.set(e.id, {
        name: e.name,
        startsAt: e.startsAt,
        timezone: e.timezone,
        venue: [e.venueName, e.city].filter(Boolean).join(', ') || null,
      });
      const code = codes.get(b.id);
      const path = b.type === 'button' && b.path ? b.path : `/events/${e.slug}`;
      links.set(b.id, code ? `${origin}/r/${code}` : `${origin}${path}`);
    }
    const r = renderCampaign({
      content,
      locale: row.locale,
      brand: {
        name: org.name,
        brandColor: org.brandColor,
        logoUrl: org.logoPath ? `${origin}${org.logoPath}` : null,
        logoAlt: org.logoAlt,
        poweredByVisible: org.poweredByVisible,
      },
      events,
      links,
      imageOrigin: origin,
    });
    const values = { system: { unsubscribe: `${origin}/unsubscribe/preview`, origin } };
    return {
      subject: applyMerge(r.subject, values),
      preheader: applyMerge(r.preheader, values),
      html: applyMerge(r.html, values, { html: true }),
      text: applyMerge(r.text, values),
      sms: row.channel === 'email' ? null : `${org.name}: ${applyMerge(content.smsBody, values)}`,
      dir: r.dir,
    };
  },
});
