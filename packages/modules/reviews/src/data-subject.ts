import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  DELETE,
  defineDataSubjectContributor,
  refsOf,
  type SubjectErasure,
} from '@yayatoh/platform';
import { asc, eq, inArray, or } from 'drizzle-orm';
import { authorKey } from './reviews.ts';
import { reviewReports, reviews } from './schema.ts';

/** The person's reviews: keyed by their address (the author key), or on an order they placed. */
async function ownReviewIdsTx(tx: TenantTx, s: DataSubject): Promise<string[]> {
  const orders = refsOf(s, 'order');
  const rows = await tx
    .select({ id: reviews.id })
    .from(reviews)
    .where(
      or(
        eq(reviews.authorKey, authorKey(s.orgId, s.email)),
        orders.length ? inArray(reviews.orderId, orders) : undefined,
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * reviews' part of a data-subject request (M6.1c). The person's reviews (name, rating and text)
 * are deleted, and with them the visitors' reports on those reviews (staff moderation notes about
 * the review).
 */
export const reviewsDataSubjects = defineDataSubjectContributor({
  module: 'reviews',
  tables: {
    'reviews.reviews': DELETE,
    'reviews.review_reports': DELETE,
  },
  async export(tx, s) {
    const ids = await ownReviewIdsTx(tx, s);
    const rows = ids.length
      ? await tx.select().from(reviews).where(inArray(reviews.id, ids)).orderBy(asc(reviews.createdAt))
      : [];
    return {
      sections: {
        reviews: rows.map((r) => ({
          eventId: r.eventId,
          orderId: r.orderId,
          displayName: r.authorDisplay,
          rating: r.rating,
          body: r.body,
          status: r.status,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      },
    };
  },
  async erase(tx, s): Promise<SubjectErasure> {
    const ids = await ownReviewIdsTx(tx, s);
    if (ids.length === 0) return { erased: {} };
    const reports = await tx
      .delete(reviewReports)
      .where(inArray(reviewReports.reviewId, ids))
      .returning({ id: reviewReports.id });
    const gone = await tx.delete(reviews).where(inArray(reviews.id, ids)).returning({ id: reviews.id });
    return { erased: { 'reviews.reviews': gone.length, 'reviews.review_reports': reports.length } };
  },
});
