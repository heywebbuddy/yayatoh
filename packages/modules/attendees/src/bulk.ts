import type { TenantTx } from '@yayatoh/db';
import { DomainError } from '@yayatoh/kernel';
import { bulkCommands, defineBulkAction, MAX_BULK_ITEMS } from '@yayatoh/platform';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  AttendeeFilter,
  filterWhere,
  Label,
  MAX_LABELS,
  nextLabels,
  type TicketFilterExtension,
} from './attendees.ts';
import { attendees } from './schema.ts';

/**
 * The attendees an operation selects: explicit ids (checked against the event) or everything
 * matching a list filter. Returns at most MAX_BULK_ITEMS + 1, so the caller can refuse more.
 */
export async function resolveAttendeeIdsTx(
  tx: TenantTx,
  sel: { eventId: string | null; ids?: readonly string[]; filter?: z.output<typeof AttendeeFilter> },
  ext: TicketFilterExtension = {},
): Promise<string[]> {
  if (!sel.eventId) throw new DomainError('validation_failed', 'An event is required');
  const rows = await tx
    .select({ id: attendees.id })
    .from(attendees)
    .where(
      sel.ids
        ? and(eq(attendees.eventId, sel.eventId), inArray(attendees.id, [...sel.ids]))
        : filterWhere(sel.eventId, sel.filter ?? AttendeeFilter.parse({}), ext),
    )
    .orderBy(attendees.createdAt, attendees.id)
    .limit(MAX_BULK_ITEMS + 1);
  return rows.map((r) => r.id);
}

/** The attendee fields exports may carry (an allowlist; the contact id stays inside). */
export async function attendeesForExportTx(tx: TenantTx, ids: readonly string[]) {
  if (ids.length === 0) return [];
  return tx
    .select({
      id: attendees.id,
      name: attendees.name,
      email: attendees.email,
      source: attendees.source,
      status: attendees.status,
      labels: attendees.labels,
      ticketId: attendees.ticketId,
      createdAt: attendees.createdAt,
    })
    .from(attendees)
    .where(inArray(attendees.id, [...ids]));
}

const LabelParams = z
  .object({
    add: z.array(Label).max(MAX_LABELS).default([]),
    remove: z.array(Label).max(MAX_LABELS).default([]),
  })
  .refine((v) => v.add.length + v.remove.length > 0, { message: 'Nothing to change' });

/** Add/remove labels on many attendees; undo restores each attendee's previous labels. */
export const attendeeLabelAction = defineBulkAction({
  key: 'attendees.label',
  entitlement: 'attendees',
  permission: 'attendees:write',
  params: LabelParams,
  filter: AttendeeFilter,
  chunkSize: 500,
  undoWindowMs: 10 * 60_000,
  resolve: resolveAttendeeIdsTx,
  run: async (tx, ctx, ids, params) => {
    if (ids.length === 0) return { results: [] };
    const next = nextLabels(params.add, params.remove);
    const before = await tx
      .select({
        id: attendees.id,
        labels: attendees.labels,
        over: sql<boolean>`cardinality(${next}) > ${MAX_LABELS}`,
      })
      .from(attendees)
      .where(inArray(attendees.id, [...ids]));
    const found = new Map(before.map((b) => [b.id, b]));
    const allowed = before.filter((b) => !b.over).map((b) => b.id);
    if (allowed.length)
      await tx
        .update(attendees)
        .set({ labels: next, updatedAt: ctx.now })
        .where(inArray(attendees.id, allowed));
    return {
      results: ids.map((id) => {
        const b = found.get(id);
        if (!b) return { id, ok: false, code: 'not_found' };
        if (b.over) return { id, ok: false, code: 'too_many_labels' };
        return { id, ok: true, undo: { labels: b.labels } };
      }),
    };
  },
  undo: async (tx, ctx, items) => {
    for (const i of items) {
      const prev = z.object({ labels: z.array(z.string()) }).parse(i.undo);
      await tx
        .update(attendees)
        .set({ labels: prev.labels, updatedAt: ctx.now })
        .where(eq(attendees.id, i.id));
    }
  },
});

export const attendeeLabelBulk = bulkCommands(attendeeLabelAction);
