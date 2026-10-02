import type { Planter } from '../types.ts';

/** campaigns: the person in the fixture campaign's recipient snapshot. */
export const plantCampaigns: Planter = async ({ admin, orgId, ids }) => {
  if (!ids.contactId) throw new Error('plantCampaigns: run plantCrm first');
  const [c] =
    await admin`select id from campaigns.campaigns where org_id = ${orgId} order by created_at limit 1`;
  if (!c) return [];
  await admin`
    insert into campaigns.campaign_recipients (org_id, campaign_id, contact_id, status)
    values (${orgId}, ${c.id as string}, ${ids.contactId}, 'pending')`;
  return ['campaigns.campaign_recipients'];
};
