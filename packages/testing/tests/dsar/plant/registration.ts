import type { Planter } from '../types.ts';

/**
 * registration (M5.1c): the fixture's first registrant becomes the person (with answers and a
 * decision reason), and their address is on a type's member list.
 */
export const plantRegistration: Planter = async ({ admin, orgId, person }) => {
  const [r] = await admin`
    update registration.registrants set name = ${person.name}, email = ${person.email},
      company = ${`${person.lastName} & Co`}, job_title = 'Planner', message = ${`Call ${person.phone}`},
      decision_reason = ${`Welcome ${person.name}`}
    where id = (select id from registration.registrants where org_id = ${orgId} order by created_at limit 1)
    returning registration_type_id, event_id`;
  if (!r) return [];
  await admin`
    insert into registration.type_members (org_id, event_id, registration_type_id, email)
    values (${orgId}, ${r.event_id as string}, ${r.registration_type_id as string}, ${person.email})
    on conflict do nothing`;
  return ['registration.registrants', 'registration.type_members'];
};
