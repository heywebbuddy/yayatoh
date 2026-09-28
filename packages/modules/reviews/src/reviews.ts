import { createHash } from 'node:crypto';
import { sanitizeMarkdown } from '@yayatoh/contracts';
import { isUniqueViolation, type TenantTx, withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { actorId, createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { orderHoldingTx } from '@yayatoh/orders';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  type Eligibility,
  REVIEW_BODY_MAX,
  reviewEligibility,
  reviewerDisplayName,
} from './domain/eligibility.ts';
import {
  ModerateInput,
  type MyReviewDto,
  MyReviewDto as MyReviewSchema,
  myReviewSerializer,
  type PublicReviewSummaryDto,
  publicReviewSerializer,
  publicReviewSummarySerializer,
  ReportReviewInput,
  ReviewFilter,
  ReviewListDto,
  reviewListSerializer,
  SubmitReviewInput,
} from './dto.ts';
import { reviewReports, reviews } from './schema.ts';

/** Recent reviews shown on the public event page. */
export const PUBLIC_RECENT_REVIEWS = 5;

/** The holder key: per org, so the same person can't be correlated across organizers. */
export function authorKey(orgId: string, email: string): string {
  return createHash('sha256').update(`${orgId}:${email.trim().toLowerCase()}`).digest('hex');
}

const cleanBody = (body: string | null) => {
  const v = body === null ? '' : sanitizeMarkdown(body, REVIEW_BODY_MAX);
  return v ? v : null;
};

async function ownReviewTx(tx: TenantTx, eventId: string, key: string) {
  const [row] = await tx
    .select()
    .from(reviews)
    .where(and(eq(reviews.eventId, eventId), eq(reviews.authorKey, key)));
  return row ?? null;
}

async function stateTx(tx: TenantTx, orgId: string, token: string, now: Date) {
  const holding = await orderHoldingTx(tx, token);
  if (!holding) return null;
  const ev = await findEventTx(tx, holding.eventId);
  if (!ev) return null;
  const key = authorKey(orgId, holding.buyerEmail);
  const own = await ownReviewTx(tx, holding.eventId, key);
  const eligibility = reviewEligibility({
    now,
    eventStatus: ev.status,
    timeZone: ev.timezone,
    ticketEnds: holding.liveTicketEnds,
    alreadyReviewed: own !== null,
  });
  return { holding, key, own, eligibility };
}

const refusal = (e: Exclude<Eligibility, { ok: true }>) =>
  e.reason === 'already_reviewed'
    ? new DomainError('conflict', 'You have already reviewed this event', { reason: e.reason })
    : new DomainError('invalid_state', 'This order cannot review the event', {
        reason: e.reason,
        opensAt: e.opensAt?.toISOString() ?? null,
      });

/**
 * A buyer reviews the event from their order page (M1.5 manage link). The token is re-verified
 * here under the org's RLS; the eligibility rule decides (`domain/eligibility.ts`); the unique
 * `(org, event, author_key)` index makes "one review per holder" hold under concurrency.
 */
export const submitReviewCommand = tenantCommand({
  name: 'reviews.submitReview',
  input: SubmitReviewInput,
  output: MyReviewSchema,
  entitlement: 'core',
  permission: 'public:review_submit',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const state = await stateTx(tx, orgId, input.manageToken, ctx.now);
    if (!state) throw new DomainError('not_found');
    if (!state.eligibility.ok) throw refusal(state.eligibility);
    try {
      const [row] = await tx.transaction((sp) =>
        sp
          .insert(reviews)
          .values({
            orgId,
            eventId: state.holding.eventId,
            orderId: state.holding.orderId,
            authorKey: state.key,
            authorDisplay: reviewerDisplayName(state.holding.buyerName),
            rating: input.rating,
            body: cleanBody(input.body),
            createdAt: ctx.now,
            updatedAt: ctx.now,
          })
          .returning(),
      );
      if (!row) throw new DomainError('internal');
      emit({
        type: 'review.submitted',
        version: 1,
        aggregateType: 'review',
        aggregateId: row.id,
        payload: { orgId, eventId: row.eventId, reviewId: row.id, rating: row.rating },
      });
      return myReviewSerializer.serialize(row);
    } catch (err) {
      if (isUniqueViolation(err, 'reviews_org_event_author_key'))
        throw refusal({ ok: false, reason: 'already_reviewed', opensAt: null, closesAt: null });
      throw err;
    }
  },
  audit: (input) => ({
    action: 'review.submit',
    targetType: 'review',
    targetId: null,
    data: { rating: input.rating },
  }),
});

