import { tenantTable } from '@yayatoh/db';
import { type SQL, sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  CAMPAIGN_STATUSES,
  DISPLAY_AS,
  GIFT_SOURCES,
  GIFT_STATUSES,
  TRIBUTE_KINDS,
} from './domain/giving.ts';

export const donationsSchema = pgSchema('donations');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const minor = (name: string) => bigint(name, { mode: 'number' });
const inList = (column: string, values: readonly string[]): SQL =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`);

/**
 * A fundraising campaign of one event (M4.8a): a goal in the event's currency (integer minor
 * units) and the own-amount limits of its giving page. `(org_id, event_id)` references
 * `events.events` (a lower tier) through a hand-written foreign key.
 */
export const campaigns = tenantTable(
  donationsSchema,
  'campaigns',
  {
    eventId: uuid('event_id').notNull(),
    name: text('name').notNull(),
    /** Shown on the giving page. */
    description: text('description'),
    goalMinor: minor('goal_minor').notNull(),
    currency: text('currency').notNull(),
    minGiftMinor: minor('min_gift_minor').notNull(),
    maxGiftMinor: minor('max_gift_minor').notNull(),
    status: text('status').notNull().default('open'),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    index('campaigns_org_event_idx').on(t.orgId, t.eventId, t.position),
    uniqueIndex('campaigns_org_event_name_key').on(t.orgId, t.eventId, t.name),
    check('campaigns_name_length', sql`length(name) between 1 and 120`),
    check('campaigns_description_length', sql`description is null or length(description) <= 2000`),
    check('campaigns_goal_check', sql`goal_minor > 0`),
    check('campaigns_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('campaigns_limits_check', sql`min_gift_minor > 0 and max_gift_minor >= min_gift_minor`),
    check('campaigns_status_check', inList('status', CAMPAIGN_STATUSES)),
  ],
);

/** A giving level of a campaign: "$1,000 funds a classroom". */
export const levels = tenantTable(
  donationsSchema,
  'levels',
  {
    campaignId: uuid('campaign_id').notNull(),
    name: text('name').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    description: text('description'),
  },
  (t) => [
    index('levels_org_campaign_idx').on(t.orgId, t.campaignId, t.amountMinor),
    uniqueIndex('levels_org_campaign_amount_key').on(t.orgId, t.campaignId, t.amountMinor),
    foreignKey({
      name: 'levels_campaign_fk',
      columns: [t.orgId, t.campaignId],
      foreignColumns: [campaigns.orgId, campaigns.id],
    }).onDelete('cascade'),
    check('levels_name_length', sql`length(name) between 1 and 80`),
    check('levels_description_length', sql`description is null or length(description) <= 200`),
    check('levels_amount_check', sql`amount_minor > 0`),
  ],
);

/**
 * A gift (M4.8a). Paid as an order with a donation item (`orders.donation_items`) charged on the
 * connected account; `status` follows the order through the outbox (`donations.gift-outcomes`).
 * The donor's name, email, employer and tribute are personal; amounts are numbers that only
 * reach the host's own views and exports (the public page shows campaign totals, P4-13).
 * `(org_id, event_id)` and `(org_id, order_id)` reference `events.events` and `orders.orders`
 * (lower tiers) through hand-written foreign keys, and so does `(org_id, level_id)` (hand-written:
 * removing a level clears only `level_id`, which drizzle cannot express).
 */
export const gifts = tenantTable(
  donationsSchema,
  'gifts',
  {
    eventId: uuid('event_id').notNull(),
    campaignId: uuid('campaign_id').notNull(),
    levelId: uuid('level_id'),
    orderId: uuid('order_id').notNull(),
    status: text('status').notNull().default('pending'),
    source: text('source').notNull().default('online'),
    amountMinor: minor('amount_minor').notNull(),
    feeCoverMinor: minor('fee_cover_minor').notNull().default(0),
    currency: text('currency').notNull(),
    donorName: text('donor_name').notNull(),
    donorEmail: text('donor_email').notNull(),
    displayAs: text('display_as').notNull(),
    employer: text('employer'),
    tributeKind: text('tribute_kind'),
    tributeName: text('tribute_name'),
    tributeRecipient: text('tribute_recipient'),
    tributeNote: text('tribute_note'),
    locale: text('locale').notNull().default('en'),
    paidAt: ts('paid_at'),
  },
  (t) => [
    index('gifts_org_campaign_status_idx').on(t.orgId, t.campaignId, t.status),
    index('gifts_org_event_created_idx').on(t.orgId, t.eventId, t.createdAt),
    uniqueIndex('gifts_org_order_key').on(t.orgId, t.orderId),
    foreignKey({
      name: 'gifts_campaign_fk',
      columns: [t.orgId, t.campaignId],
      foreignColumns: [campaigns.orgId, campaigns.id],
    }),
    check('gifts_status_check', inList('status', GIFT_STATUSES)),
    check('gifts_source_check', inList('source', GIFT_SOURCES)),
    check('gifts_display_as_check', inList('display_as', DISPLAY_AS)),
    check('gifts_amount_check', sql`amount_minor > 0 and fee_cover_minor >= 0`),
    check('gifts_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('gifts_paid_check', sql`(status = 'paid') = (paid_at is not null)`),
    check('gifts_donor_name_length', sql`length(donor_name) between 1 and 120`),
    check('gifts_donor_email_check', sql`donor_email = lower(donor_email) and length(donor_email) <= 254`),
    check('gifts_employer_length', sql`employer is null or length(employer) between 1 and 120`),
    check(
      'gifts_tribute_check',
      sql`(tribute_kind is null and tribute_name is null and tribute_recipient is null and tribute_note is null) or (tribute_kind is not null and tribute_name is not null)`,
    ),
    check(
      'gifts_tribute_kind_check',
      sql.raw(`tribute_kind is null or tribute_kind in (${TRIBUTE_KINDS.map((k) => `'${k}'`).join(', ')})`),
    ),
    check('gifts_tribute_name_length', sql`tribute_name is null or length(tribute_name) between 1 and 120`),
    check(
      'gifts_tribute_recipient_length',
      sql`tribute_recipient is null or length(tribute_recipient) between 1 and 120`,
    ),
    check('gifts_tribute_note_length', sql`tribute_note is null or length(tribute_note) between 1 and 500`),
  ],
);
