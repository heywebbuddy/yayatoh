import { recordTimelineTx } from '@yayatoh/crm';
import { createCtx } from '@yayatoh/kernel';
import { defineSubscriber, type Subscriber } from '@yayatoh/platform';
import { and, eq } from 'drizzle-orm';
import { campaignRecipients, campaigns } from './schema.ts';

/**
 * The person timeline's campaign sends (M6.1a): when a send is final, every recipient it released
 * gets "campaign sent" with the campaign's name. Opens and clicks are not tracked per person
 * (M3.8a keeps clicks anonymous), so they have no timeline rows yet.
 */
export function campaignsTimeline(): Subscriber {
  return defineSubscriber({
    name: 'campaigns.timeline',
    events: ['campaigns.send_completed@1'],
    handle: async (tx, event) => {
      const [c] = await tx
        .select({ id: campaigns.id, name: campaigns.name })
        .from(campaigns)
        .where(eq(campaigns.id, event.aggregateId));
      if (!c) return;
      const rows = await tx
        .select({
          id: campaignRecipients.id,
          contactId: campaignRecipients.contactId,
          releasedAt: campaignRecipients.releasedAt,
        })
        .from(campaignRecipients)
        .where(and(eq(campaignRecipients.campaignId, c.id), eq(campaignRecipients.status, 'queued')));
      const ctx = createCtx({ orgId: event.orgId, actor: { type: 'system', name: 'campaigns.timeline' } });
      await recordTimelineTx(
        tx,
        ctx,
        rows.map((r) => ({
          contactId: r.contactId,
          kind: 'campaign_sent' as const,
          occurredAt: r.releasedAt ?? new Date(event.occurredAt ?? Date.now()),
          sourceRef: r.id,
          subject: { table: 'campaigns.campaign_recipients', id: r.id },
          label: c.name,
        })),
      );
    },
  });
}
