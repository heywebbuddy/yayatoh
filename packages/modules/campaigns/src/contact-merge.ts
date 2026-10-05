import type { ContactReferenceOwner } from '@yayatoh/crm';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { campaignRecipients } from './schema.ts';

const TABLE = 'campaigns.campaign_recipients';

/**
 * Contact merges (M6.1a, ADR 0023): a merged duplicate's recipient rows move to the person who
 * stays, except where the same campaign reached both (one row per campaign and person): that row
 * stays on the duplicate as history and is counted as kept. An undo moves exactly the recorded
 * rows back. Only this module writes its table.
 */
export const campaignsContactOwner: ContactReferenceOwner = {
  module: 'campaigns',
  columns: [`${TABLE}.contact_id`],
  move: async (tx, _ctx, step) => {
    const rows = await tx.execute<{ id: string }>(sql`
      update campaigns.campaign_recipients r set contact_id = ${step.toContactId}
      where r.contact_id = ${step.fromContactId}
        and not exists (
          select 1 from campaigns.campaign_recipients x
          where x.org_id = r.org_id and x.campaign_id = r.campaign_id and x.contact_id = ${step.toContactId})
      returning r.id`);
    const [left] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(campaignRecipients)
      .where(eq(campaignRecipients.contactId, step.fromContactId));
    return { moved: rows.map((r) => ({ table: TABLE, id: r.id })), kept: { [TABLE]: left?.n ?? 0 } };
  },
  restore: async (tx, _ctx, step) => {
    const ids = step.rows.filter((r) => r.table === TABLE).map((r) => r.id);
    if (ids.length === 0) return [];
    const rows = await tx
      .update(campaignRecipients)
      .set({ contactId: step.fromContactId })
      .where(and(eq(campaignRecipients.contactId, step.toContactId), inArray(campaignRecipients.id, ids)))
      .returning({ id: campaignRecipients.id });
    return rows.map((r) => ({ table: TABLE, id: r.id }));
  },
};
