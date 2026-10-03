import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  DELETE,
  defineDataSubjectContributor,
  refsOf,
  type SubjectErasure,
} from '@yayatoh/platform';
import { and, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import { syncConflicts, syncErrors } from './schema.ts';

/**
 * The conflicts that are about the person (M6.4b): the inbox row's Yayatoh record is one of their
 * attendee records, or a kept or lost value is their address.
 */
async function conflictRowsTx(tx: TenantTx, s: DataSubject) {
  const attendees = refsOf(s, 'attendee');
  return tx
    .select({ c: syncConflicts, localId: syncErrors.localId })
    .from(syncConflicts)
    .innerJoin(
      syncErrors,
      and(eq(syncErrors.orgId, syncConflicts.orgId), eq(syncErrors.id, syncConflicts.errorId)),
    )
    .where(
      or(
        sql`lower(btrim(${syncConflicts.kept})) = ${s.email}`,
        sql`lower(btrim(${syncConflicts.lost})) = ${s.email}`,
        attendees.length ? inArray(syncErrors.localId, attendees) : undefined,
      ) as SQL,
    );
}

/**
 * integrations' part of a data-subject request (M6.1c, M6.4b). The only personal values are the
 * kept and lost values of a sync conflict waiting in the errors inbox; erasure deletes them (the
 * inbox row itself holds codes only and stays).
 */
export const integrationsDataSubjects = defineDataSubjectContributor({
  module: 'integrations',
  tables: { 'integrations.sync_conflicts': DELETE },
  async export(tx, s) {
    const rows = await conflictRowsTx(tx, s);
    return {
      sections: {
        syncConflicts: rows.map(({ c, localId }) => ({
          recordId: localId,
          field: c.field,
          kept: c.kept,
          lost: c.lost,
          createdAt: c.createdAt,
        })),
      },
    };
  },
  async erase(tx, s): Promise<SubjectErasure> {
    const ids = (await conflictRowsTx(tx, s)).map((r) => r.c.id);
    if (ids.length) await tx.delete(syncConflicts).where(inArray(syncConflicts.id, ids));
    return { erased: { 'integrations.sync_conflicts': ids.length } };
  },
});
