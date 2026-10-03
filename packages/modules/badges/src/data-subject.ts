import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  DELETE,
  defineDataSubjectContributor,
  REDACT,
  refsOf,
  type SubjectErasure,
} from '@yayatoh/platform';
import { and, arrayOverlaps, asc, eq, gt, inArray } from 'drizzle-orm';
import { batches, batchParts } from './schema.ts';

/** Badge batches that print one of the person's tickets (they hold it). */
async function batchesTx(tx: TenantTx, s: DataSubject) {
  const tickets = refsOf(s, 'ticket');
  if (tickets.length === 0) return [];
  return tx
    .select({
      id: batches.id,
      eventId: batches.eventId,
      status: batches.status,
      expiresAt: batches.expiresAt,
      createdAt: batches.createdAt,
      finishedAt: batches.finishedAt,
    })
    .from(batches)
    .where(arrayOverlaps(batches.ticketIds, tickets))
    .orderBy(asc(batches.createdAt));
}

/**
 * badges' part of a data-subject request (M6.1c). Rendered chunks (PDF bytes with the person's
 * name) of every batch printing one of their tickets are deleted, and a batch still rendering is
 * failed (`subject_erased`) so it never merges a file with them. A finished batch's merged file
 * expires now: its download link stops serving it (the file in the media store is not a media
 * asset; it goes with the store's expiry).
 */
export const badgesDataSubjects = defineDataSubjectContributor({
  module: 'badges',
  tables: {
    'badges.batch_parts': DELETE,
    'badges.batches': REDACT,
  },
  async export(tx, s) {
    const rows = await batchesTx(tx, s);
    return {
      sections: {
        badgePrints: rows.map((b) => ({
          eventId: b.eventId,
          status: b.status,
          requestedAt: b.createdAt,
          finishedAt: b.finishedAt,
        })),
      },
    };
  },
  async erase(tx, s, ctx): Promise<SubjectErasure> {
    const rows = await batchesTx(tx, s);
    if (rows.length === 0) return { erased: {} };
    const ids = rows.map((b) => b.id);
    const parts = await tx
      .delete(batchParts)
      .where(inArray(batchParts.batchId, ids))
      .returning({ id: batchParts.id });
    const failed = await tx
      .update(batches)
      .set({ status: 'failed', errorCode: 'subject_erased', finishedAt: ctx.now, updatedAt: ctx.now })
      .where(and(inArray(batches.id, ids), inArray(batches.status, ['queued', 'running'])))
      .returning({ id: batches.id });
    const expired = await tx
      .update(batches)
      .set({ expiresAt: ctx.now, updatedAt: ctx.now })
      .where(and(inArray(batches.id, ids), eq(batches.status, 'done'), gt(batches.expiresAt, ctx.now)))
      .returning({ id: batches.id });
    // A finished batch's merged PDF is stored under `{org}/{batchId}/…` (`batchFileKey`): the batch id
    // is its media prefix, so the file goes after commit with the erasure's other files.
    const stored = rows.filter((b) => b.status === 'done').map((b) => b.id);
    return {
      erased: {
        'badges.batch_parts': parts.length,
        'badges.batches': failed.length + expired.length,
      },
      mediaAssets: stored,
    };
  },
});
