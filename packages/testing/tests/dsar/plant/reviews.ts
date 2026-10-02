import { authorKey } from '@yayatoh/reviews';
import type { Planter } from '../types.ts';

/**
 * reviews: the person's review of the event they bought for (the fixture's review on that order
 * becomes theirs, else one is added), with a visitor's report on it.
 */
export const plantReviews: Planter = async ({ admin, orgId, person, ids }) => {
  if (!ids.orderId) throw new Error('plantReviews: run plantOrders first');
  const key = authorKey(orgId, person.email);
  const display = `${person.firstName} ${person.lastName.slice(0, 1)}.`;
  const body = `Loved it. ${person.name}, ${person.phone}`;
  let [r] = await admin`
    update reviews.reviews set author_key = ${key}, author_display = ${display}, body = ${body}
    where org_id = ${orgId} and order_id = ${ids.orderId}
    returning id`;
  if (!r)
    [r] = await admin`
      insert into reviews.reviews (org_id, event_id, order_id, author_key, author_display, rating, body)
      select ${orgId}, o.event_id, o.id, ${key}, ${display}, 5, ${body}
      from orders.orders o where o.org_id = ${orgId} and o.id = ${ids.orderId}
      returning id`;
  if (!r) throw new Error('plantReviews: no review planted');
  ids.reviewId = r.id as string;
  await admin`
    insert into reviews.review_reports (org_id, review_id, reason, note, reporter_key)
    values (${orgId}, ${ids.reviewId}, 'personal_info', ${`Names ${person.lastName}`}, ${`dsar-${person.lastName}`.slice(0, 64)})
    on conflict do nothing`;
  return ['reviews.reviews', 'reviews.review_reports'];
};
