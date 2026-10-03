import type { Planter } from '../types.ts';

/** assistance: a help request from the person's ticket, with their note and a staff note on it. */
export const plantAssistance: Planter = async ({ admin, orgId, ownerId, person, ids }) => {
  if (!ids.ticketId) throw new Error('plantAssistance: the ticketing planter runs first (ids.ticketId)');
  const [ticket] = await admin`
    select event_id from ticketing.tickets where org_id = ${orgId} and id = ${ids.ticketId}`;
  const eventId = ticket?.event_id as string;
  const [n] = await admin`
    select coalesce(max(number), 0) + 1 as n from assistance.requests where org_id = ${orgId} and event_id = ${eventId}`;
  const [req] = await admin`
    insert into assistance.requests
      (org_id, event_id, number, source, reason, priority, note, location, ticket_id, due_at)
    values (${orgId}, ${eventId}, ${n?.n as number}, 'guest', 'medical', 'urgent',
      ${`${person.name} feels dizzy, call ${person.phone}`}, ${`Row 4 next to ${person.lastName}`}, ${ids.ticketId},
      now() + interval '5 minutes')
    returning id`;
  await admin`
    insert into assistance.activity (org_id, request_id, kind, body, actor_user_id)
    values (${orgId}, ${req?.id as string}, 'created', '', null),
      (${orgId}, ${req?.id as string}, 'note', ${`Spoke with ${person.name}`}, ${ownerId})`;
  return ['assistance.requests', 'assistance.activity'];
};
