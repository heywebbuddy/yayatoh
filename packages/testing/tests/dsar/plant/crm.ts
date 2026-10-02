import type { Planter } from '../types.ts';

/** crm: a contact with name and phone, a consent with free-text evidence, and its projections. */
export const plantCrm: Planter = async ({ admin, orgId, eventId, person, ids }) => {
  const [c] = await admin`
    insert into crm.contacts (org_id, email, email_norm, name, phone_e164, company, source)
    values (${orgId}, ${person.email.toUpperCase()}, ${person.email}, ${person.name}, ${person.phone},
      ${`${person.lastName} Studio`}, 'manual')
    returning id`;
  ids.contactId = c?.id as string;
  await admin`
    insert into crm.consents (org_id, contact_id, channel, purpose, status, evidence, captured_at)
    values (${orgId}, ${ids.contactId}, 'email', 'marketing', 'granted', ${`checkout form, ${person.name}`}, now())`;
  await admin`
    insert into crm.event_participation (org_id, contact_id, event_id, registered_at, currency, source, labels)
    values (${orgId}, ${ids.contactId}, ${eventId}, now(), 'USD', 'live', ${[`vip ${person.lastName}`]})`;
  await admin`
    insert into crm.contact_profile (org_id, contact_id, labels)
    values (${orgId}, ${ids.contactId}, ${[`vip ${person.lastName}`]})`;
  await admin`
    insert into crm.contact_stats (org_id, contact_id, currency, first_seen_at, last_seen_at, source)
    values (${orgId}, ${ids.contactId}, 'USD', now(), now(), 'live')`;
  return ['crm.contacts', 'crm.consents', 'crm.event_participation', 'crm.contact_profile'];
};
