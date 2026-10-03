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
 * engagement networking and chat (M5.8a/b, batch 3u merge): the fixture's first networking
 * profile becomes the person's (through their crm contact), with the notes on requests and
 * meetings it asked for, the reports it filed and the chat messages it sent naming them.
 */
export const plantNetworking: Planter = async ({ admin, orgId, person, ids }) => {
  const tables: string[] = [];
  const [p] = await admin`
    update engagement.network_profiles set contact_id = ${ids.contactId as string}, display_name = ${person.name},
      company = ${`${person.lastName} Ltd`}, bio = ${`I am ${person.name}`}
    where id = (select id from engagement.network_profiles where org_id = ${orgId} order by created_at limit 1)
    returning id`;
  if (!p) return tables;
  const id = p.id as string;
  const note = `From ${person.name}, ${person.email}`;
  const wrote = async (table: string, rows: readonly unknown[]) => {
    if (rows.length) tables.push(table);
  };
  tables.push('engagement.network_profiles');
  await wrote(
    'engagement.network_connections',
    await admin`update engagement.network_connections set message = ${note}
      where org_id = ${orgId} and requester_id = ${id} returning id`,
  );
  await wrote(
    'engagement.meetings',
    await admin`update engagement.meetings set message = ${note}
      where org_id = ${orgId} and requester_id = ${id} returning id`,
  );
  await wrote(
    'engagement.network_reports',
    await admin`update engagement.network_reports set details = ${note}
      where org_id = ${orgId} and reporter_id = ${id} returning id`,
  );
  await wrote(
    'engagement.chat_messages',
    await admin`update engagement.chat_messages m set body = ${note}
      from engagement.chat_conversations c
      where m.org_id = ${orgId} and c.id = m.conversation_id
        and ((c.profile_a = ${id} and m.sender = 'a') or (c.profile_b = ${id} and m.sender = 'b'))
      returning m.id`,
  );
  await wrote(
    'engagement.chat_reports',
    await admin`update engagement.chat_reports r set details = ${note}
      from engagement.chat_conversations c
      where r.org_id = ${orgId} and c.id = r.conversation_id
        and ((c.profile_a = ${id} and r.reporter = 'a') or (c.profile_b = ${id} and r.reporter = 'b'))
      returning r.id`,
  );
  return tables;
};
