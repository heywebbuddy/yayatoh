import type { Planter } from '../types.ts';

/** surveys: the person's link to the fixture's post-event survey, and their response record. */
export const plantSurveys: Planter = async ({ admin, orgId, ids }) => {
  if (!ids.contactId || !ids.attendeeId)
    throw new Error('plantSurveys: run plantCrm and plantAttendees first');
  const [send] = await admin`
    select id, survey_id from surveys.sends where org_id = ${orgId} order by created_at limit 1`;
  if (!send) return [];
  const [inv] = await admin`
    insert into surveys.invitations (org_id, survey_id, send_id, attendee_id, contact_id, expires_at, responded_at)
    values (${orgId}, ${send.survey_id as string}, ${send.id as string}, ${ids.attendeeId}, ${ids.contactId},
      now() + interval '30 days', now())
    returning id`;
  ids.surveyInvitationId = inv?.id as string;
  await admin`
    insert into surveys.responses (org_id, survey_id, invitation_id, contact_id, form_version)
    values (${orgId}, ${send.survey_id as string}, ${ids.surveyInvitationId}, ${ids.contactId}, 1)`;
  return ['surveys.invitations', 'surveys.responses'];
};
