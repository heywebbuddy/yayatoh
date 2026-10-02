import type { Planter } from '../types.ts';

/**
 * marketing: the click attributed to the person's order (the fixture's), and a later click from
 * the same device. Clicks hold only keyed hashes (no text to find): erasure must clear them.
 */
export const plantMarketing: Planter = async ({ admin, orgId, ids }) => {
  if (!ids.orderId) throw new Error('plantMarketing: run plantOrders first');
  const [a] = await admin`
    select a.last_click_id, c.link_id, c.event_id, c.device_hash
    from marketing.attributions a
    join marketing.link_clicks c on c.org_id = a.org_id and c.id = a.last_click_id
    where a.org_id = ${orgId} and a.order_id = ${ids.orderId}`;
  if (!a) return [];
  ids.linkClickId = a.last_click_id as string;
  if (a.device_hash)
    await admin`
      insert into marketing.link_clicks (org_id, link_id, event_id, clicked_at, device_hash, ip_hash)
      values (${orgId}, ${a.link_id as string}, ${a.event_id as string}, now(), ${a.device_hash as string},
        ${'0123456789abcdef0123456789abcdef'})`;
  return ['marketing.link_clicks'];
};
