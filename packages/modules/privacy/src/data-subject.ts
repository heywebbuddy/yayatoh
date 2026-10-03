import { defineDataSubjectContributor, hold, type SubjectErasure } from '@yayatoh/platform';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { subjectRefOf } from './dsar.ts';
import { dsarRequests } from './schema.ts';

/**
 * privacy's own records about the person (M6.1c): the request records are the org's proof that
 * it answered (accountability, GDPR Art. 5(2)); they hold a masked hint and a SHA-256, never the
 * address once closed, so they are kept and listed. Earlier access archives mention the person:
 * their stored files are deleted after the erasure commits.
 */
export const privacyDataSubjects = defineDataSubjectContributor({
  module: 'privacy',
  tables: { 'privacy.dsar_requests': hold('accountability') },
  async export(tx, s) {
    const rows = await tx
      .select()
      .from(dsarRequests)
      .where(eq(dsarRequests.subjectRef, await subjectRefOf(s.email)))
      .orderBy(asc(dsarRequests.createdAt));
    return {
      sections: {
        requests: rows.map((r) => ({
          kind: r.kind,
          status: r.status,
          source: r.source,
          requestedAt: r.createdAt,
          dueAt: r.dueAt,
          completedAt: r.completedAt,
        })),
      },
    };
  },
  async erase(tx, s, ctx): Promise<SubjectErasure> {
    const ref = await subjectRefOf(s.email);
    const archives = await tx
      .update(dsarRequests)
      .set({ exportKey: null, exportExpiresAt: null, updatedAt: ctx.now })
      .where(and(eq(dsarRequests.subjectRef, ref), isNotNull(dsarRequests.exportKey)))
      .returning({ id: dsarRequests.id });
    const rows = await tx
      .select({ id: dsarRequests.id, kind: dsarRequests.kind })
      .from(dsarRequests)
      .where(eq(dsarRequests.subjectRef, ref));
    return {
      erased: { 'privacy.dsar_requests': archives.length },
      held: rows.map((r) => ({
        table: 'privacy.dsar_requests',
        id: r.id,
        ref: r.kind,
        basis: 'accountability' as const,
      })),
      // An archive is stored under `{org}/{requestId}/…`: the request id is its media prefix.
      mediaAssets: archives.map((a) => a.id),
    };
  },
});
