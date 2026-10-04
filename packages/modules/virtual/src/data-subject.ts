import type { TenantTx } from '@yayatoh/db';
import { defineDataSubjectContributor, notSubject, refsOf, type SubjectErasure } from '@yayatoh/platform';
import { inArray, sql } from 'drizzle-orm';
import { watchMinutes } from './schema.ts';

/** A person's watch time per session (their tickets), for the access document. */
async function watchTimeTx(tx: TenantTx, ticketIds: readonly string[]) {
  if (ticketIds.length === 0) return [];
  return tx
    .select({ sessionId: watchMinutes.sessionId, minutes: sql<number>`count(*)::int` })
    .from(watchMinutes)
    .where(inArray(watchMinutes.ticketId, [...ticketIds]))
    .groupBy(watchMinutes.sessionId);
}

/**
 * virtual's part of a data-subject request (M6.9a). Streams hold the provider's ids only (the
 * playback id reaches ticket holders in their player); viewings and watch minutes hold ticket ids
 * and times, kept as the streaming meter (D24) and pointing at no one once ticketing redacts the
 * ticket. Exported: minutes watched per session with the person's tickets.
 */
export const virtualDataSubjects = defineDataSubjectContributor({
  module: 'virtual',
  tables: {
    'virtual.streams': notSubject(
      "a session's live stream: provider ids and the playback id every viewer of the session shares; no person",
    ),
  },
  async export(tx: TenantTx, s) {
    return { sections: { watchTime: await watchTimeTx(tx, refsOf(s, 'ticket')) } };
  },
  erase: async (): Promise<SubjectErasure> => ({ erased: {} }),
});
