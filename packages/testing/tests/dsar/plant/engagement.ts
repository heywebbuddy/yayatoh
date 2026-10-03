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

/**
 * Batch 3j merge (M5.8a/b): the fixture event's first networking profile becomes the person's (by
 * their crm contact), with a note on a request they sent and a chat message they sent.
 */
export const plantNetworking: Planter = async ({ admin, orgId, person, ids }) => {
  if (!ids.contactId) return [];
  const [p] = await admin`
    update engagement.network_profiles set contact_id = ${ids.contactId}, display_name = ${person.name},
      company = ${`${person.lastName} Holdings`}, bio = ${`Write to ${person.email}`}
    where id = (select id from engagement.network_profiles where org_id = ${orgId} order by created_at limit 1)
    returning id`;
  if (!p) return [];
  const tables = ['engagement.network_profiles'];
  const [c] = await admin`
    update engagement.network_connections set message = ${`Hello, ${person.name} here`}
    where id = (select id from engagement.network_connections where org_id = ${orgId}
      and requester_id = ${p.id as string} order by created_at limit 1)
    returning id`;
  if (c) tables.push('engagement.network_connections');
  const [m] = await admin`
    update engagement.chat_messages set body = ${`Call me, ${person.phone} (${person.lastName})`}
    where id = (select m.id from engagement.chat_messages m
      join engagement.chat_conversations v on v.id = m.conversation_id
      where m.org_id = ${orgId} and ((v.profile_a = ${p.id as string} and m.sender = 'a')
        or (v.profile_b = ${p.id as string} and m.sender = 'b'))
      order by m.created_at limit 1)
    returning id`;
  if (m) tables.push('engagement.chat_messages');
  return tables;
};
