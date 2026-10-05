import type { TenantTx } from '@yayatoh/db';
import { count, eq } from 'drizzle-orm';
import { leads } from './schema.ts';

/**
 * Leads captured per exhibitor at an event (exhibitor id → count; exhibitors without a lead are
 * missing). Counts only, never a person: the conference Command Center's exhibitor tile and the
 * `exhibitorsNoLeads` alert read it through the app's `ConferenceSources` port (batch 3k merge).
 */
export async function exhibitorLeadCountsTx(tx: TenantTx, eventId: string): Promise<Map<string, number>> {
  const rows = await tx
    .select({ exhibitorId: leads.exhibitorId, n: count() })
    .from(leads)
    .where(eq(leads.eventId, eventId))
    .groupBy(leads.exhibitorId);
  return new Map(rows.map((r) => [r.exhibitorId, r.n]));
}
