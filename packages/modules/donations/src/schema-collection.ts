import { tenantTable } from '@yayatoh/db';
import { type SQL, sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ATTEMPT_KINDS,
  ATTEMPT_STATUSES,
  CARD_SOURCES,
  CARD_STATUSES,
  COLLECTION_STATUSES,
  OFFLINE_METHODS,
} from './domain/collection.ts';
import { campaigns, donationsSchema, gifts } from './schema.ts';
import { pledges } from './schema-paddles.ts';

/**
 * M4.8e cards on file and pledge collection (P4-12, P4-14). `(org_id, event_id)` references
 * `events.events` and `(org_id, party_id)` / `(org_id, guest_id)` reference `guests.parties` /
 * `guests.guests` through hand-written foreign keys in the migration; `(org_id, order_id)`
 * references `orders.orders` the same way.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const minor = (name: string) => bigint(name, { mode: 'number' });
const inList = (column: string, values: readonly string[]): SQL =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`);

/**
 * A card a guest saved for tonight's giving at one event (P4-14), on the organizer's connected
 * account. Yayatoh keeps the provider's references (secret) and what the guest sees (brand, last
 * four, expiry), never card data. The consent (text version and time) is recorded at the start
 * and the card is usable only once the provider confirms it (`active`). Used only for gifts and
 * pledges at this event; removed from the charity's customer 30 days after it (`remove_after`).
 */
export const savedCards = tenantTable(
  donationsSchema,
  'saved_cards',
  {
    eventId: uuid('event_id').notNull(),
    partyId: uuid('party_id'),
    guestId: uuid('guest_id'),
    name: text('name').notNull(),
    email: text('email').notNull(),
    source: text('source').notNull(),
    status: text('status').notNull().default('pending'),
    provider: text('provider').notNull(),
    connectedAccountId: text('connected_account_id').notNull(),
    providerSetupId: text('provider_setup_id'),
    customerId: text('customer_id'),
    paymentMethodId: text('payment_method_id'),
    brand: text('brand'),
    last4: text('last4'),
    expMonth: integer('exp_month'),
    expYear: integer('exp_year'),
    consentVersion: text('consent_version').notNull(),
    consentedAt: ts('consented_at').notNull(),
    locale: text('locale').notNull().default('en'),
    activatedAt: ts('activated_at'),
    removeAfter: ts('remove_after'),
    removedAt: ts('removed_at'),
  },
  (t) => [
    index('saved_cards_org_event_status_idx').on(t.orgId, t.eventId, t.status),
    index('saved_cards_org_party_idx').on(t.orgId, t.partyId).where(sql`party_id is not null`),
    index('saved_cards_org_guest_idx').on(t.orgId, t.guestId).where(sql`guest_id is not null`),
    index('saved_cards_org_remove_idx').on(t.orgId, t.removeAfter).where(sql`status = 'active'`),
    uniqueIndex('saved_cards_org_setup_key')
      .on(t.orgId, t.provider, t.providerSetupId)
      .where(sql`provider_setup_id is not null`),
    check('saved_cards_status_check', inList('status', CARD_STATUSES)),
    check('saved_cards_source_check', inList('source', CARD_SOURCES)),
    check('saved_cards_provider_check', sql`provider in ('fake', 'stripe')`),
    check('saved_cards_holder_check', sql`num_nonnulls(party_id, guest_id) <= 1`),
    check(
      'saved_cards_active_check',
      sql`status <> 'active' or (customer_id is not null and payment_method_id is not null and activated_at is not null)`,
    ),
    check('saved_cards_removed_check', sql`(status = 'removed') = (removed_at is not null)`),
  ],
);

/**
 * How one confirmed pledge is collected (P4-12). Created when the host closes the night (the
 * donor's summary): a card charge planned for the next morning when the holder saved a card with
 * consent, otherwise an invoice with a pay link, a due date and reminders. The amount is the
 * pledge's, copied: Yayatoh never charges more than pledged. Each try is a `pledge_attempts` row.
 */