/** The review panel of an order page: may this buyer review, and their review if they did. */
export async function reviewStateForOrder(
  orgId: string,
  token: string,
  now = new Date(),
): Promise<{ eligibility: Eligibility; review: MyReviewDto | null } | null> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'reviews.order-page' } });
  return withTenant(ctx, async (tx) => {
    const s = await stateTx(tx, orgId, token, now);
    if (!s) return null;
    return { eligibility: s.eligibility, review: s.own ? myReviewSerializer.serialize(s.own) : null };
  });
}

async function findReview(tx: TenantTx, eventId: string, reviewId: string) {
  const [row] = await tx
    .select()
    .from(reviews)
    .where(and(eq(reviews.id, reviewId), eq(reviews.eventId, eventId)));
  if (!row) throw new DomainError('not_found');
  return row;
}

/** Hide a review from the public (reason required, audited). Its open reports count as handled. */
export const hideReviewCommand = tenantCommand({
  name: 'reviews.hideReview',
  input: ModerateInput,
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const current = await findReview(tx, input.eventId, input.reviewId);
    if (current.status === 'hidden') throw new DomainError('invalid_state', 'Already hidden');
    await tx
      .update(reviews)
      .set({
        status: 'hidden',
        hiddenReason: input.reason,
        moderatedAt: ctx.now,
        moderatedBy: actorId(ctx.actor),
        updatedAt: ctx.now,
      })
      .where(eq(reviews.id, input.reviewId));
    await tx
      .update(reviewReports)
      .set({ status: 'actioned', resolvedAt: ctx.now, updatedAt: ctx.now })
      .where(and(eq(reviewReports.reviewId, input.reviewId), eq(reviewReports.status, 'open')));
    emit({
      type: 'review.hidden',
      version: 1,
      aggregateType: 'review',
      aggregateId: input.reviewId,
      payload: { orgId: current.orgId, eventId: input.eventId, reviewId: input.reviewId },
    });
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'review.hide',
    targetType: 'review',
    targetId: input.reviewId,
    data: { eventId: input.eventId, reason: input.reason },
  }),
});

export const unhideReviewCommand = tenantCommand({
  name: 'reviews.unhideReview',
  input: ModerateInput,
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const current = await findReview(tx, input.eventId, input.reviewId);
    if (current.status !== 'hidden') throw new DomainError('invalid_state', 'Not hidden');
    await tx
      .update(reviews)
      .set({
        status: 'visible',
        hiddenReason: null,
        moderatedAt: ctx.now,
        moderatedBy: actorId(ctx.actor),
        updatedAt: ctx.now,
      })
      .where(eq(reviews.id, input.reviewId));
    emit({
      type: 'review.unhidden',
      version: 1,
      aggregateType: 'review',
      aggregateId: input.reviewId,
      payload: { orgId: current.orgId, eventId: input.eventId, reviewId: input.reviewId },
    });
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'review.unhide',
    targetType: 'review',
    targetId: input.reviewId,
    data: { eventId: input.eventId, reason: input.reason },
  }),
});

/** Keep a reported review up: its open reports are dismissed (audited). */
export const dismissReportsCommand = tenantCommand({
  name: 'reviews.dismissReports',
  input: z.object({ eventId: z.uuid(), reviewId: z.uuid() }),
  output: z.object({ dismissed: z.number().int() }),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await findReview(tx, input.eventId, input.reviewId);
    const rows = await tx
      .update(reviewReports)
      .set({ status: 'dismissed', resolvedAt: ctx.now, updatedAt: ctx.now })
      .where(and(eq(reviewReports.reviewId, input.reviewId), eq(reviewReports.status, 'open')))
      .returning({ id: reviewReports.id });
    return { dismissed: rows.length };
  },
  audit: (input, out) => ({
    action: 'review.reports.dismiss',
    targetType: 'review',
    targetId: input.reviewId,
    data: { eventId: input.eventId, dismissed: out.dismissed },
  }),
});

