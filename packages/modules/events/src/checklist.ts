import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { events } from './schema.ts';
import { eventChecklistItems } from './schema-checklist.ts';

/** U6: an event holds at most this many checklist items of its own (a template too). */
export const MAX_CHECKLIST_ITEMS = 50;
export const ChecklistTitle = z.string().trim().min(1).max(200);

export const EventChecklistItemDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  title: z.string(),
  position: z.int(),
  done: z.boolean(),
  doneAt: z.date().nullable(),
});
export type EventChecklistItemDto = z.infer<typeof EventChecklistItemDto>;

type Row = typeof eventChecklistItems.$inferSelect;
const toDto = (r: Row): EventChecklistItemDto => ({
  id: r.id,
  eventId: r.eventId,
  title: r.title,
  position: r.position,
  done: r.doneAt !== null,
  doneAt: r.doneAt,
});

async function assertEvent(tx: TenantTx, eventId: string) {
  const [e] = await tx.select({ id: events.id }).from(events).where(eq(events.id, eventId));
  if (!e) throw new DomainError('not_found');
}

const itemsOf = (tx: TenantTx, eventId: string) =>
  tx
    .select()
    .from(eventChecklistItems)
    .where(eq(eventChecklistItems.eventId, eventId))
    .orderBy(asc(eventChecklistItems.position), asc(eventChecklistItems.createdAt));

/** The titles of an event's checklist, in order (what a copy or a template takes). */
export async function checklistTitlesTx(tx: TenantTx, eventId: string): Promise<string[]> {
  return (await itemsOf(tx, eventId)).map((r) => r.title);
}

/** Append open checklist items to an event (a copy, or an event made from a template). */
export async function insertChecklistItemsTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  titles: readonly string[],
): Promise<void> {
  if (titles.length === 0) return;
  if (titles.length > MAX_CHECKLIST_ITEMS)
    throw new DomainError('invalid_state', 'Too many checklist items', { reason: 'too_many_items' });
  const orgId = requireOrg(ctx);
  await tx
    .insert(eventChecklistItems)
    .values(
      titles.map((title, position) => ({ orgId, eventId, title: ChecklistTitle.parse(title), position })),
    );
}

export const eventChecklistQuery = tenantQuery({
  name: 'events.checklist',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(EventChecklistItemDto),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, tx }) => (await itemsOf(tx, input.eventId)).map(toDto),
});

export const addChecklistItemCommand = tenantCommand({
  name: 'events.addChecklistItem',
  input: z.object({ eventId: z.uuid(), title: ChecklistTitle }),
  output: EventChecklistItemDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await assertEvent(tx, input.eventId);
    const [agg] = await tx
      .select({
        n: sql<number>`count(*)::int`,
        max: sql<number>`coalesce(max(${eventChecklistItems.position}), -1)::int`,
      })
      .from(eventChecklistItems)
      .where(eq(eventChecklistItems.eventId, input.eventId));
    if ((agg?.n ?? 0) >= MAX_CHECKLIST_ITEMS)
      throw new DomainError('invalid_state', 'Too many checklist items', { reason: 'too_many_items' });
    const [row] = await tx
      .insert(eventChecklistItems)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        title: input.title,
        position: (agg?.max ?? -1) + 1,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return toDto(row);
  },
  audit: (input, row) => ({
    action: 'event.checklist.add',
    targetType: 'event',
    targetId: input.eventId,
    data: { itemId: row.id },
  }),
});

export const setChecklistItemDoneCommand = tenantCommand({
  name: 'events.setChecklistItemDone',
  input: z.object({ eventId: z.uuid(), itemId: z.uuid(), done: z.boolean() }),
  output: EventChecklistItemDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(eventChecklistItems)
      .set({
        doneAt: input.done ? ctx.now : null,
        doneBy: input.done && ctx.actor.type === 'user' ? ctx.actor.userId : null,
        updatedAt: ctx.now,
      })
      .where(and(eq(eventChecklistItems.id, input.itemId), eq(eventChecklistItems.eventId, input.eventId)))
      .returning();
    if (!row) throw new DomainError('not_found');
    return toDto(row);
  },
  audit: (input) => ({
    action: 'event.checklist.set_done',
    targetType: 'event',
    targetId: input.eventId,
    data: { itemId: input.itemId, done: input.done },
  }),
});

export const deleteChecklistItemCommand = tenantCommand({
  name: 'events.deleteChecklistItem',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), itemId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .delete(eventChecklistItems)
      .where(and(eq(eventChecklistItems.id, input.itemId), eq(eventChecklistItems.eventId, input.eventId)))
      .returning({ id: eventChecklistItems.id });
    if (rows.length === 0) throw new DomainError('not_found');
    return { deleted: true };
  },
  audit: (input) => ({
    action: 'event.checklist.delete',
    targetType: 'event',
    targetId: input.eventId,
    data: { itemId: input.itemId },
  }),
});
