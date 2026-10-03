import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  defineDataSubjectContributor,
  ERASED_NAME,
  REDACT,
  refsOf,
  type SubjectErasure,
} from '@yayatoh/platform';
import { and, asc, inArray, ne, sql } from 'drizzle-orm';
import { questions } from './schema.ts';

/**
 * The person's full names (first and last: at least two words) as other modules resolved them.
 * Participant keys are HMACs, never identities, so a question is the person's only through the
 * name they typed; a single word ("Sam") would match other people and is never used.
 */
const fullNames = (s: DataSubject) => [
  ...new Set(
    refsOf(s, 'name')
      .map((n) => n.trim().toLowerCase())
      .filter((n) => n !== ERASED_NAME.toLowerCase() && /\S\s+\S/.test(n)),
  ),
];

async function questionRowsTx(tx: TenantTx, s: DataSubject) {
  const names = fullNames(s);
  if (names.length === 0) return [];
  return tx
    .select()
    .from(questions)
    .where(inArray(sql`lower(btrim(${questions.authorName}))`, names))
    .orderBy(asc(questions.createdAt));
}

/**
 * engagement's part of a data-subject request (M6.1c, for M5.7a live Q&A). Questions signed with
 * the person's full name: exported; on erasure the ones still pending or dismissed are deleted
 * (nobody but moderators ever saw them) and approved ones lose the name and show as "Anonymous"
 * (the audience saw the question; its text stays with the session). Polls, ballots and upvotes
 * are keyed by HMACs and hold nothing about a person.
 */
export const engagementDataSubjects = defineDataSubjectContributor({
  module: 'engagement',
  tables: {
    'engagement.questions': REDACT,
  },
  async export(tx, s) {
    const rows = await questionRowsTx(tx, s);
    return {
      sections: {
        questions: rows.map((q) => ({
          eventId: q.eventId,
          sessionId: q.sessionId,
          body: q.body,
          authorName: q.authorName,
          anonymous: q.anonymous,
          state: q.state,
          askedAt: q.createdAt,
          answeredAt: q.answeredAt,
        })),
      },
    };
  },
  async erase(tx, s, ctx): Promise<SubjectErasure> {
    const ids = (await questionRowsTx(tx, s)).map((q) => q.id);
    if (ids.length === 0) return { erased: { 'engagement.questions': 0 } };
    const unseen = await tx
      .delete(questions)
      .where(and(inArray(questions.id, ids), ne(questions.state, 'approved')))
      .returning({ id: questions.id });
    const shown = await tx
      .update(questions)
      .set({ authorName: null, anonymous: true, updatedAt: ctx.now })
      .where(inArray(questions.id, ids))
      .returning({ id: questions.id });
    return { erased: { 'engagement.questions': unseen.length + shown.length } };
  },
});
