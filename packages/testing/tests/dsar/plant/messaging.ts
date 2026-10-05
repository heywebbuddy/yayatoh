import type { Planter } from '../types.ts';

/**
 * messaging: the person's conversation with the org (their message, the organizer's reply) and a
 * report they filed about it.
 */
export const plantMessaging: Planter = async ({ admin, orgId, eventId, ownerId, person }) => {
  const [thread] = await admin`
    insert into messaging.threads (org_id, contact_email_norm, contact_email, contact_name, last_event_id, unread)
    values (${orgId}, ${person.email}, ${person.email.toUpperCase()}, ${person.name}, ${eventId}, true)
    returning id`;
  const threadId = thread?.id as string;
  await admin`
    insert into messaging.thread_messages (org_id, thread_id, direction, body, event_id)
    values (${orgId}, ${threadId}, 'in', ${`Hi, ${person.name} here. Call me on ${person.phone}.`}, ${eventId}),
      (${orgId}, ${threadId}, 'out', ${`Thanks ${person.lastName}, we will call.`}, ${eventId})`;
  await admin`
    insert into messaging.reports (org_id, thread_id, reporter, reporter_user_id, reason, note)
    values (${orgId}, ${threadId}, 'organizer', ${ownerId}, 'spam', ${`${person.name} keeps writing`})`;
  return ['messaging.threads', 'messaging.thread_messages', 'messaging.reports'];
};
