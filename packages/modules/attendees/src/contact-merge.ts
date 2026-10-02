import type { ContactReferenceOwner } from '@yayatoh/crm';
import { and, eq, inArray } from 'drizzle-orm';
import { attendees } from './schema.ts';

const TABLE = 'attendees.attendees';

/**
 * Contact merges (M6.1a, ADR 0022): a merged duplicate's attendee records move to the person who
 * stays; an undo moves exactly the recorded ones back. Only this module writes its table.
 */
export const attendeesContactOwner: ContactReferenceOwner = {
  module: 'attendees',
  columns: [`${TABLE}.contact_id`],
  move: async (tx, _ctx, step) => {
    const rows = await tx
      .update(attendees)
      .set({ contactId: step.toContactId })
      .where(eq(attendees.contactId, step.fromContactId))
      .returning({ id: attendees.id });
    return { moved: rows.map((r) => ({ table: TABLE, id: r.id })) };
  },
  restore: async (tx, _ctx, step) => {
    const ids = step.rows.filter((r) => r.table === TABLE).map((r) => r.id);
    if (ids.length === 0) return [];
    const rows = await tx
      .update(attendees)
      .set({ contactId: step.fromContactId })
      .where(and(eq(attendees.contactId, step.toContactId), inArray(attendees.id, ids)))
      .returning({ id: attendees.id });
    return rows.map((r) => ({ table: TABLE, id: r.id }));
  },
};
