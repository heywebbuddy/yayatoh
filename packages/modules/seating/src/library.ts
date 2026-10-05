import { FloorplanDoc } from '@yayatoh/floorplan';
import { DomainError } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { asc, eq, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { eventLayouts, layouts } from './schema.ts';

/**
 * The org's venue layout library (M6.11b): the floor plans an organizer saved ("Save to the
 * library" on an event's plan), listed with what they hold and how many events started from
 * them, renamed, removed, and used to start a new event. Events keep their own copy: removing a
 * plan from the library never changes an event.
 */

export const LibraryLayoutDto = z.object({
  id: z.uuid(),
  name: z.string(),
  seatCount: z.int(),
  rows: z.int(),
  tables: z.int(),
  /** The plan carries a floor plan image. */
  image: z.boolean(),
  /** Charts of events that started from it. */
  usedBy: z.int(),
  updatedAt: z.date(),
});
export type LibraryLayoutDto = z.infer<typeof LibraryLayoutDto>;

export const layoutLibraryQuery = tenantQuery({
  name: 'seating.layoutLibrary',
  input: z.object({}),
  output: z.array(LibraryLayoutDto),
  entitlement: 'seating',
  permission: 'events:read',
  handler: async ({ tx }) => {
    const rows = await tx.select().from(layouts).orderBy(asc(layouts.name));
    const used = await tx
      .select({ id: eventLayouts.sourceLayoutId, n: sql<number>`count(*)::int` })
      .from(eventLayouts)
      .where(isNotNull(eventLayouts.sourceLayoutId))
      .groupBy(eventLayouts.sourceLayoutId);
    const usedBy = new Map(used.map((u) => [u.id, u.n]));
    return rows.map((l) => {
      const doc = FloorplanDoc.safeParse(l.doc);
      const items = doc.success ? doc.data.items : [];
      return {
        id: l.id,
        name: l.name,
        seatCount: l.seatCount,
        rows: items.filter((i) => i.kind === 'row').length,
        tables: items.filter((i) => i.kind === 'table').length,
        image: Boolean(doc.success && doc.data.underlay),
        usedBy: usedBy.get(l.id) ?? 0,
        updatedAt: l.updatedAt,
      };
    });
  },
});

export const renameLayoutCommand = tenantCommand({
  name: 'seating.renameLayout',
  input: z.object({ id: z.uuid(), name: z.string().trim().min(1).max(120) }),
  output: z.object({ id: z.uuid(), name: z.string() }),
  entitlement: 'seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(layouts)
      .set({ name: input.name, updatedAt: ctx.now })
      .where(eq(layouts.id, input.id))
      .returning({ id: layouts.id, name: layouts.name });
    if (!row) throw new DomainError('not_found', 'Floor plan not found');
    return row;
  },
  audit: (input) => ({ action: 'seating.layout_rename', targetType: 'layout', targetId: input.id }),
});

/** Remove a plan from the library (events that started from it keep their copy). */
export const deleteLayoutCommand = tenantCommand({
  name: 'seating.deleteLayout',
  category: 'delete',
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  entitlement: 'seating',
  permission: 'seating:write',
  handler: async ({ input, tx }) => {
    const [row] = await tx.delete(layouts).where(eq(layouts.id, input.id)).returning({ id: layouts.id });
    if (!row) throw new DomainError('not_found', 'Floor plan not found');
    return row;
  },
  audit: (input) => ({ action: 'seating.layout_delete', targetType: 'layout', targetId: input.id }),
});