export const pledgeCollections = tenantTable(
  donationsSchema,
  'pledge_collections',
  {
    eventId: uuid('event_id').notNull(),
    campaignId: uuid('campaign_id').notNull(),
    pledgeId: uuid('pledge_id').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    currency: text('currency').notNull(),
    donorName: text('donor_name').notNull(),
    donorEmail: text('donor_email'),
    locale: text('locale').notNull().default('en'),
    status: text('status').notNull(),
    savedCardId: uuid('saved_card_id'),
    chargeAt: ts('charge_at'),
    cardAttempts: integer('card_attempts').notNull().default(0),
    claimedAt: ts('claimed_at'),
    invoicedAt: ts('invoiced_at'),
    dueOn: date('due_on', { mode: 'string' }),
    paidAt: ts('paid_at'),
    offlineMethod: text('offline_method'),
    offlineReference: text('offline_reference'),
    receivedOn: date('received_on', { mode: 'string' }),
    note: text('note'),
    closedBy: uuid('closed_by'),
    settledBy: uuid('settled_by'),
  },
  (t) => [
    uniqueIndex('pledge_collections_org_pledge_key').on(t.orgId, t.pledgeId),
    index('pledge_collections_org_event_status_idx').on(t.orgId, t.eventId, t.status),
    index('pledge_collections_org_charge_idx')
      .on(t.orgId, t.chargeAt)
      .where(sql`status in ('scheduled', 'charging')`),
    foreignKey({
      name: 'pledge_collections_pledge_fk',
      columns: [t.orgId, t.pledgeId],
      foreignColumns: [pledges.orgId, pledges.id],
    }),
    foreignKey({
      name: 'pledge_collections_campaign_fk',
      columns: [t.orgId, t.campaignId],
      foreignColumns: [campaigns.orgId, campaigns.id],
    }),
    foreignKey({
      name: 'pledge_collections_card_fk',
      columns: [t.orgId, t.savedCardId],
      foreignColumns: [savedCards.orgId, savedCards.id],
    }),
    check('pledge_collections_status_check', inList('status', COLLECTION_STATUSES)),
    check('pledge_collections_amount_check', sql`amount_minor > 0`),
    check('pledge_collections_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check(
      'pledge_collections_card_check',
      sql`status not in ('scheduled', 'charging') or (saved_card_id is not null and charge_at is not null)`,
    ),
    check(
      'pledge_collections_invoice_check',
      sql`status <> 'invoiced' or (invoiced_at is not null and due_on is not null)`,
    ),
    check('pledge_collections_offline_check', sql`(status = 'paid_offline') = (offline_method is not null)`),
    check(
      'pledge_collections_offline_method_check',
      sql`offline_method is null or ${inList('offline_method', OFFLINE_METHODS)}`,
    ),
    check('pledge_collections_paid_check', sql`(status in ('paid', 'paid_offline')) = (paid_at is not null)`),
    check('pledge_collections_written_off_check', sql`status <> 'written_off' or note is not null`),
    check('pledge_collections_attempts_check', sql`card_attempts between 0 and 2`),
  ],
);

/**
 * One try to collect a pledge: a charge of its saved card (`card`, attempt 1 or 2) or a pay-link
 * checkout (`link`). Each try is its own gift and order (exactly the pledged amount; the order's
 * key `order:<id>:1` makes a replayed charge the same charge). Outcomes come from the orders
 * module through the outbox (`order.donation_paid@1`, `order.payment_failed@1`).
 */
export const pledgeAttempts = tenantTable(
  donationsSchema,
  'pledge_attempts',
  {
    collectionId: uuid('collection_id').notNull(),
    kind: text('kind').notNull(),
    attempt: integer('attempt').notNull(),
    giftId: uuid('gift_id').notNull(),
    orderId: uuid('order_id').notNull(),
    status: text('status').notNull().default('pending'),
    declineCode: text('decline_code'),
    settledAt: ts('settled_at'),
  },
  (t) => [
    uniqueIndex('pledge_attempts_org_order_key').on(t.orgId, t.orderId),
    uniqueIndex('pledge_attempts_org_card_attempt_key')
      .on(t.orgId, t.collectionId, t.attempt)
      .where(sql`kind = 'card'`),
    index('pledge_attempts_org_collection_idx').on(t.orgId, t.collectionId),
    foreignKey({
      name: 'pledge_attempts_collection_fk',
      columns: [t.orgId, t.collectionId],
      foreignColumns: [pledgeCollections.orgId, pledgeCollections.id],
    }),
    foreignKey({
      name: 'pledge_attempts_gift_fk',
      columns: [t.orgId, t.giftId],
      foreignColumns: [gifts.orgId, gifts.id],
    }),
    check('pledge_attempts_kind_check', inList('kind', ATTEMPT_KINDS)),
    check('pledge_attempts_status_check', inList('status', ATTEMPT_STATUSES)),
    check('pledge_attempts_attempt_check', sql`attempt >= 1`),
  ],
);
