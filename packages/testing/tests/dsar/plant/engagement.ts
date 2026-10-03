import type { Planter } from '../types.ts';

/**
 * engagement (M5.7a): two questions signed with the person's full name in a session's live Q&A,
 * one still pending (deleted on erasure) and one approved (kept, shown as anonymous).
 */
export const plantEngagement: Planter = async ({ admin, orgId, person }) => {
  const [s] = await admin`
    select id, event_id from program.sessions where org_id = ${orgId} order by created_at limit 1`;
  if (!s) return [];
  for (const state of ['pending', 'approved'])
    await admin`
      insert into engagement.questions (org_id, event_id, session_id, body, author_name, participant_key, state)
      values (${orgId}, ${s.event_id as string}, ${s.id as string}, ${`Will the slides be shared? (${state})`},
        ${person.name}, ${`dsar-canary-${state}-0123456789abcdef`}, ${state})`;
  return ['engagement.questions'];
};
