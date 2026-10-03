import { tenantTable } from '@yayatoh/db';
import { type SQL, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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
import { CHARITY_STATUSES, EXEMPT_KINDS, RECEIPT_KINDS } from './domain/receipts.ts';

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
    /** M4.8d: the donor asked to be thanked by name on the room's screen (P4-13; off by default). */
    showOnScreen: boolean('show_on_screen').notNull().default(false),
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
    check('gifts_show_on_screen_check', sql`not show_on_screen or display_as <> 'anonymous'`),
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

// ── M4.8b: charity profile, fair-market values, receipts and year-end statements ──────────────

/**
 * The org's charity profile (M4.8b, P4-11): one per org. Legal name, EIN and how it is exempt
 * (its own 501(c)(3) status, or a fiscal sponsor's, whose name and EIN then print on receipts).
 * Saving it sends it to staff review (`pending`, a new `version`); staff verify it against the
 * IRS exempt-organization list (`irs_*` is what the list said at verification) or reject it with a
 * note. Only a `verified` profile issues tax-deductible receipts. A charity's legal name, EIN and
 * address are public record (they print on every receipt).
 */
export const charityProfiles = tenantTable(
  donationsSchema,
  'charity_profiles',
  {
    legalName: text('legal_name').notNull(),
    ein: text('ein').notNull(),
    exemptKind: text('exempt_kind').notNull(),
    sponsorName: text('sponsor_name'),
    sponsorEin: text('sponsor_ein'),
    address: text('address'),
    status: text('status').notNull().default('pending'),
    version: integer('version').notNull().default(1),
    submittedAt: ts('submitted_at').notNull(),
    reviewedAt: ts('reviewed_at'),
    reviewedBy: text('reviewed_by'),
    reviewNote: text('review_note'),
    irsName: text('irs_name'),
    irsCity: text('irs_city'),
    irsState: text('irs_state'),
    irsDeductibility: text('irs_deductibility'),
  },
  (t) => [
    uniqueIndex('charity_profiles_org_key').on(t.orgId),
    index('charity_profiles_org_status_idx').on(t.orgId, t.status),
    check('charity_profiles_legal_name_length', sql`length(legal_name) between 1 and 200`),
    check('charity_profiles_ein_check', sql`ein ~ '^[0-9]{2}-[0-9]{7}$'`),
    check('charity_profiles_exempt_kind_check', inList('exempt_kind', EXEMPT_KINDS)),
    check(
      'charity_profiles_sponsor_check',
      sql`(exempt_kind = 'fiscal_sponsor') = (sponsor_name is not null and sponsor_ein is not null) and (exempt_kind = 'fiscal_sponsor' or (sponsor_name is null and sponsor_ein is null))`,
    ),
    check(
      'charity_profiles_sponsor_name_length',
      sql`sponsor_name is null or length(sponsor_name) between 1 and 200`,
    ),
    check(
      'charity_profiles_sponsor_ein_check',
      sql`sponsor_ein is null or sponsor_ein ~ '^[0-9]{2}-[0-9]{7}$'`,
    ),
    check('charity_profiles_address_length', sql`address is null or length(address) between 1 and 300`),
    check('charity_profiles_status_check', inList('status', CHARITY_STATUSES)),
    check('charity_profiles_version_check', sql`version >= 1`),
    check(
      'charity_profiles_review_check',
      sql`(status = 'pending') = (reviewed_at is null) and (status <> 'verified' or irs_name is not null)`,
    ),
    check(
      'charity_profiles_review_note_length',
      sql`review_note is null or length(review_note) between 1 and 500`,
    ),
  ],
);

/**
 * A ticket type's fair-market value (M4.8b, P4-11): the good-faith value of what a ticket buyer
 * receives (a gala dinner), and what it is. Receipts deduct it; ticket pages over $75 show the
 * quid-pro-quo notice. `(org_id, ticket_type_id)` references `ticketing.ticket_types` (a lower tier)
 * through a hand-written foreign key (cascade: the value goes with its ticket type).
 */
export const ticketFairValues = tenantTable(
  donationsSchema,
  'ticket_fair_values',
  {
    eventId: uuid('event_id').notNull(),
    ticketTypeId: uuid('ticket_type_id').notNull(),
    fmvMinor: minor('fmv_minor').notNull(),
    currency: text('currency').notNull(),
    description: text('description'),
  },
  (t) => [
    uniqueIndex('ticket_fair_values_org_type_key').on(t.orgId, t.ticketTypeId),
    index('ticket_fair_values_org_event_idx').on(t.orgId, t.eventId),
    check('ticket_fair_values_fmv_check', sql`fmv_minor >= 0 and fmv_minor <= 100000000`),
    check('ticket_fair_values_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check(
      'ticket_fair_values_description_length',
      sql`description is null or length(description) between 1 and 200`,
    ),
  ],
);

/** The per-org receipt counter: numbers are gap-free per org, taken under this row's lock. */
export const receiptSequences = tenantTable(
  donationsSchema,
  'receipt_sequences',
  { lastNumber: integer('last_number').notNull().default(0) },
  (t) => [
    uniqueIndex('receipt_sequences_org_key').on(t.orgId),
    check('receipt_sequences_last_check', sql`last_number >= 0`),
  ],
);

/**
 * A receipt (M4.8b, P4-11): one per paid order, a gift's or a ticket order's whose ticket types
 * carry a fair-market value. Immutable once issued: the charity's details and the wording version
 * are snapshots. `deductible` false is a plain "This payment is not tax-deductible" receipt
 * (unverified org, platform as merchant of record, or not USD). The donor's name and email are
 * personal; receipts go only to that email. `(org_id, order_id)` and `(org_id, event_id)`
 * reference `orders.orders` and `events.events` through hand-written foreign keys.
 */
export const receipts = tenantTable(
  donationsSchema,
  'receipts',
  {
    eventId: uuid('event_id').notNull(),
    orderId: uuid('order_id').notNull(),
    giftId: uuid('gift_id'),
    number: integer('number').notNull(),
    kind: text('kind').notNull(),
    deductible: boolean('deductible').notNull(),
    donorName: text('donor_name').notNull(),
    donorEmail: text('donor_email').notNull(),
    locale: text('locale').notNull().default('en'),
    currency: text('currency').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    fmvMinor: minor('fmv_minor').notNull(),
    deductibleMinor: minor('deductible_minor').notNull(),
    goods: text('goods'),
    charityName: text('charity_name').notNull(),
    charityEin: text('charity_ein'),
    sponsorName: text('sponsor_name'),
    sponsorEin: text('sponsor_ein'),
    charityAddress: text('charity_address'),
    paidAt: ts('paid_at').notNull(),
    taxYear: integer('tax_year').notNull(),
    copyVersion: text('copy_version').notNull(),
  },
  (t) => [
    uniqueIndex('receipts_org_order_key').on(t.orgId, t.orderId),
    uniqueIndex('receipts_org_number_key').on(t.orgId, t.number),
    index('receipts_org_event_created_idx').on(t.orgId, t.eventId, t.createdAt),
    index('receipts_org_year_email_idx').on(t.orgId, t.taxYear, t.donorEmail),
    check('receipts_number_check', sql`number >= 1`),
    check('receipts_kind_check', inList('kind', RECEIPT_KINDS)),
    check('receipts_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check(
      'receipts_amounts_check',
      sql`amount_minor >= 0 and fmv_minor >= 0 and deductible_minor >= 0 and deductible_minor <= amount_minor`,
    ),
    check('receipts_deductible_check', sql`deductible or deductible_minor = 0`),
    check('receipts_charity_check', sql`not deductible or charity_ein is not null`),
    check('receipts_donor_name_length', sql`length(donor_name) between 1 and 120`),
    check('receipts_donor_email_check', sql`donor_email = lower(donor_email) and length(donor_email) <= 254`),
    check('receipts_goods_length', sql`goods is null or length(goods) between 1 and 2000`),
    check('receipts_charity_name_length', sql`length(charity_name) between 1 and 200`),
    check('receipts_tax_year_check', sql`tax_year between 2000 and 2200`),
  ],
);

/**
 * A donor's year-end giving statement (M4.8b, P4-11): one per org, tax year (the org's timezone),
 * donor email and currency, totalling that year's tax-deductible receipts exactly. Written by the
 * worker's daily pass in the new year (`donations.yearEndStatements`) and mailed to the donor.
 */
export const yearEndStatements = tenantTable(
  donationsSchema,
  'year_end_statements',
  {
    taxYear: integer('tax_year').notNull(),
    donorEmail: text('donor_email').notNull(),
    donorName: text('donor_name').notNull(),
    locale: text('locale').notNull().default('en'),
    currency: text('currency').notNull(),
    receiptCount: integer('receipt_count').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    fmvMinor: minor('fmv_minor').notNull(),
    deductibleMinor: minor('deductible_minor').notNull(),
    charityName: text('charity_name').notNull(),
    charityEin: text('charity_ein').notNull(),
    sponsorName: text('sponsor_name'),
    sponsorEin: text('sponsor_ein'),
    charityAddress: text('charity_address'),
    copyVersion: text('copy_version').notNull(),
  },
  (t) => [
    uniqueIndex('year_end_statements_org_year_email_key').on(t.orgId, t.taxYear, t.donorEmail, t.currency),
    index('year_end_statements_org_year_idx').on(t.orgId, t.taxYear),
    check('year_end_statements_tax_year_check', sql`tax_year between 2000 and 2200`),
    check('year_end_statements_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('year_end_statements_count_check', sql`receipt_count >= 1`),
    check(
      'year_end_statements_amounts_check',
      sql`amount_minor >= 0 and fmv_minor >= 0 and deductible_minor >= 0 and deductible_minor <= amount_minor`,
    ),
    check(
      'year_end_statements_donor_email_check',
      sql`donor_email = lower(donor_email) and length(donor_email) <= 254`,
    ),
    check('year_end_statements_donor_name_length', sql`length(donor_name) between 1 and 120`),
    check('year_end_statements_charity_name_length', sql`length(charity_name) between 1 and 200`),
  ],
);
