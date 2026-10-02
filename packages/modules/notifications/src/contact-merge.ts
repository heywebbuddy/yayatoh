import type { ContactReferenceOwner } from '@yayatoh/crm';
import { and, eq, inArray } from 'drizzle-orm';
import { messages } from './schema.ts';

const TABLE = 'notifications.messages';

/**
 * Contact merges (M6.1a, ADR 0022): a merged duplicate's message log rows (texts check consent by contact) move to the person who stays; an undo moves exactly
 * the recorded ones back. Only this module writes its table.
 */
export const notificationsContactOwner: ContactReferenceOwner = {
  module: 'notifications',
  columns: [`${TABLE}.contact_id`],
  move: async (tx, _ctx, step) => {
    const rows = await tx
      .update(messages)
      .set({ contactId: step.toContactId })
      .where(eq(messages.contactId, step.fromContactId))
      .returning({ id: messages.id });
    return { moved: rows.map((r) => ({ table: TABLE, id: r.id })) };
  },
  restore: async (tx, _ctx, step) => {
    const ids = step.rows.filter((r) => r.table === TABLE).map((r) => r.id);
    if (ids.length === 0) return [];
    const rows = await tx
      .update(messages)
      .set({ contactId: step.fromContactId })
      .where(and(eq(messages.contactId, step.toContactId), inArray(messages.id, ids)))
      .returning({ id: messages.id });
    return rows.map((r) => ({ table: TABLE, id: r.id }));
  },
};
