import type { ContactReferenceOwner } from '@yayatoh/crm';
import { and, eq, inArray } from 'drizzle-orm';
import { fraudSignals } from './schema.ts';

const TABLE = 'checkin.fraud_signals';

/**
 * Contact merges (M6.1a, ADR 0022): fraud signals about a merged duplicate move to the person who stays; an undo moves exactly
 * the recorded ones back. Only this module writes its table.
 */
export const checkinContactOwner: ContactReferenceOwner = {
  module: 'checkin',
  columns: [`${TABLE}.contact_id`],
  move: async (tx, _ctx, step) => {
    const rows = await tx
      .update(fraudSignals)
      .set({ contactId: step.toContactId })
      .where(eq(fraudSignals.contactId, step.fromContactId))
      .returning({ id: fraudSignals.id });
    return { moved: rows.map((r) => ({ table: TABLE, id: r.id })) };
  },
  restore: async (tx, _ctx, step) => {
    const ids = step.rows.filter((r) => r.table === TABLE).map((r) => r.id);
    if (ids.length === 0) return [];
    const rows = await tx
      .update(fraudSignals)
      .set({ contactId: step.fromContactId })
      .where(and(eq(fraudSignals.contactId, step.toContactId), inArray(fraudSignals.id, ids)))
      .returning({ id: fraudSignals.id });
    return rows.map((r) => ({ table: TABLE, id: r.id }));
  },
};
