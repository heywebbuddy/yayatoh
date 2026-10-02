import type { Planter } from '../types.ts';

/**
 * orders: the fixture's first paid order becomes the person's (legal hold), with a credit note,
 * a refund request, a support reply, a staff note and a waitlist place.
 */
export const plantOrders: Planter = async ({ admin, orgId, eventId, ownerId, person, ids }) => {
  const [o] = await admin`
    update orders.orders set buyer_email = ${person.email}, buyer_name = ${person.name}
    where id = (select id from orders.orders where org_id = ${orgId} and status = 'paid' order by created_at limit 1)
    returning id`;
  if (!o) throw new Error('plantOrders: the fixture has no paid order');
  ids.orderId = o.id as string;
  const [n] = await admin`
    select coalesce(max(number), 0) + 1 as n from orders.credit_notes where org_id = ${orgId}`;
  await admin`
    insert into orders.credit_notes (org_id, order_id, event_id, number, kind, disposition, reason,
      amount_minor, balance_minor, currency, buyer_name, buyer_email, issued_by)
    values (${orgId}, ${ids.orderId}, ${eventId}, ${n?.n as number}, 'partial', 'refunded', 'Late start',
      500, 0, 'USD', ${person.name}, ${person.email}, ${`user:${ownerId}`})`;
  await admin`
    insert into orders.refund_requests (org_id, order_id, event_id, message, due_at)
    values (${orgId}, ${ids.orderId}, ${eventId}, ${`Please refund ${person.name}, call ${person.phone}`}, now() + interval '3 days')
    on conflict do nothing`;
  // The fixture may already have an open request on that order: it gets the person's message too.
  await admin`
    update orders.refund_requests set message = ${`Please refund ${person.name}, call ${person.phone}`}
    where org_id = ${orgId} and order_id = ${ids.orderId}`;
  await admin`
    insert into orders.order_notes (org_id, order_id, body, author_id)
    values (${orgId}, ${ids.orderId}, ${`${person.name} called about parking`}, ${ownerId})`;
  const [macro] = await admin`select id from orders.support_macros where org_id = ${orgId} limit 1`;
  if (macro)
    await admin`
      insert into orders.support_macro_runs (org_id, macro_id, order_id, macro_name, actions, reply_subject, reply_body, ran_by)
      values (${orgId}, ${macro.id as string}, ${ids.orderId}, 'Parking', ${['email_buyer']}, ${`Hi ${person.firstName}`},
        ${`Dear ${person.name}, parking is free.`}, ${`user:${ownerId}`})`;
  const [line] = await admin`select id, ticket_type_id from orders.waitlists where org_id = ${orgId} limit 1`;
  if (line)
    await admin`
      insert into orders.waitlist_entries (org_id, waitlist_id, event_id, ticket_type_id, name, email, locale, quantity, position_at)
      values (${orgId}, ${line.id as string}, ${eventId}, ${line.ticket_type_id as string}, ${person.name}, ${person.email}, 'en', 1, now())`;
  return [
    'orders.orders',
    'orders.credit_notes',
    'orders.refund_requests',
    'orders.order_notes',
    ...(macro ? ['orders.support_macro_runs'] : []),
    ...(line ? ['orders.waitlist_entries'] : []),
  ];
};
