import { defineSerializer } from '@yayatoh/contracts';
import { z } from 'zod';
import { REPORT_REASONS, REPORT_STATUSES, REVIEW_FILTERS, REVIEW_STATUSES } from './domain/constants.ts';
import { REVIEW_BODY_MAX } from './domain/eligibility.ts';

const optBody = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => (v?.trim() ? v : null));

export const SubmitReviewInput = z.object({
  /** The buyer's manage link token (their proof of holding a ticket). */
  manageToken: z.string().min(40).max(60),
  rating: z.number().int().min(1).max(5),
  body: optBody(REVIEW_BODY_MAX),
});
export type SubmitReviewInput = z.input<typeof SubmitReviewInput>;

/** The buyer's own review, on their order page. */
export const MyReviewDto = z.object({
  rating: z.number().int(),
  body: z.string().nullable(),
  status: z.enum(REVIEW_STATUSES),
  createdAt: z.date(),
});
export type MyReviewDto = z.infer<typeof MyReviewDto>;
export const myReviewSerializer = defineSerializer('reviews.myReview', MyReviewDto);

/**
 * A review as the public sees it: rating, text, "First L." and the date. No email, no order, no
 * full name. The id is only used to report it.
 */
export const PublicReviewDto = z.object({
  id: z.uuid(),
  rating: z.number().int(),
  body: z.string().nullable(),
  author: z.string().nullable(),
  createdAt: z.date(),
});
export type PublicReviewDto = z.infer<typeof PublicReviewDto>;
export const publicReviewSerializer = defineSerializer('reviews.publicReview', PublicReviewDto);

export const PublicReviewSummaryDto = z.object({
  count: z.number().int(),
  /** Mean rating to one decimal, null without reviews. */
  average: z.number().nullable(),
  recent: z.array(PublicReviewDto),
});
export type PublicReviewSummaryDto = z.infer<typeof PublicReviewSummaryDto>;
export const publicReviewSummarySerializer = defineSerializer(
  'reviews.publicSummary',
  PublicReviewSummaryDto,
);

export const ReportDto = z.object({
  reason: z.enum(REPORT_REASONS),
  note: z.string().nullable(),
  status: z.enum(REPORT_STATUSES),
  createdAt: z.date(),
});

/** A review in the organizer's moderation list (no buyer email: it is never stored). */
export const ModerationReviewDto = z.object({
  id: z.uuid(),
  rating: z.number().int(),
  body: z.string().nullable(),
  author: z.string().nullable(),
  status: z.enum(REVIEW_STATUSES),
  hiddenReason: z.string().nullable(),
  moderatedAt: z.date().nullable(),
  createdAt: z.date(),
  openReports: z.number().int(),
  reports: z.array(ReportDto),
});
export type ModerationReviewDto = z.infer<typeof ModerationReviewDto>;

export const ReviewListDto = z.object({
  count: z.number().int(),
  average: z.number().nullable(),
  reviews: z.array(ModerationReviewDto),
});
export type ReviewListDto = z.infer<typeof ReviewListDto>;
export const reviewListSerializer = defineSerializer('reviews.list', ReviewListDto);

export const ReviewFilter = z.enum(REVIEW_FILTERS);

export const ModerateInput = z.object({
  eventId: z.uuid(),
  reviewId: z.uuid(),
  reason: z.string().trim().min(3).max(300),
});

export const ReportReviewInput = z.object({
  reviewId: z.uuid(),
  reason: z.enum(REPORT_REASONS),
  note: optBody(500),
  /** Opaque, already hashed by the caller (a device key, never an IP address). */
  clientKey: z.string().min(16).max(128),
});
export type ReportReviewInput = z.input<typeof ReportReviewInput>;
