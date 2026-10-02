import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
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
    /**
     * A new payout destination (the account connected, or its bank changed) waits until this time
     * before any transfer goes to it (roadmap §10: 24 h hold on payout-destination changes).
     */
    destinationHoldUntil: timestamp('destination_hold_until', { withTimezone: true, mode: 'date' }),
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
    /** The event the money belongs to (settlements release per event). */
    eventId: uuid('event_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    memo: jsonb('memo').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    uniqueIndex('journal_entries_org_key').on(t.orgId, t.idempotencyKey),
    index('journal_entries_org_ref_idx').on(t.orgId, t.refType, t.refId),
    index('journal_entries_org_event_idx').on(t.orgId, t.eventId),
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

export const SETTLEMENT_KINDS = ['event', 'reserve'] as const;
export const SETTLEMENT_STATUSES = ['ready', 'waiting_account', 'transferred', 'failed'] as const;

/**
 * Settlements (M1.6c, platform_mor): an event's held funds released after the event (less the
 * reserve and any receivable), or a reserve released after the dispute window, then transferred
 * to the organizer's connected account (separate charges & transfers, transfer at release).
 */
export const settlements = tenantTable(
  paymentsSchema,
  'settlements',
  {
    kind: text('kind').notNull(),
    eventId: uuid('event_id'),
    currency: text('currency').notNull(),
    status: text('status').notNull(),
    /** Released from payable_held (event) or reserve (reserve release). */
    releasedMinor: bigint('released_minor', { mode: 'number' }).notNull(),
    /** Kept back as reserve until reserveReleaseAt. */
    reserveMinor: bigint('reserve_minor', { mode: 'number' }).notNull().default(0),
    /** Netted against what the organizer owed (receivable). */
    nettedMinor: bigint('netted_minor', { mode: 'number' }).notNull().default(0),
    /** What is transferred: released − reserve − netted. */
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    reserveReleaseAt: timestamp('reserve_release_at', { withTimezone: true }),
    reserveReleasedAt: timestamp('reserve_released_at', { withTimezone: true }),
    destinationAccountId: text('destination_account_id'),
    transferId: text('transfer_id'),
    failure: text('failure'),
    releasedAt: timestamp('released_at', { withTimezone: true }).notNull(),
    transferredAt: timestamp('transferred_at', { withTimezone: true }),
  },
  (t) => [
    index('settlements_org_status_idx').on(t.orgId, t.status),
    index('settlements_org_event_idx').on(t.orgId, t.eventId),
    check('settlements_kind_check', sql.raw(`kind in (${SETTLEMENT_KINDS.map((k) => `'${k}'`).join(', ')})`)),
    check(
      'settlements_status_check',
      sql.raw(`status in (${SETTLEMENT_STATUSES.map((k) => `'${k}'`).join(', ')})`),
    ),
    check(
      'settlements_amounts_check',
      sql`released_minor >= 0 and reserve_minor >= 0 and netted_minor >= 0 and amount_minor >= 0 and amount_minor = released_minor - reserve_minor - netted_minor`,
    ),
  ],
);

export const DISPUTE_STATUSES = ['open', 'evidence_submitted', 'won', 'lost'] as const;

/**
 * Disputes (chargebacks, M1.6d). On a platform charge the disputed amount is held from the
 * organizer's funds (the event's held funds, then its reserve, then a receivable) until it closes.
 */
export const disputes = tenantTable(
  paymentsSchema,
  'disputes',
  {
    orderId: uuid('order_id').notNull(),
    eventId: uuid('event_id').notNull(),
    fundsFlow: text('funds_flow').notNull(),
    provider: text('provider').notNull(),
    providerDisputeId: text('provider_dispute_id').notNull(),
    status: text('status').notNull().default('open'),
    reason: text('reason').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    evidenceDueBy: timestamp('evidence_due_by', { withTimezone: true }),
    evidenceSubmittedAt: timestamp('evidence_submitted_at', { withTimezone: true }),
    evidenceSubmittedBy: text('evidence_submitted_by'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** M1.6e: the reviewer's written answer, edited before submission. */
    evidenceSummary: text('evidence_summary'),
    /** M1.6e: packet sections the reviewer left out (e.g. `messages`). */
    evidenceExcluded: text('evidence_excluded').array().notNull().default(sql`'{}'::text[]`),
    /**
     * M3.10c: the deadline alerts already raised (0 none, 1 three days before, 2 one day before),
     * so each is raised once.
     */
    deadlineAlertLevel: integer('deadline_alert_level').notNull().default(0),
  },
  (t) => [
    uniqueIndex('disputes_org_provider_key').on(t.orgId, t.provider, t.providerDisputeId),
    index('disputes_org_order_idx').on(t.orgId, t.orderId),
    check(
      'disputes_status_check',
      sql.raw(`status in (${DISPUTE_STATUSES.map((s) => `'${s}'`).join(', ')})`),
    ),
    check('disputes_amount_check', sql`amount_minor > 0`),
    check('disputes_deadline_alert_check', sql`deadline_alert_level between 0 and 2`),
  ],
);

export const LEGACY_SETTLEMENT_KINDS = ['event_statement', 'opening_balance'] as const;
export const LEGACY_SETTLEMENT_STATUSES = ['settled', 'open', 'pending_signoff', 'signed_off'] as const;

/**
 * Legacy payouts carried over by the migration (roadmap §7.5 T4, ADR 0005): one `event_statement`
 * per org × event × currency summing the legacy `commissions` rows, and one `opening_balance` per
 * org × currency for what was still owed to the organizer at the freeze. Opening balances need the
 * owner's sign-off before any release (they never enter the ledger on their own).
 */
export const legacySettlements = tenantTable(
  paymentsSchema,
  'legacy_settlements',
  {
    kind: text('kind').notNull(),
    /** `yay` or `abc`. */
    instance: text('instance').notNull(),
    /** Event statements only (`events.events`, composite FK in the migration). */
    eventId: uuid('event_id'),
    currency: text('currency').notNull(),
    status: text('status').notNull(),
    /** What buyers paid the organizer (legacy `customer_paid`, platform tax excluded). */
    customerPaidMinor: bigint('customer_paid_minor', { mode: 'number' }).notNull(),
    /** The platform's commission (legacy `admin_commission`). */
    commissionMinor: bigint('commission_minor', { mode: 'number' }).notNull(),
    /** The platform's own tax portion (legacy `admin_tax`). */
    adminTaxMinor: bigint('admin_tax_minor', { mode: 'number' }).notNull(),
    /** The organizer's share (legacy `organiser_earning`). */
    organizerEarningMinor: bigint('organizer_earning_minor', { mode: 'number' }).notNull(),
    /** Already paid out in the legacy app (`transferred = 1`). */
    transferredMinor: bigint('transferred_minor', { mode: 'number' }).notNull(),
    /** Still owed to the organizer (`status = 1`, `transferred = 0`). */
    openMinor: bigint('open_minor', { mode: 'number' }).notNull(),
    /** Refunded after payout and not yet clawed back (`status = 0`, `transferred = 1`, `settled = 0`). */
    clawbackMinor: bigint('clawback_minor', { mode: 'number' }).notNull().default(0),
    /** How many legacy commission rows this row sums. */
    sourceRows: bigint('source_rows', { mode: 'number' }).notNull(),
    signedOffBy: uuid('signed_off_by'),
    signedOffAt: timestamp('signed_off_at', { withTimezone: true }),
  },
  (t) => [
    index('legacy_settlements_org_event_idx').on(t.orgId, t.eventId),
    uniqueIndex('legacy_settlements_org_statement_key').on(
      t.orgId,
      t.kind,
      t.instance,
      sql`coalesce(event_id, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.currency,
    ),
    check(
      'legacy_settlements_kind_check',
      sql.raw(`kind in (${LEGACY_SETTLEMENT_KINDS.map((k) => `'${k}'`).join(', ')})`),
    ),
    check(
      'legacy_settlements_status_check',
      sql.raw(`status in (${LEGACY_SETTLEMENT_STATUSES.map((k) => `'${k}'`).join(', ')})`),
    ),
    check('legacy_settlements_instance_check', sql`instance in ('yay', 'abc')`),
    check('legacy_settlements_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('legacy_settlements_event_check', sql`(kind = 'event_statement') = (event_id is not null)`),
    check(
      'legacy_settlements_amounts_check',
      sql`customer_paid_minor >= 0 and commission_minor >= 0 and admin_tax_minor >= 0 and organizer_earning_minor >= 0 and transferred_minor >= 0 and open_minor >= 0 and clawback_minor >= 0 and source_rows >= 0`,
    ),
    check('legacy_settlements_signoff_check', sql`(status = 'signed_off') = (signed_off_at is not null)`),
  ],
);

export const RECONCILIATION_ITEM_KINDS = [
  'missing_at_provider',
  'missing_in_ledger',
  'amount_mismatch',
] as const;
export const RECONCILIATION_ITEM_STATUSES = ['open', 'resolved'] as const;

/**
 * Daily reconciliation (M1.6e): one run per org and UTC day comparing the ledger's platform cash
 * with the provider's balance transactions. Re-running a day changes nothing.
 */
export const reconciliationRuns = tenantTable(
  paymentsSchema,
  'reconciliation_runs',
  {
    day: date('day', { mode: 'string' }).notNull(),
    provider: text('provider').notNull(),
    ledgerCount: integer('ledger_count').notNull(),
    providerCount: integer('provider_count').notNull(),
    itemCount: integer('item_count').notNull(),
  },
  (t) => [
    uniqueIndex('reconciliation_runs_org_day_key').on(t.orgId, t.day),
    check('reconciliation_runs_provider_check', sql`provider in ('fake', 'stripe')`),
    check(
      'reconciliation_runs_counts_check',
      sql`ledger_count >= 0 and provider_count >= 0 and item_count >= 0`,
    ),
  ],
);

/** A difference the run found: what the ledger and the provider say about one reference. */
export const reconciliationItems = tenantTable(
  paymentsSchema,
  'reconciliation_items',
  {
    runId: uuid('run_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    kind: text('kind').notNull(),
    /** The shared reference: `order:<id>`, `refund:<id>`, `settlement:<id>`, `reversal:<id>`, `dispute:<id>`. */
    reference: text('reference').notNull(),
    currency: text('currency').notNull(),
    ledgerMinor: bigint('ledger_minor', { mode: 'number' }).notNull(),
    providerMinor: bigint('provider_minor', { mode: 'number' }).notNull(),
    status: text('status').notNull().default('open'),
    resolutionNote: text('resolution_note'),
    resolvedBy: text('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('reconciliation_items_org_ref_key').on(t.orgId, t.day, t.reference, t.currency),
    index('reconciliation_items_org_status_idx').on(t.orgId, t.status, t.day),
    check(
      'reconciliation_items_kind_check',
      sql.raw(`kind in (${RECONCILIATION_ITEM_KINDS.map((k) => `'${k}'`).join(', ')})`),
    ),
    check(
      'reconciliation_items_status_check',
      sql.raw(`status in (${RECONCILIATION_ITEM_STATUSES.map((k) => `'${k}'`).join(', ')})`),
    ),
    check('reconciliation_items_differs_check', sql`ledger_minor <> provider_minor`),
    check('reconciliation_items_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check(
      'reconciliation_items_resolved_check',
      sql`(status = 'open') = (resolved_at is null) and (status = 'open' or length(resolution_note) between 3 and 500)`,
    ),
    foreignKey({
      name: 'reconciliation_items_run_fk',
      columns: [t.orgId, t.runId],
      foreignColumns: [reconciliationRuns.orgId, reconciliationRuns.id],
    }),
  ],
);
