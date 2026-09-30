import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgSchema,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const reviewsSchema = pgSchema('reviews');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * A ticket holder's review of an event they attended (M1.4g). One per holder per event: the
 * holder is keyed by `author_key` (SHA-256 of the org id and the normalized buyer email), so the
 * email itself is never stored here. `author_display` is "First L." (never the full name).
 * Composite FKs to `events.events` and `orders.orders` (lower tiers) are in the migration.
 */
export const reviews = tenantTable(
  reviewsSchema,
  'reviews',
  {
    eventId: uuid('event_id').notNull(),
    orderId: uuid('order_id').notNull(),
    authorKey: text('author_key').notNull(),
    authorDisplay: text('author_display'),
    rating: smallint('rating').notNull(),
    body: text('body'),
    status: text('status').notNull().default('visible'),
    hiddenReason: text('hidden_reason'),
    moderatedAt: ts('moderated_at'),
    moderatedBy: text('moderated_by'),
  },
  (t) => [
    uniqueIndex('reviews_org_event_author_key').on(t.orgId, t.eventId, t.authorKey),
    index('reviews_org_event_status_created_idx').on(t.orgId, t.eventId, t.status, t.createdAt),
    index('reviews_org_order_idx').on(t.orgId, t.orderId),
    check('reviews_rating_check', sql`rating between 1 and 5`),
    check('reviews_body_check', sql`body is null or char_length(body) between 1 and 1000`),
    check('reviews_status_check', sql`status in ('visible', 'hidden')`),
    check(
      'reviews_hidden_reason_check',
      sql`(status = 'hidden') = (hidden_reason is not null) and (hidden_reason is null or char_length(hidden_reason) <= 300)`,
    ),
  ],
);

/** A visitor's report of a public review; one per reporter (hashed device key) per review. */
export const reviewReports = tenantTable(
  reviewsSchema,
  'review_reports',
  {
    reviewId: uuid('review_id').notNull(),
    reason: text('reason').notNull(),
    note: text('note'),
    reporterKey: text('reporter_key').notNull(),
    status: text('status').notNull().default('open'),
    resolvedAt: ts('resolved_at'),
  },
  (t) => [
    uniqueIndex('review_reports_org_review_reporter_key').on(t.orgId, t.reviewId, t.reporterKey),
    index('review_reports_org_status_idx').on(t.orgId, t.status),
    foreignKey({
      name: 'review_reports_review_fk',
      columns: [t.orgId, t.reviewId],
      foreignColumns: [reviews.orgId, reviews.id],
    }).onDelete('cascade'),
    check(
      'review_reports_reason_check',
      sql`reason in ('spam', 'offensive', 'off_topic', 'personal_info', 'other')`,
    ),
    check('review_reports_status_check', sql`status in ('open', 'dismissed', 'actioned')`),
    check('review_reports_note_check', sql`note is null or char_length(note) <= 500`),
  ],
);
