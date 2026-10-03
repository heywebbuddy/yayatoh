import { tenantTable } from '@yayatoh/db';
import { type SQL, sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { CALL_STATUSES, ENTRY_STATUSES, PADDLE_MAX, PADDLE_MIN, PLEDGE_STATUSES } from './domain/paddles.ts';
import { campaigns, donationsSchema } from './schema.ts';

/**
 * M4.8c paddle raise. Every table belongs to one event of the org; `(org_id, event_id)` references
 * `events.events` and `(org_id, guest_id)` / `(org_id, party_id)` reference `guests.guests` and
 * `guests.parties` (lower tiers) through hand-written foreign keys in the migration.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const minor = (name: string) => bigint(name, { mode: 'number' });
const inList = (column: string, values: readonly string[]): SQL =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`);

/**
 * A paddle number given to one guest or one party of the event (bulk by table, or one at a time at
 * check-in). Removing the guest or party removes the paddle (hand-written cascade); its entries
 * keep the number.
 */
export const paddles = tenantTable(
  donationsSchema,
  'paddles',
  {
    eventId: uuid('event_id').notNull(),
    number: integer('number').notNull(),
    guestId: uuid('guest_id'),
    partyId: uuid('party_id'),
  },
  (t) => [
    uniqueIndex('paddles_org_event_number_key').on(t.orgId, t.eventId, t.number),
    uniqueIndex('paddles_org_guest_key').on(t.orgId, t.guestId).where(sql`guest_id is not null`),
    uniqueIndex('paddles_org_party_key').on(t.orgId, t.partyId).where(sql`party_id is not null`),
    check('paddles_number_check', sql.raw(`number between ${PADDLE_MIN} and ${PADDLE_MAX}`)),
    check('paddles_holder_check', sql`(guest_id is null) <> (party_id is null)`),
  ],
);

/**
 * A call: one giving level armed by the console (the auctioneer calls it). The level's name and
 * amount are copied, so editing or removing the level never changes what the room pledged. One open
 * call per event (partial unique).
 */
export const paddleCalls = tenantTable(
  donationsSchema,
  'paddle_calls',
  {
    eventId: uuid('event_id').notNull(),
    campaignId: uuid('campaign_id').notNull(),
    levelId: uuid('level_id'),
    levelName: text('level_name').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull().default('open'),
    openedAt: ts('opened_at').notNull(),
    closedAt: ts('closed_at'),
  },
  (t) => [
    index('paddle_calls_org_event_opened_idx').on(t.orgId, t.eventId, t.openedAt),
    uniqueIndex('paddle_calls_org_event_open_key').on(t.orgId, t.eventId).where(sql`status = 'open'`),
    foreignKey({
      name: 'paddle_calls_campaign_fk',
      columns: [t.orgId, t.campaignId],
      foreignColumns: [campaigns.orgId, campaigns.id],
    }).onDelete('cascade'),
    check('paddle_calls_status_check', inList('status', CALL_STATUSES)),
    check('paddle_calls_amount_check', sql`amount_minor > 0`),
    check('paddle_calls_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('paddle_calls_level_name_length', sql`length(level_name) between 1 and 80`),
    check('paddle_calls_closed_check', sql`(status = 'closed') = (closed_at is not null)`),
  ],
);

/**
 * A spotter's entry: a paddle seen raised at a call. `client_id` is made on the spotter's device:
 * the same entry synced twice is stored once (unique per org). Duplicates (the same paddle at the
 * same call) are stored and flagged for the recorder, never dropped. `paddle_id` is cleared when
 * the paddle goes (hand-written `SET NULL (paddle_id)`); the number stays.
 */
export const paddleEntries = tenantTable(
  donationsSchema,
  'paddle_entries',
  {
    eventId: uuid('event_id').notNull(),
    callId: uuid('call_id').notNull(),
    clientId: uuid('client_id').notNull(),
    paddleId: uuid('paddle_id'),
    paddleNumber: integer('paddle_number').notNull(),
    status: text('status').notNull(),
    /** The entry this one duplicates (the first counted one for the paddle at the call). */
    duplicateOf: uuid('duplicate_of'),
    /** The spotter (a member's user id; no foreign key: users are platform-wide). */
    spotterUserId: text('spotter_user_id'),
    /** The device's clock when the number was typed (it may sync minutes later). */
    recordedAt: ts('recorded_at').notNull(),
    reviewedAt: ts('reviewed_at'),
  },
  (t) => [
    uniqueIndex('paddle_entries_org_client_key').on(t.orgId, t.clientId),
    index('paddle_entries_org_call_paddle_idx').on(t.orgId, t.callId, t.paddleNumber),
    index('paddle_entries_org_event_created_idx').on(t.orgId, t.eventId, t.createdAt),
    foreignKey({
      name: 'paddle_entries_call_fk',
      columns: [t.orgId, t.callId],
      foreignColumns: [paddleCalls.orgId, paddleCalls.id],
    }).onDelete('cascade'),
    check('paddle_entries_status_check', inList('status', ENTRY_STATUSES)),
    check('paddle_entries_number_check', sql.raw(`paddle_number between ${PADDLE_MIN} and ${PADDLE_MAX}`)),
    check('paddle_entries_spotter_length', sql`spotter_user_id is null or length(spotter_user_id) <= 64`),
  ],
);

/**
 * A pledge from the paddle raise: the recorder confirmed an entry (one pledge per entry). A promise,
 * never a charge (P4-12): collection arrives with M4.8e. The holder (guest or party) is kept for
 * receipts and follow-up; amounts are private to the organizer.
 */
export const pledges = tenantTable(
  donationsSchema,
  'pledges',
  {
    eventId: uuid('event_id').notNull(),
    campaignId: uuid('campaign_id').notNull(),
    callId: uuid('call_id').notNull(),
    entryId: uuid('entry_id').notNull(),
    paddleNumber: integer('paddle_number').notNull(),
    guestId: uuid('guest_id'),
    partyId: uuid('party_id'),
    amountMinor: minor('amount_minor').notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull().default('confirmed'),
    source: text('source').notNull().default('paddle'),
    confirmedAt: ts('confirmed_at').notNull(),
    cancelledAt: ts('cancelled_at'),
  },
  (t) => [
    uniqueIndex('pledges_org_entry_key').on(t.orgId, t.entryId),
    index('pledges_org_event_status_idx').on(t.orgId, t.eventId, t.status),
    index('pledges_org_campaign_idx').on(t.orgId, t.campaignId),
    foreignKey({
      name: 'pledges_campaign_fk',
      columns: [t.orgId, t.campaignId],
      foreignColumns: [campaigns.orgId, campaigns.id],
    }),
    foreignKey({
      name: 'pledges_call_fk',
      columns: [t.orgId, t.callId],
      foreignColumns: [paddleCalls.orgId, paddleCalls.id],
    }),
    foreignKey({
      name: 'pledges_entry_fk',
      columns: [t.orgId, t.entryId],
      foreignColumns: [paddleEntries.orgId, paddleEntries.id],
    }),
    check('pledges_status_check', inList('status', PLEDGE_STATUSES)),
    check('pledges_source_check', sql`source = 'paddle'`),
    check('pledges_amount_check', sql`amount_minor > 0`),
    check('pledges_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('pledges_cancelled_check', sql`(status = 'cancelled') = (cancelled_at is not null)`),
  ],
);
