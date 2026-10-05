import type { TenantTx } from '@yayatoh/db';
import { FloorplanDoc, placedSeats } from '@yayatoh/floorplan';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, inArray, lte, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { reconcileAssignmentsTx } from './assignments.ts';
import { type ChartKey, chartKeyTx, onChart } from './chart.ts';
import {
  diffDocs,
  type InUseSeat,
  type LayoutDiff,
  planRestore,
  RESTORE_CONFLICTS,
} from './domain/revisions.ts';
import { validDoc } from './layouts.ts';
import {
  EVENT_LAYOUT_STATUSES,
  eventLayouts,
  eventSeats,
  layoutRevisions,
  REVISION_KINDS,
} from './schema.ts';

/**
 * Layout revisions (M6.11b, entitlement `advanced_seating` to read and restore).
 *
 * Every save of a chart's plan (the editor's autosave, a quick build, a saved floor plan, a
 * date's own copy) writes a numbered revision of that chart with the whole document; so does a
 * restore. The newest `KEEP_REVISIONS` per chart are kept. A revision shows what it changed
 * (seats added, removed, renumbered) and what restoring it would change now. Restoring keeps
 * every held and sold seat: the same seat with the same label, or a seat with that label
 * remapped to it; otherwise it is refused and the page says which seats stand in the way.
 */

export const KEEP_REVISIONS = 100;
/** Seats listed per change kind in a revision's detail (counts are always whole). */
export const DIFF_LIST_LIMIT = 200;

const actorUuid = (ctx: Ctx) => (ctx.actor.type === 'user' ? ctx.actor.userId : null);

/** Number the next revision of a chart and store it (unless the plan did not change). */
export async function recordRevisionTx(
  tx: TenantTx,
  ctx: Ctx,
  r: {
    eventId: string;
    key: ChartKey;
    doc: FloorplanDoc;
    checksum: string;
    seatCount: number;
    restoredFrom?: number;
  },
): Promise<number | null> {
  const [last] = await tx
    .select({ number: layoutRevisions.number, checksum: layoutRevisions.checksum })
    .from(layoutRevisions)
    .where(onChart(layoutRevisions, r.eventId, r.key))
    .orderBy(desc(layoutRevisions.number))
    .limit(1);
  if (last && last.checksum === r.checksum && r.restoredFrom === undefined) return null;
  const number = (last?.number ?? 0) + 1;
  await tx.insert(layoutRevisions).values({
    orgId: requireOrg(ctx),
    eventId: r.eventId,
    occurrenceId: r.key,
    number,
    kind: r.restoredFrom === undefined ? 'save' : 'restore',
    restoredFrom: r.restoredFrom ?? null,
    doc: r.doc,
    checksum: r.checksum,
    seatCount: r.seatCount,
    actorId: actorUuid(ctx),
  });
  if (number > KEEP_REVISIONS)
    await tx
      .delete(layoutRevisions)
      .where(
        and(onChart(layoutRevisions, r.eventId, r.key), lte(layoutRevisions.number, number - KEEP_REVISIONS)),
      );
  return number;
}

/** A date's own chart was removed: its revisions go with it. */
export async function dropRevisionsTx(tx: TenantTx, eventId: string, key: string): Promise<void> {
  await tx.delete(layoutRevisions).where(onChart(layoutRevisions, eventId, key));
}

const DateInput = z.uuid().nullable().optional();
const Kind = z.enum(REVISION_KINDS);

const DiffCountsDto = z.object({
  added: z.int(),
  removed: z.int(),
  renumbered: z.int(),
  moved: z.int(),
});
const counts = (d: LayoutDiff) => ({
  added: d.added.length,
  removed: d.removed.length,
  renumbered: d.renumbered.length,
  moved: d.moved,
});

export const RevisionSummaryDto = z.object({
  number: z.int(),
  kind: Kind,
  restoredFrom: z.int().nullable(),
  seatCount: z.int(),
  createdAt: z.date(),
  /** Against the revision before it (null for the first one kept). */
  changes: DiffCountsDto.nullable(),
});
export type RevisionSummaryDto = z.infer<typeof RevisionSummaryDto>;

