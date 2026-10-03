import type { Planter } from '../types.ts';

/** badges: a running batch printing the person's ticket, with a rendered part (their name). */
export const plantBadges: Planter = async ({ admin, orgId, eventId, person, ids }) => {
  if (!ids.ticketId) throw new Error('plantBadges: run plantTicketing first');
  const [b] = await admin`
    insert into badges.batches (org_id, event_id, request_key, status, sort, locale, ticket_ids, version_map,
      total, processed, expires_at)
    values (${orgId}, ${eventId}, ${`dsar-badges-${orgId}`.slice(0, 80)}, 'running', 'last_name', 'en',
      array[${ids.ticketId}::uuid], ${admin.json({ byType: {}, fallback: null })}, 1, 1, now() + interval '7 days')
    returning id`;
  ids.badgeBatchId = b?.id as string;
  await admin`
    insert into badges.batch_parts (org_id, batch_id, seq, badges, pdf)
    values (${orgId}, ${ids.badgeBatchId}, 0, 1, ${Buffer.from(`%PDF ${person.name}`)})`;
  return ['badges.batches', 'badges.batch_parts'];
};
