import type { Planter } from '../types.ts';

/** attendees: the attendee row of the person's ticket becomes theirs, plus a staged import row. */
export const plantAttendees: Planter = async ({ admin, orgId, eventId, person, ids }) => {
  if (!ids.ticketId) throw new Error('plantAttendees: run plantTicketing first');
  const [t] = await admin`
    select attendee_id, event_id from ticketing.tickets where org_id = ${orgId} and id = ${ids.ticketId}`;
  if (t?.attendee_id) {
    await admin`
      update attendees.attendees
      set name = ${person.name}, email = ${person.email}, labels = ${[`vip ${person.lastName}`]},
          contact_id = coalesce(${ids.contactId ?? null}::uuid, contact_id)
      where org_id = ${orgId} and id = ${t.attendee_id as string}`;
    ids.attendeeId = t.attendee_id as string;
  } else {
    if (!ids.contactId) throw new Error('plantAttendees: run plantCrm first');
    const [a] = await admin`
      insert into attendees.attendees (org_id, event_id, contact_id, source, ticket_id, name, email, labels)
      values (${orgId}, ${(t?.event_id as string) ?? eventId}, ${ids.contactId}, 'ticket', ${ids.ticketId},
        ${person.name}, ${person.email}, ${[`vip ${person.lastName}`]})
      returning id`;
    ids.attendeeId = a?.id as string;
  }
  const [batch] = await admin`select id from attendees.import_batches where org_id = ${orgId} limit 1`;
  if (batch) {
    const [n] = await admin`
      select coalesce(max(row_no), 0) + 1 as n from attendees.import_rows where org_id = ${orgId} and batch_id = ${batch.id as string}`;
    await admin`
      insert into attendees.import_rows (org_id, batch_id, row_no, cells, attendee_id)
      values (${orgId}, ${batch.id as string}, ${n?.n as number}, ${[person.name, person.email, person.phone]}, ${ids.attendeeId})`;
  }
  return ['attendees.attendees', ...(batch ? ['attendees.import_rows'] : [])];
};
