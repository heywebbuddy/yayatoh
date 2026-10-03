import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  DELETE,
  defineDataSubjectContributor,
  notSubject,
  refsOf,
  type SubjectErasure,
  type SubjectExport,
  type SubjectRefs,
} from '@yayatoh/platform';
import { asc, inArray, or } from 'drizzle-orm';
import { surveyInvitations, surveyResponses, surveys } from './schema.ts';

/** The person's survey links: one per survey, by their contact (or their attendee record). */
async function invitationsTx(tx: TenantTx, s: DataSubject) {
  const contacts = refsOf(s, 'contact');
  const attendees = refsOf(s, 'attendee');
  if (contacts.length === 0 && attendees.length === 0) return [];
  return tx
    .select()
    .from(surveyInvitations)
    .where(
      or(
        contacts.length ? inArray(surveyInvitations.contactId, contacts) : undefined,
        attendees.length ? inArray(surveyInvitations.attendeeId, attendees) : undefined,
      ),
    )
    .orderBy(asc(surveyInvitations.createdAt));
}

/**
 * surveys' part of a data-subject request (M6.1c). The person's survey links and response
 * records are deleted. Their answers live in `forms.form_responses` (respondent
 * `survey_invitation`): `resolve` hands the invitation ids to forms under the `survey_invitation`
 * ref kind. Surveys themselves are the organizer's questions.
 */
export const surveysDataSubjects = defineDataSubjectContributor({
  module: 'surveys',
  tables: {
    'surveys.surveys': notSubject("the organizer's survey title and intro, sent to the people invited"),
    'surveys.invitations': DELETE,
    'surveys.responses': DELETE,
  },
  async resolve(tx, s): Promise<SubjectRefs> {
    const rows = await invitationsTx(tx, s);
    return rows.length ? { survey_invitation: rows.map((r) => r.id) } : {};
  },
  async export(tx, s): Promise<SubjectExport> {
    const invited = await invitationsTx(tx, s);
    if (invited.length === 0) return { sections: {} };
    const ids = invited.map((i) => i.id);
    const titles = await tx
      .select({ id: surveys.id, eventId: surveys.eventId, kind: surveys.kind, title: surveys.title })
      .from(surveys)
      .where(inArray(surveys.id, [...new Set(invited.map((i) => i.surveyId))]));
    const answered = await tx
      .select({ invitationId: surveyResponses.invitationId, at: surveyResponses.createdAt })
      .from(surveyResponses)
      .where(inArray(surveyResponses.invitationId, ids));
    const survey = new Map(titles.map((t) => [t.id, t]));
    const response = new Map(answered.map((r) => [r.invitationId, r.at]));
    return {
      sections: {
        surveyInvitations: invited.map((i) => ({
          eventId: survey.get(i.surveyId)?.eventId ?? null,
          surveyKind: survey.get(i.surveyId)?.kind ?? null,
          surveyTitle: survey.get(i.surveyId)?.title ?? null,
          invitedAt: i.createdAt,
          expiresAt: i.expiresAt,
          respondedAt: response.get(i.id) ?? i.respondedAt,
        })),
      },
    };
  },
  async erase(tx, s): Promise<SubjectErasure> {
    const invited = await invitationsTx(tx, s);
    const contacts = refsOf(s, 'contact');
    const ids = invited.map((i) => i.id);
    if (ids.length === 0 && contacts.length === 0) return { erased: {} };
    const responses = await tx
      .delete(surveyResponses)
      .where(
        or(
          ids.length ? inArray(surveyResponses.invitationId, ids) : undefined,
          contacts.length ? inArray(surveyResponses.contactId, contacts) : undefined,
        ),
      )
      .returning({ id: surveyResponses.id });
    const invitations = ids.length
      ? await tx
          .delete(surveyInvitations)
          .where(inArray(surveyInvitations.id, ids))
          .returning({ id: surveyInvitations.id })
      : [];
    return {
      erased: { 'surveys.invitations': invitations.length, 'surveys.responses': responses.length },
    };
  },
});