/**
 * Anyone may report a visible review (rate-limited by the caller). A second report from the same
 * device is a no-op; hidden or unknown reviews answer not_found.
 */
export const reportReviewCommand = tenantCommand({
  name: 'reviews.reportReview',
  input: ReportReviewInput,
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'core',
  permission: 'public:review_report',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const [review] = await tx
      .select({ id: reviews.id, eventId: reviews.eventId })
      .from(reviews)
      .where(and(eq(reviews.id, input.reviewId), eq(reviews.status, 'visible')));
    if (!review) throw new DomainError('not_found');
    const inserted = await tx
      .insert(reviewReports)
      .values({
        orgId,
        reviewId: review.id,
        reason: input.reason,
        note: input.note ? sanitizeMarkdown(input.note, 500) || null : null,
        reporterKey: input.clientKey,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .onConflictDoNothing()
      .returning({ id: reviewReports.id });
    if (inserted.length > 0)
      emit({
        type: 'review.reported',
        version: 1,
        aggregateType: 'review',
        aggregateId: review.id,
        payload: { orgId, eventId: review.eventId, reviewId: review.id, reason: input.reason },
      });
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'review.report',
    targetType: 'review',
    targetId: input.reviewId,
    data: { reason: input.reason },
  }),
});

async function summaryTx(tx: TenantTx, eventId: string) {
  const [agg] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      average: sql<string | null>`round(avg(${reviews.rating}), 1)`,
    })
    .from(reviews)
    .where(and(eq(reviews.eventId, eventId), eq(reviews.status, 'visible')));
  return { count: agg?.count ?? 0, average: agg?.average == null ? null : Number(agg.average) };
}

/** The organizer's moderation list for one event (viewers read it; changes need events:write). */
export const listReviewsQuery = tenantQuery({
  name: 'reviews.listReviews',
  input: z.object({ eventId: z.uuid(), filter: ReviewFilter.default('all') }),
  output: ReviewListDto,
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.eventId, input.eventId),
          input.filter === 'visible' || input.filter === 'hidden'
            ? eq(reviews.status, input.filter)
            : undefined,
        ),
      )
      .orderBy(desc(reviews.createdAt))
      .limit(500);
    const ids = rows.map((r) => r.id);
    const reports =
      ids.length === 0
        ? []
        : await tx
            .select()
            .from(reviewReports)
            .where(inArray(reviewReports.reviewId, ids))
            .orderBy(desc(reviewReports.createdAt));
    const byReview = new Map<string, (typeof reports)[number][]>();
    for (const r of reports) byReview.set(r.reviewId, [...(byReview.get(r.reviewId) ?? []), r]);
    const list = rows
      .map((r) => {
        const rs = byReview.get(r.id) ?? [];
        return {
          id: r.id,
          rating: r.rating,
          body: r.body,
          author: r.authorDisplay,
          status: r.status,
          hiddenReason: r.hiddenReason,
          moderatedAt: r.moderatedAt,
          createdAt: r.createdAt,
          openReports: rs.filter((x) => x.status === 'open').length,
          reports: rs.map((x) => ({
            reason: x.reason,
            note: x.note,
            status: x.status,
            createdAt: x.createdAt,
          })),
        };
      })
      .filter((r) => input.filter !== 'reported' || r.openReports > 0);
    return reviewListSerializer.serialize({ ...(await summaryTx(tx, input.eventId)), reviews: list });
  },
});

/**
 * The public event page's reviews: the aggregate and the latest visible reviews, allowlisted.
 * Read under the event's org (the page resolved it from the slug, never from the request).
 */
export async function publicReviews(orgId: string, eventId: string): Promise<PublicReviewSummaryDto> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'reviews.public' } });
  return withTenant(ctx, async (tx) => {
    const summary = await summaryTx(tx, eventId);
    const recent = await tx
      .select()
      .from(reviews)
      .where(and(eq(reviews.eventId, eventId), eq(reviews.status, 'visible')))
      .orderBy(desc(reviews.createdAt))
      .limit(PUBLIC_RECENT_REVIEWS);
    return publicReviewSummarySerializer.serialize({
      ...summary,
      recent: recent.map((r) =>
        publicReviewSerializer.serialize({
          id: r.id,
          rating: r.rating,
          body: r.body,
          author: r.authorDisplay,
          createdAt: r.createdAt,
        }),
      ),
    });
  });
}
