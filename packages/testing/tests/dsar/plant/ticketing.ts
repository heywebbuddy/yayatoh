import type { Planter } from '../types.ts';

/**
 * ticketing (runs right after orders): a ticket of the person's order becomes theirs as holder,
 * with a claim they received and claimed, a pending transfer to them, a cancelled one from them,
 * a wallet pass under their name and a holder magic link.
 */
export const plantTicketing: Planter = async ({ admin, orgId, person, ids }) => {
  if (!ids.orderId) throw new Error('plantTicketing: run plantOrders first');
  const [t] = await admin`
    update ticketing.tickets set holder_name = ${person.name}, holder_email = ${`  ${person.email.toUpperCase()}`}
    where id = (select id from ticketing.tickets where org_id = ${orgId} and order_id = ${ids.orderId} order by serial limit 1)
      and org_id = ${orgId}
    returning id, event_id, order_id`;
  if (!t) throw new Error('plantTicketing: the order has no ticket');
  ids.ticketId = t.id as string;
  const other = `former.holder@${orgId.slice(0, 8)}.test`;
  // The fixture keeps an open claim link on this ticket (one open link per ticket): the planted
  // links are claimed or revoked; the pending transfer to the person is what erasure cancels.
  await admin`
    insert into ticketing.ticket_claims (org_id, ticket_id, recipient_email, expires_at, claimed_at, claimed_by_email, created_by)
    values (${orgId}, ${ids.ticketId}, ${person.email}, now() + interval '7 days', now(), ${person.email}, 'fixture')`;
  const [incoming] = await admin`
    insert into ticketing.ticket_claims (org_id, ticket_id, recipient_email, expires_at, revoked_at, created_by)
    values (${orgId}, ${ids.ticketId}, ${person.email}, now() + interval '7 days', now(), 'holder')
    returning id`;
  await admin`
    insert into ticketing.ticket_transfers (org_id, ticket_id, event_id, order_id, claim_id, status, initiated_by,
      from_name, from_email, to_name, to_email, currency, created_by, from_rev)
    values (${orgId}, ${ids.ticketId}, ${t.event_id as string}, ${t.order_id as string}, ${incoming?.id as string}, 'pending', 'holder',
      'Former Holder', ${other}, ${person.name}, ${person.email}, 'USD', 'holder', 0)`;
  const [outgoing] = await admin`
    insert into ticketing.ticket_claims (org_id, ticket_id, recipient_email, expires_at, revoked_at, created_by)
    values (${orgId}, ${ids.ticketId}, ${other}, now() + interval '7 days', now(), 'holder')
    returning id`;
  await admin`
    insert into ticketing.ticket_transfers (org_id, ticket_id, event_id, order_id, claim_id, status, initiated_by,
      from_name, from_email, to_name, to_email, currency, created_by, from_rev, cancelled_at)
    values (${orgId}, ${ids.ticketId}, ${t.event_id as string}, ${t.order_id as string}, ${outgoing?.id as string}, 'cancelled', 'holder',
      ${person.name}, ${person.email}, 'Former Holder', ${other}, 'USD', 'holder', 0, now())`;
  await admin`
    insert into ticketing.wallet_passes (org_id, ticket_id, rev, serial, holder_name, status, voided_at)
    values (${orgId}, ${ids.ticketId}, 997, ${`yy-${ids.ticketId}-997`}, ${person.name}, 'voided', now())`;
  await admin`
    insert into ticketing.holder_links (org_id, event_id, email_norm, expires_at)
    values (${orgId}, ${t.event_id as string}, ${person.email}, now() + interval '7 days')`;
  return [
    'ticketing.tickets',
    'ticketing.ticket_claims',
    'ticketing.ticket_transfers',
    'ticketing.wallet_passes',
    'ticketing.holder_links',
  ];
};
