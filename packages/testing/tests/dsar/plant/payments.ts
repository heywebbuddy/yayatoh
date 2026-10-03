import type { Planter } from '../types.ts';

/** payments: a dispute on the person's order whose evidence statement names them. */
export const plantPayments: Planter = async ({ admin, orgId, eventId, person, ids }) => {
  if (!ids.orderId) throw new Error('plantPayments: run plantOrders first');
  const summary = `Buyer ${person.name} (${person.email}, ${person.phone}) attended.`;
  const updated = await admin`
    update payments.disputes set evidence_summary = ${summary}
    where org_id = ${orgId} and order_id = ${ids.orderId}
    returning id`;
  if (updated.length === 0)
    await admin`
      insert into payments.disputes (org_id, order_id, event_id, funds_flow, provider, provider_dispute_id,
        reason, amount_minor, currency, evidence_summary)
      values (${orgId}, ${ids.orderId}, ${eventId}, 'platform_mor', 'fake', ${`fakedp_dsar_${person.lastName}`},
        'fraudulent', 1000, 'USD', ${summary})`;
  return ['payments.disputes'];
};
