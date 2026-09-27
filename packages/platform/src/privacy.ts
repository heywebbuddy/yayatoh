import type { TenantTx } from '@yayatoh/db';
import { and, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { bulkOperations, fileParts, files, idempotencyKeys } from './schema.ts';

/**
 * Shared pieces for data-subject requests and retention (M1.14c). Modules redact a person's
 * data in place with these placeholders, so rows the law requires us to keep (paid orders, the
 * ledger, check-in counts) survive without anything that identifies the person.
 */
export const ERASED_NAME = 'Erased';
/** RFC 2606 `.invalid`: can never be delivered to. */
export const ERASED_EMAIL = 'erased@erased.invalid';

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Delete this org's generated files (exports) that mention the text anywhere, e.g. an erased
 * person's email in an attendee or bookings CSV. Returns how many files were deleted.
 */
export async function purgeFilesMentioningTx(tx: TenantTx, needle: string): Promise<number> {
  if (needle.trim().length < 3) return 0;
  const hits = await tx
    .selectDistinct({ id: fileParts.fileId })
    .from(fileParts)
    .where(sql`${fileParts.data} ilike ${`%${likeEscape(needle)}%`} escape '\\'`);
  if (hits.length === 0) return 0;
  const ids = hits.map((h) => h.id);
  await tx
    .update(bulkOperations)
    .set({ fileId: null, updatedAt: new Date() })
    .where(inArray(bulkOperations.fileId, ids));
  const deleted = await tx.delete(files).where(inArray(files.id, ids)).returning({ id: files.id });
  return deleted.length;
}

/** Retention: generated files past their expiry (parts cascade). */
export async function purgeExpiredFilesTx(tx: TenantTx, now: Date): Promise<number> {
  const due = await tx.select({ id: files.id }).from(files).where(lt(files.expiresAt, now)).limit(500);
  if (due.length === 0) return 0;
  const ids = due.map((d) => d.id);
  await tx
    .update(bulkOperations)
    .set({ fileId: null, updatedAt: now })
    .where(inArray(bulkOperations.fileId, ids));
  return (await tx.delete(files).where(inArray(files.id, ids)).returning({ id: files.id })).length;
}

/**
 * Retention: the parameters of finished bulk operations are only needed for undo. Clear them
 * after `olderThan` (they can hold search text or, for data-subject exports, an email).
 */
export async function clearFinishedBulkParamsTx(
  tx: TenantTx,
  before: Date,
  actionPrefix?: string,
): Promise<number> {
  const rows = await tx
    .update(bulkOperations)
    .set({ params: {}, updatedAt: new Date() })
    .where(
      and(
        isNotNull(bulkOperations.finishedAt),
        lt(bulkOperations.finishedAt, before),
        sql`${bulkOperations.params} <> '{}'::jsonb`,
        sql`${bulkOperations.status} in ('done', 'failed', 'undone')`,
        actionPrefix ? sql`${bulkOperations.action} like ${`${likeEscape(actionPrefix)}%`}` : undefined,
      ),
    )
    .returning({ id: bulkOperations.id });
  return rows.length;
}

/** Retention: idempotency records a day past their expiry. */
export async function purgeExpiredIdempotencyKeysTx(tx: TenantTx, before: Date): Promise<number> {
  return (
    await tx
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.expiresAt, before))
      .returning({ id: idempotencyKeys.id })
  ).length;
}
