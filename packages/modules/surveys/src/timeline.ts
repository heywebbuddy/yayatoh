import { recordTimelineTx, type TimelineFact } from '@yayatoh/crm';
import { createCtx } from '@yayatoh/kernel';
import { defineSubscriber, type Subscriber } from '@yayatoh/platform';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { surveyInvitations, surveys } from './schema.ts';

const Sent = z.object({ surveyId: z.uuid(), sendId: z.uuid() });
const Responded = z.object({ surveyId: z.uuid(), invitationId: z.uuid() });
const SUBJECT = 'surveys.invitations';

/**
 * The person timeline's surveys (M6.1a): each invitation sent and each response, labelled with
 * the survey's title (never the answers). The invitation is the subject.
 */
export function surveysTimeline(): Subscriber {
  return defineSubscriber({
    name: 'surveys.timeline',
    events: ['survey.sent@1', 'survey.responded@1'],
    handle: async (tx, event) => {
      const ctx = createCtx({ orgId: event.orgId, actor: { type: 'system', name: 'surveys.timeline' } });
      const sent = event.type === 'survey.sent';
      const p = sent ? Sent.parse(event.payload) : Responded.parse(event.payload);
      const [survey] = await tx
        .select({ title: surveys.title, eventId: surveys.eventId })
        .from(surveys)
        .where(eq(surveys.id, p.surveyId));
      if (!survey) return;
      const rows = await tx
        .select({
          id: surveyInvitations.id,
          contactId: surveyInvitations.contactId,
          createdAt: surveyInvitations.createdAt,
          respondedAt: surveyInvitations.respondedAt,
        })
        .from(surveyInvitations)
        .where(
          'sendId' in p ? eq(surveyInvitations.sendId, p.sendId) : eq(surveyInvitations.id, p.invitationId),
        );
      const facts: TimelineFact[] = rows.map((r) => ({
        contactId: r.contactId,
        kind: sent ? 'survey_sent' : 'survey_responded',
        occurredAt: sent ? r.createdAt : (r.respondedAt ?? new Date(event.occurredAt ?? Date.now())),
        eventId: survey.eventId,
        sourceRef: r.id,
        subject: { table: SUBJECT, id: r.id },
        label: survey.title,
      }));
      await recordTimelineTx(tx, ctx, facts);
    },
  });
}
