import type { ContactReferenceOwner } from '@yayatoh/crm';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { consentChanges } from './schema.ts';

const TABLE = 'integrations.consent_changes';

/**
 * Contact merges (M6.1a, ADR 0023): the consent changes a provider reported for a merged duplicate
 * move to the person who stays (they are history about that person); an undo moves exactly the
 * recorded rows back. Only this module writes its table.
 */
export const integrationsContactOwner: ContactReferenceOwner = {
  module: 'integrations',
  columns: [`${TABLE}.contact_id`],
  move: async (tx, _ctx, step) => {
    const rows = await tx.execute<{ id: string }>(sql`
      update integrations.consent_changes set contact_id = ${step.toContactId}
      where contact_id = ${step.fromContactId}
      returning id`);
    return { moved: rows.map((r) => ({ table: TABLE, id: r.id })), kept: { [TABLE]: 0 } };
  },
  restore: async (tx, _ctx, step) => {
    const ids = step.rows.filter((r) => r.table === TABLE).map((r) => r.id);
    if (ids.length === 0) return [];
    const rows = await tx
      .update(consentChanges)
      .set({ contactId: step.fromContactId })
      .where(and(eq(consentChanges.contactId, step.toContactId), inArray(consentChanges.id, ids)))
      .returning({ id: consentChanges.id });
    return rows.map((r) => ({ table: TABLE, id: r.id }));
  },
};
