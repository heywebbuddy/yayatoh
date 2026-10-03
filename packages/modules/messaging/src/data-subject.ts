import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  DELETE,
  defineDataSubjectContributor,
  notSubject,
  type SubjectErasure,
  type SubjectExport,
  type SubjectRefs,
} from '@yayatoh/platform';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { reports, threadMessages, threads } from './schema.ts';

/** The person's conversation with the org (one thread per normalized address). */
async function threadIdsTx(tx: TenantTx, s: DataSubject): Promise<string[]> {
  const rows = await tx.select({ id: threads.id }).from(threads).where(eq(threads.contactEmailNorm, s.email));
  return rows.map((r) => r.id);
}

/**
 * messaging's part of a data-subject request (M6.1c). The person's thread with the org is
 * deleted with its messages (both directions) and the reports filed about it: the conversation
 * is between the org and them alone. Announcements are the organizer's broadcast to every
 * attendee and stay (the person's copy of one is a thread message, deleted with the thread).
 */
export const messagingDataSubjects = defineDataSubjectContributor({
  module: 'messaging',
  tables: {
    'messaging.threads': DELETE,
    'messaging.thread_messages': DELETE,
    'messaging.reports': DELETE,
    'messaging.announcements': notSubject(
      'the organizer’s announcements to all of an event’s attendees; a recipient’s copy is a thread message',
    ),
  },
  async resolve(tx, s): Promise<SubjectRefs> {
    const rows = await tx
      .select({ id: threads.id, name: threads.contactName })
      .from(threads)
      .where(eq(threads.contactEmailNorm, s.email));
    if (rows.length === 0) return {};
    return { thread: rows.map((r) => r.id), name: rows.flatMap((r) => (r.name ? [r.name] : [])) };
  },
  async export(tx, s): Promise<SubjectExport> {
    const ids = await threadIdsTx(tx, s);
    if (ids.length === 0) return { sections: {} };
    const conv = await tx
      .select({
        email: threads.contactEmail,
        name: threads.contactName,
        startedAt: threads.createdAt,
        lastMessageAt: threads.lastMessageAt,
        blockedByOrganizer: threads.blockedAt,
        blockedByYou: threads.contactBlockedAt,
      })
      .from(threads)
      .where(inArray(threads.id, ids));
    const messages = await tx
      .select({
        direction: threadMessages.direction,
        body: threadMessages.body,
        eventId: threadMessages.eventId,
        isAnnouncement: threadMessages.announcementId,
        sentAt: threadMessages.createdAt,
      })
      .from(threadMessages)
      .where(inArray(threadMessages.threadId, ids))
      .orderBy(asc(threadMessages.createdAt));
    // Reports the person filed (the organizer's reports and staff reviews are not theirs).
    const filed = await tx
      .select({
        reason: reports.reason,
        note: reports.note,
        status: reports.status,
        filedAt: reports.createdAt,
      })
      .from(reports)
      .where(and(inArray(reports.threadId, ids), eq(reports.reporter, 'contact')));
    return {
      sections: {
        threads: conv,
        messages: messages.map((m) => ({ ...m, isAnnouncement: m.isAnnouncement !== null })),
        reports: filed,
      },
    };
  },
  async erase(tx, s): Promise<SubjectErasure> {
    const ids = await threadIdsTx(tx, s);
    if (ids.length === 0) return { erased: {} };
    // Children first so the counts are exact (the foreign keys would cascade anyway).
    const msgs = await tx
      .delete(threadMessages)
      .where(inArray(threadMessages.threadId, ids))
      .returning({ id: threadMessages.id });
    const reps = await tx.delete(reports).where(inArray(reports.threadId, ids)).returning({ id: reports.id });
    const gone = await tx.delete(threads).where(inArray(threads.id, ids)).returning({ id: threads.id });
    return {
      erased: {
        'messaging.threads': gone.length,
        'messaging.thread_messages': msgs.length,
        'messaging.reports': reps.length,
      },
    };
  },
});
