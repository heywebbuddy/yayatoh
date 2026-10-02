import type { Planter } from '../types.ts';

/** cms: a contact request the person sent from the marketplace contact page. */
export const plantCms: Planter = async ({ admin, orgId, person }) => {
  await admin`
    insert into cms.contact_requests (org_id, topic, name, email, company, message)
    values (${orgId}, 'sales', ${person.name}, ${` ${person.email.toUpperCase()} `}, ${`${person.lastName} Ltd`},
      ${`Please call ${person.phone}`})`;
  return ['cms.contact_requests'];
};
