import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  DELETE,
  defineDataSubjectContributor,
  refsOf,
  type SubjectErasure,
} from '@yayatoh/platform';
import { asc, eq, inArray } from 'drizzle-orm';
import { campaignRecipients, campaigns } from './schema.ts';

async function recipientRowsTx(tx: TenantTx, s: DataSubject) {
  const contacts = refsOf(s, 'contact');
  if (contacts.length === 0) return [];
  return tx
    .select({
      id: campaignRecipients.id,
      channel: campaigns.channel,
      status: campaignRecipients.status,
      reason: campaignRecipients.reason,
      releasedAt: campaignRecipients.releasedAt,
      createdAt: campaignRecipients.createdAt,
    })
    .from(campaignRecipients)
    .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
    .where(inArray(campaignRecipients.contactId, contacts))
    .orderBy(asc(campaignRecipients.createdAt));
}

/**
 * campaigns' part of a data-subject request (M6.1c). The person's places in campaign recipient
 * snapshots (pending, sent or excluded) are deleted, so a scheduled send never releases a message
 * to them. The messages themselves are notifications' records; campaigns are the organizer's.
 */
export const campaignsDataSubjects = defineDataSubjectContributor({
  module: 'campaigns',
  tables: {
    'campaigns.campaign_recipients': DELETE,
  },
  async export(tx, s) {
    const rows = await recipientRowsTx(tx, s);
    return {
      sections: {
        campaigns: rows.map((r) => ({
          channel: r.channel,
          status: r.status,
          excludedBecause: r.reason,
          sentAt: r.releasedAt,
          addedAt: r.createdAt,
        })),
      },
    };
  },
  async erase(tx, s): Promise<SubjectErasure> {
    const contacts = refsOf(s, 'contact');
    if (contacts.length === 0) return { erased: {} };
    const gone = await tx
      .delete(campaignRecipients)
      .where(inArray(campaignRecipients.contactId, contacts))
      .returning({ id: campaignRecipients.id });
    return { erased: { 'campaigns.campaign_recipients': gone.length } };
  },
});
