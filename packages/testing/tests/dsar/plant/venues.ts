import type { Planter } from '../types.ts';

/** venues: a "request a quote" enquiry the person sent about one of the org's venues. */
export const plantVenues: Planter = async ({ admin, orgId, person }) => {
  let [venue] = await admin`select id from venues.venues where org_id = ${orgId} limit 1`;
  if (!venue)
    [venue] = await admin`
      insert into venues.venues (org_id, slug, name, country, timezone)
      values (${orgId}, ${`dsar-${orgId.slice(0, 8)}-${Date.now().toString(36)}`}, 'Canary Hall', 'US', 'America/New_York')
      returning id`;
  await admin`
    insert into venues.quote_requests (org_id, venue_id, name, email, phone, guests, message, client_key)
    values (${orgId}, ${venue?.id as string}, ${person.name}, ${person.email.toUpperCase()}, ${person.phone}, 80,
      ${`Wedding for ${person.name}`}, ${'0'.repeat(64)})`;
  return ['venues.quote_requests'];
};
