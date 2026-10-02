import type { Planter } from '../types.ts';

/** seating: a seat-finder code requested for the person's address. */
export const plantSeating: Planter = async ({ admin, orgId, eventId, person }) => {
  await admin`
    insert into seating.finder_codes (org_id, event_id, email_hash, email, code_hash, expires_at)
    values (${orgId}, ${eventId}, 'dsar-planted-hash', ${person.email}, 'dsar-planted-code', now() + interval '10 minutes')`;
  return ['seating.finder_codes'];
};
