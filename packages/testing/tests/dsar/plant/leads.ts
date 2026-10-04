import type { Planter } from '../types.ts';

/**
 * leads (M5.6b, batch 3k merge): an exhibitor of the org captured the person's ticket, with their
 * name, company and shared address stamped, and a note about them. The fixture's own lead may
 * already be that ticket at that exhibitor (batch 3l merge): it then carries the person's data.
 */
export const plantLeads: Planter = async ({ admin, orgId, ownerId, person, ids }) => {
  if (!ids.ticketId) throw new Error('plantLeads: run plantTicketing first');
  const [x] = await admin`
    select id, event_id from program.exhibitors where org_id = ${orgId} order by created_at limit 1`;
  if (!x) return [];
  await admin`
    insert into leads.leads (org_id, event_id, exhibitor_id, ticket_id, captured_by, captured_at, last_scanned_at,
      name, job_title, company, email, shared_fields, email_consent_version, notes)
    values (${orgId}, ${x.event_id as string}, ${x.id as string}, ${ids.ticketId}, ${ownerId}, now(), now(),
      ${person.name}, 'Buyer', ${`${person.lastName} Holdings`}, ${person.email},
      array['name', 'job_title', 'company', 'email'], 1, ${`Call ${person.phone}`})
    on conflict (org_id, exhibitor_id, ticket_id) do update set
      name = excluded.name, job_title = excluded.job_title, company = excluded.company,
      email = excluded.email, shared_fields = excluded.shared_fields, notes = excluded.notes`;
  return ['leads.leads'];
};
