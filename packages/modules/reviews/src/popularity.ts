import type { TenantTx } from '@yayatoh/db';
import { count, eq } from 'drizzle-orm';
import { reviews } from './schema.ts';

/**
 * M6.14a: how many of the org's reviews are visible on its public event pages (a public number:
 * the marketplace's popularity signal). Read in the org's tenant transaction.
 */
export async function visibleReviewCountTx(tx: TenantTx): Promise<number> {
  const [row] = await tx.select({ n: count() }).from(reviews).where(eq(reviews.status, 'visible'));
  return row?.n ?? 0;
}

/** Review events that change the visible count (the marketplace projector follows them). */
export const REVIEW_VISIBILITY_EVENTS = [
  'review.submitted@1',
  'review.hidden@1',
  'review.unhidden@1',
] as const;
