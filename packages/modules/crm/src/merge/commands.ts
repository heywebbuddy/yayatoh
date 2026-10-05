import { defineSerializer } from '@yayatoh/contracts';
import { DomainError, uuidv7 } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, duplicateCandidates, MERGE_FIELDS } from '../schema.ts';
import { BULK_MERGE_MAX, defaultSurvivor } from './domain.ts';
import { mergeContactsTx, undoMergeTx } from './engine.ts';

const Side = z.enum(['source', 'target']);
export const MergeChoicesInput = z.object(
  Object.fromEntries(MERGE_FIELDS.map((f) => [f, Side])) as Record<
    (typeof MERGE_FIELDS)[number],
    typeof Side
  >,
);

const Counts = z.record(z.string(), z.int());
export const MergeResultDto = z.object({
  mergeId: z.uuid(),
  sourceContactId: z.uuid(),
  targetContactId: z.uuid(),
  moved: Counts,
  kept: Counts,
});
export const mergeResultSerializer = defineSerializer('crm.mergeResult', MergeResultDto);

/**
 * Merge one duplicate into the record that stays (M6.1a), choosing each field. Audited; a single
 * merge needs no step-up (it can be undone for 30 days); bulk merges do.
 */
export const mergeContactsCommand = tenantCommand({
  name: 'crm.mergeContacts',
  input: z.object({
    sourceContactId: z.uuid(),
    targetContactId: z.uuid(),
    choices: MergeChoicesInput.optional(),
  }),
  output: MergeResultDto,
  entitlement: 'marketing',
  permission: 'contacts:merge',
  handler: async ({ input, ctx, tx, emit }) => mergeContactsTx(tx, ctx, input, emit),
  present: (r) => mergeResultSerializer.serialize(r),
  audit: (input, r) => ({
    action: 'crm.mergeContacts',
    targetType: 'contact',
    targetId: input.targetContactId,
    data: { mergeId: r.mergeId, sourceContactId: input.sourceContactId, moved: r.moved, kept: r.kept },
  }),
});

export const BulkMergeDto = z.object({
  bulkId: z.uuid(),
  merged: z.int(),
  /** Candidates no longer open, or whose records changed since (merged elsewhere, erased). */
  skipped: z.int(),
  mergeIds: z.array(z.uuid()),
});
export const bulkMergeSerializer = defineSerializer('crm.bulkMerge', BulkMergeDto);

/**
 * Merge several open candidates at once with the default choices (the older record stays, each
 * field the most recent non-empty value). Step-up, at most 50 pairs, one audit row naming each
 * merge; each can still be undone on its own.
 */
export const mergeDuplicatesBulkCommand = tenantCommand({
  name: 'crm.mergeDuplicatesBulk',
  input: z.object({ candidateIds: z.array(z.uuid()).min(1).max(BULK_MERGE_MAX) }),
  output: BulkMergeDto,
  entitlement: 'marketing',
  permission: 'contacts:merge',
  stepUp: true,
  handler: async ({ input, ctx, tx, emit }) => {
    const ids = [...new Set(input.candidateIds)];
    const rows = await tx
      .select()
      .from(duplicateCandidates)
      .where(and(inArray(duplicateCandidates.id, ids), eq(duplicateCandidates.status, 'open')));
    const bulkId = uuidv7();
    const mergeIds: string[] = [];
    let skipped = ids.length - rows.length;
    // Highest confidence first; a record merged away by an earlier pair skips the later ones.
    for (const c of rows.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1))) {
      const pair = await tx
        .select({ id: contacts.id, createdAt: contacts.createdAt, mergedInto: contacts.mergedInto })
        .from(contacts)
        .where(inArray(contacts.id, [c.contactAId, c.contactBId]));
      const [a, b] = [pair.find((p) => p.id === c.contactAId), pair.find((p) => p.id === c.contactBId)];
      if (!a || !b || a.mergedInto || b.mergedInto) {
        skipped += 1;
        continue;
      }
      const { keep, merge } = defaultSurvivor(a, b);
      try {
        const r = await mergeContactsTx(
          tx,
          ctx,
          { sourceContactId: merge.id, targetContactId: keep.id, bulkId },
          emit,
        );
        mergeIds.push(r.mergeId);
      } catch (err) {
        if (
          err instanceof DomainError &&
          err.code === 'invalid_state' &&
          err.details?.reason !== 'owners_missing'
        ) {
          skipped += 1;
          continue;
        }
        throw err;
      }
    }
    return bulkMergeSerializer.serialize({ bulkId, merged: mergeIds.length, skipped, mergeIds });
  },
  audit: (input, r) => ({
    action: 'crm.mergeDuplicatesBulk',
    targetType: 'contact_merge_bulk',
    targetId: r.bulkId,
    data: {
      candidates: input.candidateIds.length,
      merged: r.merged,
      skipped: r.skipped,
      mergeIds: r.mergeIds,
    },
  }),
});

export const UndoMergeDto = z.object({ sourceContactId: z.uuid(), targetContactId: z.uuid() });
export const undoMergeSerializer = defineSerializer('crm.undoMerge', UndoMergeDto);

/** Undo a merge within 30 days: the split is restored exactly (M6.1a). Audited. */
export const undoMergeCommand = tenantCommand({
  name: 'crm.undoMerge',
  input: z.object({ mergeId: z.uuid() }),
  output: UndoMergeDto,
  entitlement: 'marketing',
  permission: 'contacts:merge',
  handler: async ({ input, ctx, tx, emit }) =>
    undoMergeSerializer.serialize(await undoMergeTx(tx, ctx, input.mergeId, emit)),
  audit: (input, r) => ({
    action: 'crm.undoMerge',
    targetType: 'contact',
    targetId: r.targetContactId,
    data: { mergeId: input.mergeId, sourceContactId: r.sourceContactId },
  }),
});