export const RevisionsPageDto = z.object({
  /** The chart shown (M1.7g): null = the event plan. */
  chart: z.uuid().nullable(),
  status: z.enum(EVENT_LAYOUT_STATUSES),
  /** The newest revision (the plan as it is now), or null before the first save. */
  current: z.int().nullable(),
  revisions: z.array(RevisionSummaryDto),
});
export type RevisionsPageDto = z.infer<typeof RevisionsPageDto>;

/** A chart's revisions, newest first (null when the chart has no plan). */
export const layoutRevisionsQuery = tenantQuery({
  name: 'seating.layoutRevisions',
  input: z.object({ eventId: z.uuid(), occurrenceId: DateInput }),
  output: RevisionsPageDto.nullable(),
  entitlement: 'advanced_seating',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const key = await chartKeyTx(tx, input.eventId, input.occurrenceId);
    const [layout] = await tx
      .select({ status: eventLayouts.status })
      .from(eventLayouts)
      .where(onChart(eventLayouts, input.eventId, key));
    if (!layout) return null;
    const rows = await tx
      .select()
      .from(layoutRevisions)
      .where(onChart(layoutRevisions, input.eventId, key))
      .orderBy(desc(layoutRevisions.number))
      .limit(KEEP_REVISIONS);
    const docs = rows.map((r) => FloorplanDoc.parse(r.doc));
    return {
      chart: key,
      status: layout.status as (typeof EVENT_LAYOUT_STATUSES)[number],
      current: rows[0]?.number ?? null,
      revisions: rows.map((r, i) => {
        const before = docs[i + 1];
        const doc = docs[i] as FloorplanDoc;
        return {
          number: r.number,
          kind: r.kind as (typeof REVISION_KINDS)[number],
          restoredFrom: r.restoredFrom,
          seatCount: r.seatCount,
          createdAt: r.createdAt,
          changes: before ? counts(diffDocs(before, doc)) : null,
        };
      }),
    };
  },
});

const SeatChangeDto = z.object({ seatUuid: z.uuid(), label: z.string() });
const DiffDto = DiffCountsDto.extend({
  itemsAdded: z.int(),
  itemsRemoved: z.int(),
  /** The first `DIFF_LIST_LIMIT` seats of each kind (counts above are whole). */
  addedSeats: z.array(SeatChangeDto),
  removedSeats: z.array(SeatChangeDto),
  renumberedSeats: z.array(z.object({ seatUuid: z.uuid(), from: z.string(), to: z.string() })),
});
const diffDto = (d: LayoutDiff): z.infer<typeof DiffDto> => ({
  ...counts(d),
  itemsAdded: d.itemsAdded,
  itemsRemoved: d.itemsRemoved,
  addedSeats: d.added.slice(0, DIFF_LIST_LIMIT).map((s) => ({ seatUuid: s.seatId, label: s.label })),
  removedSeats: d.removed.slice(0, DIFF_LIST_LIMIT).map((s) => ({ seatUuid: s.seatId, label: s.label })),
  renumberedSeats: d.renumbered
    .slice(0, DIFF_LIST_LIMIT)
    .map((s) => ({ seatUuid: s.seatId, from: s.from, to: s.to })),
});

export const RevisionDetailDto = RevisionSummaryDto.omit({ changes: true }).extend({
  chart: z.uuid().nullable(),
  current: z.int(),
  /** What this revision changed, against the one before it (null for the first one kept). */
  changes: DiffDto.nullable(),
  /** What restoring it would change in the plan as it is now. */
  restore: DiffDto,
  /** Held and sold seats now, and what restoring does with each (kept, remapped, or in the way). */
  inUse: z.object({
    kept: z.int(),
    remapped: z.array(z.object({ seatUuid: z.uuid(), label: z.string(), status: z.enum(['held', 'sold']) })),
    conflicts: z.array(
      z.object({
        seatUuid: z.uuid(),
        label: z.string(),
        status: z.enum(['held', 'sold']),
        reason: z.enum(RESTORE_CONFLICTS),
        newLabel: z.string().nullable(),
      }),
    ),
  }),
  /** Restoring is possible (no conflicts, and it isn't the plan as it is now). */
  canRestore: z.boolean(),
});
export type RevisionDetailDto = z.infer<typeof RevisionDetailDto>;

