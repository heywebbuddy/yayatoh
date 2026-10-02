import type { TenantTx } from '@yayatoh/db';
import { and, inArray, isNotNull, or, type SQL, sql } from 'drizzle-orm';
import { DELETE, type DataSubject, defineDataSubjectContributor, REDACT, refsOf } from './data-subject.ts';
import { ERASED_EMAIL, ERASED_NAME } from './privacy.ts';
import { bulkOperationItems, bulkOperations, fileParts, files, idempotencyKeys, realtimeMessages } from './schema.ts';

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * What identifies the person in free-form platform data: the address, and names other modules
 * found for them (only ones long enough not to hit unrelated text).
 */
export function subjectNeedles(s: DataSubject): string[] {
  const names = refsOf(s, 'name').filter((n) => n.trim().length >= 4 && n !== 'Erased');
  return [...new Set([s.email, ...names])];
}

const mentions = (col: SQL, needles: readonly string[]) =>
  or(...needles.map((n) => sql`${col} ilike ${`%${likeEscape(n)}%`} escape '\\'`)) as SQL;

/**
 * The platform's own records about a person (M6.1c): generated export files that mention them
 * are deleted, finished bulk operations lose parameters and undo data that mention them,
 * idempotency replays and the realtime log that mention them are deleted, and the outbox log is
 * redacted in place (append-only for the app: through the SECURITY DEFINER
 * `platform.redact_subject_events`). Nothing here is exported: it is system data the person never
 * gave (their records are exported by the modules that own them).
 */
export const platformDataSubjects = defineDataSubjectContributor({
  module: 'platform',
  tables: {
    'platform.files': DELETE,
    'platform.file_parts': DELETE,
    'platform.bulk_operations': REDACT,
    'platform.bulk_operation_items': REDACT,
    'platform.idempotency_keys': DELETE,
    'platform.realtime_messages': DELETE,
    'platform.domain_events': REDACT,
  },
  export: async () => ({ sections: {} }),
  erase: async (tx: TenantTx, s) => {
    const needles = subjectNeedles(s);
    const hits = await tx
      .selectDistinct({ id: fileParts.fileId })
      .from(fileParts)
      .where(mentions(sql`${fileParts.data}`, needles));
    const fileIds = hits.map((h) => h.id);
    if (fileIds.length)
      await tx
        .update(bulkOperations)
        .set({ fileId: null, updatedAt: new Date() })
        .where(inArray(bulkOperations.fileId, fileIds));
    const deletedFiles = fileIds.length
      ? await tx.delete(files).where(inArray(files.id, fileIds)).returning({ id: files.id })
      : [];
    const params = await tx
      .update(bulkOperations)
      .set({ params: {}, updatedAt: new Date() })
      .where(
        and(
          sql`${bulkOperations.status} in ('done', 'failed', 'undone')`,
          mentions(sql`${bulkOperations.params}::text`, needles),
        ),
      )
      .returning({ id: bulkOperations.id });
    const undo = await tx
      .update(bulkOperationItems)
      .set({ undo: null, updatedAt: new Date() })
      .where(and(isNotNull(bulkOperationItems.undo), mentions(sql`${bulkOperationItems.undo}::text`, needles)))
      .returning({ id: bulkOperationItems.id });
    const replays = await tx
      .delete(idempotencyKeys)
      .where(mentions(sql`${idempotencyKeys.response}::text`, needles))
      .returning({ id: idempotencyKeys.id });
    const live = await tx
      .delete(realtimeMessages)
      .where(mentions(sql`${realtimeMessages.data}::text`, needles))
      .returning({ id: realtimeMessages.id });
    // The outbox log: the address becomes the placeholder address, names the placeholder name.
    const redactEvents = async (list: readonly string[], replacement: string) => {
      if (list.length === 0) return 0;
      const [r] = await tx.execute<{ n: number }>(
        sql`select platform.redact_subject_events(array[${sql.join(
          list.map((n) => sql`${n}`),
          sql`, `,
        )}]::text[], ${replacement}) as n`,
      );
      return Number(r?.n ?? 0);
    };
    const events =
      (await redactEvents([s.email], ERASED_EMAIL)) +
      (await redactEvents(
        needles.filter((n) => n !== s.email),
        ERASED_NAME,
      ));
    return {
      erased: {
        'platform.files': deletedFiles.length,
        'platform.bulk_operations': params.length,
        'platform.bulk_operation_items': undo.length,
        'platform.idempotency_keys': replays.length,
        'platform.realtime_messages': live.length,
        'platform.domain_events': events,
      },
    };
  },
});
