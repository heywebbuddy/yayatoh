import type { ContactReferenceOwner } from '@yayatoh/crm';
import { and, eq, inArray } from 'drizzle-orm';
import { guests } from './schema.ts';

const TABLE = 'guests.guests';

/**
 * Contact merges (M6.1a, ADR 0023): a merged duplicate's guest records move to the person who stays; an undo moves exactly
 * the recorded ones back. Only this module writes its table.
 */
export const guestsContactOwner: ContactReferenceOwner = {
  module: 'guests',
  columns: [`${TABLE}.contact_id`],
  move: async (tx, _ctx, step) => {
    const rows = await tx
      .update(guests)
      .set({ contactId: step.toContactId })
      .where(eq(guests.contactId, step.fromContactId))
      .returning({ id: guests.id });
    return { moved: rows.map((r) => ({ table: TABLE, id: r.id })) };
  },
  restore: async (tx, _ctx, step) => {
    const ids = step.rows.filter((r) => r.table === TABLE).map((r) => r.id);
    if (ids.length === 0) return [];
    const rows = await tx
      .update(guests)
      .set({ contactId: step.fromContactId })
      .where(and(eq(guests.contactId, step.toContactId), inArray(guests.id, ids)))
      .returning({ id: guests.id });
    return rows.map((r) => ({ table: TABLE, id: r.id }));
  },
};
