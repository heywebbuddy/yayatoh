import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const paymentsSchema = pgSchema('payments');

/** Webhook dedupe: each provider event is processed at most once. */
export const providerEvents = tenantTable(
  paymentsSchema,
  'provider_events',
  {
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    type: text('type').notNull(),
  },
  (t) => [
    uniqueIndex('provider_events_org_provider_event_key').on(t.orgId, t.provider, t.providerEventId),
    check('provider_events_provider_check', sql`provider in ('fake', 'stripe')`),
  ],
);

/**
 * The organization's connected (payout) account (roadmap §5.3): one per org. When charges and
 * payouts are enabled, new orders use `organizer_mor` (direct charges on the account); until
 * then they use `platform_mor` (platform charges, transfers at release).
 */
export const paymentAccounts = tenantTable(
  paymentsSchema,
  'payment_accounts',
  {
    provider: text('provider').notNull(),
    accountId: text('account_id').notNull(),
    accountClass: text('account_class').notNull().default('standard'),
    chargesEnabled: boolean('charges_enabled').notNull().default(false),
    payoutsEnabled: boolean('payouts_enabled').notNull().default(false),
    detailsSubmitted: boolean('details_submitted').notNull().default(false),
    requirementsDue: text('requirements_due').array().notNull().default(sql`'{}'::text[]`),
    country: text('country').notNull(),
    defaultCurrency: text('default_currency'),
    /** Staff payout hold (M1.3e): releases and transfers wait while set. */
    payoutsHeld: boolean('payouts_held').notNull().default(false),
    holdReason: text('hold_reason'),
    lastEventAt: timestamp('last_event_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('payment_accounts_org_key').on(t.orgId),
    check('payment_accounts_provider_check', sql`provider in ('fake', 'stripe')`),
    check('payment_accounts_class_check', sql`account_class in ('standard', 'express', 'custom')`),
  ],
);

/** Ledger accounts (roadmap §5.3). Platform accounts are per org rows too: every journal is about one org. */
export const LEDGER_ACCOUNTS = [
  'platform:stripe_cash',
  'platform:platform_fee_deferred',
  'platform:platform_fee_revenue',
  'platform:processing_fee_expense',
  'org:payable_held',
  'org:payable_releasable',
  'org:reserve',
  'org:receivable',
] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

/**
 * A balanced, immutable journal. Inserted only by `payments.post_journal` (owner ledger_writer);
 * app_user can only read (RLS). Replays with the same idempotency key return the first journal.
 */
export const journalEntries = tenantTable(
  paymentsSchema,
  'journal_entries',
  {
    idempotencyKey: text('idempotency_key').notNull(),
    kind: text('kind').notNull(),
    refType: text('ref_type').notNull(),
    refId: uuid('ref_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    memo: jsonb('memo').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    uniqueIndex('journal_entries_org_key').on(t.orgId, t.idempotencyKey),
    index('journal_entries_org_ref_idx').on(t.orgId, t.refType, t.refId),
  ],
);

/** One line of a journal: debit positive, credit negative; each journal sums to zero per currency. */
export const postings = tenantTable(
  paymentsSchema,
  'postings',
  {
    journalId: uuid('journal_id').notNull(),
    account: text('account').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
  },
  (t) => [
    index('postings_org_account_idx').on(t.orgId, t.account, t.currency),
    index('postings_org_journal_idx').on(t.orgId, t.journalId),
    check(
      'postings_account_check',
      sql.raw(`account in (${LEDGER_ACCOUNTS.map((a) => `'${a}'`).join(', ')})`),
    ),
    check('postings_amount_check', sql`amount_minor <> 0`),
    check('postings_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    foreignKey({
      name: 'postings_journal_fk',
      columns: [t.orgId, t.journalId],
      foreignColumns: [journalEntries.orgId, journalEntries.id],
    }),
  ],
);
