import { tenantTable } from '@yayatoh/db';
import { type SQL, sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import {
  MATCH_CAP_MAX_MINOR,
  MATCH_CAP_MIN_MINOR,
  MATCH_RATIO_MAX,
  MATCH_RATIO_MIN,
  MATCH_STATUSES,
} from './domain/matches.ts';
import { campaigns, donationsSchema, gifts } from './schema.ts';

/**
 * M4.8f matching gifts. `(org_id, event_id)` references `events.events` and `(org_id, refund_id)`
 * references `orders.refunds` (lower tiers) through hand-written foreign keys in the migration.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const minor = (name: string) => bigint(name, { mode: 'number' });
const inList = (column: string, values: readonly string[]): SQL =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`);

/**
 * A challenge match (P4-17): a sponsor matches a campaign's confirmed gifts made in a window, at a
 * ratio (`ratio_percent`: 100 is 1:1), up to a cap, in the campaign's currency. What it comes to is
 * computed from the gifts, never stored while it runs; closing it records the sponsor's own pledge
 * (`donations.pledges`, source `match`) for what it came to then (`matched_minor`). The sponsor's
 * name and email are for the host; `public_name` is how the sponsor appears on screens and the
 * giving page (none: "a generous sponsor").
 */
export const matches = tenantTable(
  donationsSchema,
  'matches',
  {
    eventId: uuid('event_id').notNull(),
    campaignId: uuid('campaign_id').notNull(),
    sponsorName: text('sponsor_name').notNull(),
    sponsorEmail: text('sponsor_email'),
    publicName: text('public_name'),
    ratioPercent: integer('ratio_percent').notNull(),
    capMinor: minor('cap_minor').notNull(),
    currency: text('currency').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    status: text('status').notNull().default('active'),
    /** What the match came to when it closed (the sponsor's pledge as first recorded). */
    matchedMinor: minor('matched_minor'),
    closedAt: ts('closed_at'),
    cancelledAt: ts('cancelled_at'),
  },
  (t) => [
    index('matches_org_campaign_status_idx').on(t.orgId, t.campaignId, t.status),
    index('matches_org_event_starts_idx').on(t.orgId, t.eventId, t.startsAt),
    foreignKey({
      name: 'matches_campaign_fk',
      columns: [t.orgId, t.campaignId],
      foreignColumns: [campaigns.orgId, campaigns.id],
    }),
    check('matches_status_check', inList('status', MATCH_STATUSES)),
    check('matches_sponsor_name_length', sql`length(sponsor_name) between 1 and 120`),
    check(
      'matches_sponsor_email_check',
      sql`sponsor_email is null or (sponsor_email = lower(sponsor_email) and length(sponsor_email) between 3 and 254)`,
    ),
    check('matches_public_name_length', sql`public_name is null or length(public_name) between 1 and 120`),
    check(
      'matches_ratio_check',
      sql.raw(`ratio_percent between ${MATCH_RATIO_MIN} and ${MATCH_RATIO_MAX}`),
    ),
    check(
      'matches_cap_check',
      sql.raw(`cap_minor between ${MATCH_CAP_MIN_MINOR} and ${MATCH_CAP_MAX_MINOR}`),
    ),
    check('matches_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('matches_window_check', sql`ends_at > starts_at`),
    check(
      'matches_closed_check',
      sql`(status = 'closed') = (closed_at is not null) and (status = 'closed') = (matched_minor is not null)`,
    ),
    check('matches_cancelled_check', sql`(status = 'cancelled') = (cancelled_at is not null)`),
    check('matches_matched_check', sql`matched_minor is null or matched_minor between 0 and cap_minor`),
  ],
);

/**
 * A refund of a gift's order (M4.8f), recorded from `order.refunded@1`: one row per provider
 * refund (unique, so a replayed event counts once). A refunded gift counts less toward matches.
 */
export const giftRefunds = tenantTable(
  donationsSchema,
  'gift_refunds',
  {
    giftId: uuid('gift_id').notNull(),
    refundId: uuid('refund_id').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    currency: text('currency').notNull(),
    refundedAt: ts('refunded_at').notNull(),
  },
  (t) => [
    uniqueIndex('gift_refunds_org_refund_key').on(t.orgId, t.refundId),
    index('gift_refunds_org_gift_idx').on(t.orgId, t.giftId),
    foreignKey({
      name: 'gift_refunds_gift_fk',
      columns: [t.orgId, t.giftId],
      foreignColumns: [gifts.orgId, gifts.id],
    }).onDelete('cascade'),
    check('gift_refunds_amount_check', sql`amount_minor > 0`),
    check('gift_refunds_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
  ],
);