async function inUseSeatsTx(tx: TenantTx, eventId: string, key: ChartKey): Promise<InUseSeat[]> {
  const rows = await tx
    .select({ seatUuid: eventSeats.seatUuid, label: eventSeats.label, status: eventSeats.status })
    .from(eventSeats)
    .where(and(onChart(eventSeats, eventId, key), inArray(eventSeats.status, ['held', 'sold'])));
  return rows.map((r) => ({ ...r, status: r.status as InUseSeat['status'] }));
}

async function revisionTx(tx: TenantTx, eventId: string, key: ChartKey, number: number) {
  const [row] = await tx
    .select()
    .from(layoutRevisions)
    .where(and(onChart(layoutRevisions, eventId, key), eq(layoutRevisions.number, number)));
  if (!row) throw new DomainError('not_found', 'Revision not found', { field: 'number' });
  return row;
}

/** One revision: what it changed, what restoring it would change, and the held and sold seats. */
export const layoutRevisionQuery = tenantQuery({
  name: 'seating.layoutRevision',
  input: z.object({ eventId: z.uuid(), occurrenceId: DateInput, number: z.int().min(1) }),
  output: RevisionDetailDto,
  entitlement: 'advanced_seating',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const key = await chartKeyTx(tx, input.eventId, input.occurrenceId);
    const [layout] = await tx
      .select({ doc: eventLayouts.doc })
      .from(eventLayouts)
      .where(onChart(eventLayouts, input.eventId, key));
    if (!layout) throw new DomainError('not_found', 'This event has no floor plan');
    const row = await revisionTx(tx, input.eventId, key, input.number);
    const [before] = await tx
      .select({ doc: layoutRevisions.doc })
      .from(layoutRevisions)
      .where(
        and(onChart(layoutRevisions, input.eventId, key), sql`${layoutRevisions.number} < ${input.number}`),
      )
      .orderBy(desc(layoutRevisions.number))
      .limit(1);
    const [latest] = await tx
      .select({ number: layoutRevisions.number })
      .from(layoutRevisions)
      .where(onChart(layoutRevisions, input.eventId, key))
      .orderBy(desc(layoutRevisions.number))
      .limit(1);
    const doc = FloorplanDoc.parse(row.doc);
    const now = FloorplanDoc.parse(layout.doc);
    const plan = planRestore(doc, await inUseSeatsTx(tx, input.eventId, key));
    const restore = diffDocs(now, plan.doc);
    const current = latest?.number ?? row.number;
    return {
      chart: key,
      current,
      number: row.number,
      kind: row.kind as (typeof REVISION_KINDS)[number],
      restoredFrom: row.restoredFrom,
      seatCount: row.seatCount,
      createdAt: row.createdAt,
      changes: before ? diffDto(diffDocs(FloorplanDoc.parse(before.doc), doc)) : null,
      restore: diffDto(restore),
      inUse: {
        kept: plan.outcomes.filter((o) => o.outcome === 'kept').length,
        remapped: plan.outcomes.flatMap((o) =>
          o.outcome === 'remapped' ? [{ seatUuid: o.seatUuid, label: o.label, status: o.status }] : [],
        ),
        conflicts: plan.outcomes.flatMap((o) =>
          o.outcome === 'conflict'
            ? [
                {
                  seatUuid: o.seatUuid,
                  label: o.label,
                  status: o.status,
                  reason: o.reason,
                  newLabel: o.newLabel ?? null,
                },
              ]
            : [],
        ),
      },
      canRestore: plan.ok && row.number !== current,
    };
  },
});

/**
 * Bring a revision's plan back (a new revision, `restore`). Held and sold seats stay exactly as
 * they are — same seat id, same label, same hold or ticket — so this works on a plan on sale and
 * on a locked one; when one of them can't stay (`planRestore`), nothing changes and the refusal
 * names the seats (`restore_conflicts`). Other seats keep their price and blocks when they keep
 * their id; guests keep seats that still exist.
 */
