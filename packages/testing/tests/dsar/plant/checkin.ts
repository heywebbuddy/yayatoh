import type { Planter } from '../types.ts';

/** checkin: a dismissed checkout-risk signal about the person's order with a triage note naming them. */
export const plantCheckin: Planter = async ({ admin, orgId, eventId, person, ids }) => {
  if (!ids.orderId) throw new Error('plantCheckin: run plantOrders first');
  await admin`
    insert into checkin.fraud_signals (org_id, event_id, kind, raised_at, severity, status, resolved_at, source,
      order_id, contact_id, ticket_id, resolution_note)
    values (${orgId}, ${eventId}, 'purchase_velocity', now(), 'high', 'dismissed', now(), 'checkout',
      ${ids.orderId}, ${ids.contactId ?? null}, ${ids.ticketId ?? null}, ${`Called ${person.name} on ${person.phone}: legit`})`;
  return ['checkin.fraud_signals'];
};
