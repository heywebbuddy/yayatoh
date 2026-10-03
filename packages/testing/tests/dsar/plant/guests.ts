import type { Planter } from '../types.ts';

/**
 * guests: a party for the person's household (their name in the party and envelope names, the
 * host's notes with their phone) with the person as its primary guest, linked to their contact.
 */
export const plantGuests: Planter = async ({ admin, orgId, eventId, person, ids }) => {
  if (!ids.contactId) throw new Error('plantGuests: the crm planter runs first (ids.contactId)');
  const [party] = await admin`
    insert into guests.parties (org_id, event_id, name, envelope_name, side, tags, notes, source)
    values (${orgId}, ${eventId}, ${`The ${person.lastName}s`}, ${`Ms. ${person.name}`}, 'Bride',
      ${['family', `${person.lastName} side`]}, ${`Call ${person.phone} about the shuttle`}, 'manual')
    returning id`;
  await admin`
    insert into guests.guests (org_id, event_id, party_id, kind, first_name, last_name, meal, contact_id, is_primary)
    values (${orgId}, ${eventId}, ${party?.id as string}, 'guest', ${person.firstName}, ${person.lastName}, 'Vegan',
      ${ids.contactId}, true)`;
  // A fixture guest already linked to the attendee record the person took over is them too.
  if (ids.attendeeId)
    await admin`
      update guests.guests set first_name = ${person.firstName}, last_name = ${person.lastName}
      where org_id = ${orgId} and attendee_id = ${ids.attendeeId}`;
  return ['guests.parties', 'guests.guests'];
};