export const restoreLayoutRevisionCommand = tenantCommand({
  name: 'seating.restoreLayoutRevision',
  input: z.object({ eventId: z.uuid(), occurrenceId: DateInput, number: z.int().min(1) }),
  output: z.object({
    number: z.int(),
    seatCount: z.int(),
    kept: z.int(),
    remapped: z.int(),
    status: z.enum(EVENT_LAYOUT_STATUSES),
  }),
  entitlement: 'advanced_seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const key = await chartKeyTx(tx, input.eventId, input.occurrenceId);
    // The chart is locked for update: sales and edits wait for the restore (and the other way round).
    const [layout] = await tx
      .select()
      .from(eventLayouts)
      .where(onChart(eventLayouts, input.eventId, key))
      .for('update');
    if (!layout) throw new DomainError('not_found', 'This event has no floor plan');
    const row = await revisionTx(tx, input.eventId, key, input.number);
    const inUse = await inUseSeatsTx(tx, input.eventId, key);
    const plan = planRestore(FloorplanDoc.parse(row.doc), inUse);
    if (!plan.ok)
      throw new DomainError('conflict', 'Held or sold seats are not in that revision', {
        reason: 'restore_conflicts',
        conflicts: plan.outcomes.flatMap((o) =>
          o.outcome === 'conflict' ? [{ label: o.label, reason: o.reason }] : [],
        ),
      });
    // Validated like any save (the image must still be one of the org's own).
    const { doc, checksum } = validDoc(plan.doc, orgId);
    const seats = placedSeats(doc);
    const busy = new Set(inUse.map((s) => s.seatUuid));
    const kept = new Map(
      (
        await tx
          .select({
            seatUuid: eventSeats.seatUuid,
            ticketTypeId: eventSeats.ticketTypeId,
            status: eventSeats.status,
            blockReason: eventSeats.blockReason,
            groupLabel: eventSeats.groupLabel,
          })
          .from(eventSeats)
          .where(onChart(eventSeats, input.eventId, key))
      ).map((s) => [s.seatUuid, s]),
    );
    // Free seats are drawn again from the revision; held and sold rows stay and follow it.
    await tx
      .delete(eventSeats)
      .where(
        and(
          onChart(eventSeats, input.eventId, key),
          busy.size ? notInArray(eventSeats.seatUuid, [...busy]) : sql`true`,
        ),
      );
    for (const s of seats.filter((x) => busy.has(x.seatId)))
      await tx
        .update(eventSeats)
        .set({ itemId: s.itemId, sectionId: s.sectionId, accessible: s.accessible, updatedAt: ctx.now })
        .where(and(onChart(eventSeats, input.eventId, key), eq(eventSeats.seatUuid, s.seatId)));
    const fresh = seats.filter((x) => !busy.has(x.seatId));
    for (let i = 0; i < fresh.length; i += 1000)
      await tx.insert(eventSeats).values(
        fresh.slice(i, i + 1000).map((s) => {
          const was = kept.get(s.seatId);
          const blocked = was?.status === 'blocked';
          return {
            orgId,
            eventId: input.eventId,
            occurrenceId: key,
            seatUuid: s.seatId,
            label: s.label,
            itemId: s.itemId,
            sectionId: s.sectionId,
            accessible: s.accessible,
            ticketTypeId: was?.ticketTypeId ?? null,
            status: blocked ? ('blocked' as const) : ('available' as const),
            blockReason: blocked ? was?.blockReason : null,
            groupLabel: was?.groupLabel ?? null,
          };
        }),
      );
    await reconcileAssignmentsTx(tx, input.eventId, key, ctx);
    await tx
      .update(eventLayouts)
      .set({ doc, checksum, seatCount: seats.length, updatedAt: ctx.now })
      .where(eq(eventLayouts.id, layout.id));
    const number = await recordRevisionTx(tx, ctx, {
      eventId: input.eventId,
      key,
      doc,
      checksum,
      seatCount: seats.length,
      restoredFrom: input.number,
    });
    return {
      number: number ?? input.number,
      seatCount: seats.length,
      kept: plan.outcomes.filter((o) => o.outcome === 'kept').length,
      remapped: plan.outcomes.filter((o) => o.outcome === 'remapped').length,
      status: layout.status as (typeof EVENT_LAYOUT_STATUSES)[number],
    };
  },
  audit: (input, r) => ({
    action: 'seating.layout_restore',
    targetType: 'event',
    targetId: input.eventId,
    data: {
      revision: input.number,
      newRevision: r?.number,
      kept: r?.kept,
      remapped: r?.remapped,
      occurrenceId: input.occurrenceId ?? null,
    },
  }),
});
