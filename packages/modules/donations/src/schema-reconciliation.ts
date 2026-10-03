import { tenantTable } from '@yayatoh/db';
import { type SQL, sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  RECON_ITEM_KINDS,
  RECON_ITEM_STATUSES,
  RECON_PAYOUT_STATUSES,
  RECON_PROVIDERS,
} from './domain/reconcile.ts';
import { donationsSchema } from './schema.ts';

/**
 * M4.8g donations reconciliation (extends M1.6e to the charity's connected account): each run
 * compares the event's gifts as the ledger remembers them (memo entries) with the connected
 * account's balance transactions, and keeps the differences and the payouts the gifts landed in.
 * `(org_id, event_id)` references `events.events` through hand-written foreign keys.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const minor = (name: string) => bigint(name, { mode: 'number' });
const inList = (column: string, values: readonly string[]): SQL =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`);

/** One reconciliation of an event's donations: what each side counted, per currency (`totals`). */
export const reconRuns = tenantTable(
  donationsSchema,
  'recon_runs',
  {
    eventId: uuid('event_id').notNull(),
    provider: text('provider').notNull(),
    ledgerCount: integer('ledger_count').notNull(),
    providerCount: integer('provider_count').notNull(),
    itemCount: integer('item_count').notNull(),
    /** `[{ currency, ledgerMinor, providerMinor, feeMinor }]`, parsed by `ReconTotals` on read. */
    totals: jsonb('totals').notNull().default(sql`'[]'::jsonb`),
    ranBy: text('ran_by'),
  },
  (t) => [
    index('recon_runs_org_event_created_idx').on(t.orgId, t.eventId, t.createdAt),
    check('recon_runs_provider_check', inList('provider', RECON_PROVIDERS)),
    check('recon_runs_counts_check', sql`ledger_count >= 0 and provider_count >= 0 and item_count >= 0`),
  ],
);

/**
 * A difference between the ledger and the provider for one reference (`order:<id>`,
 * `refund:<id>`) and currency: one row per event, reference and currency, updated by later runs
 * (`cleared` once both sides agree again; `resolved` by finance with a note).
 */
export const reconItems = tenantTable(
  donationsSchema,
  'recon_items',
  {
    eventId: uuid('event_id').notNull(),
    runId: uuid('run_id').notNull(),
    kind: text('kind').notNull(),
    reference: text('reference').notNull(),
    currency: text('currency').notNull(),
    ledgerMinor: minor('ledger_minor').notNull(),
    providerMinor: minor('provider_minor').notNull(),
    status: text('status').notNull().default('open'),
    resolutionNote: text('resolution_note'),
    resolvedBy: text('resolved_by'),
    resolvedAt: ts('resolved_at'),
  },
  (t) => [
    uniqueIndex('recon_items_org_event_reference_key').on(t.orgId, t.eventId, t.reference, t.currency),
    index('recon_items_org_event_status_idx').on(t.orgId, t.eventId, t.status),
    foreignKey({
      name: 'recon_items_run_fk',
      columns: [t.orgId, t.runId],
      foreignColumns: [reconRuns.orgId, reconRuns.id],
    }).onDelete('cascade'),
    check('recon_items_kind_check', inList('kind', RECON_ITEM_KINDS)),
    check('recon_items_status_check', inList('status', RECON_ITEM_STATUSES)),
    check('recon_items_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('recon_items_reference_length', sql`length(reference) between 1 and 200`),
    check(
      'recon_items_resolved_check',
      sql`status <> 'resolved' or (resolved_at is not null and resolution_note is not null)`,
    ),
    check(
      'recon_items_note_length',
      sql`resolution_note is null or length(resolution_note) between 3 and 500`,
    ),
  ],
);

/**
 * A payout of the connected account that paid out some of the event's gifts, as the run saw it:
 * the whole payout and the part of it that was this event's donations (gross, fees, net).
 */
export const reconPayouts = tenantTable(
  donationsSchema,
  'recon_payouts',
  {
    eventId: uuid('event_id').notNull(),
    runId: uuid('run_id').notNull(),
    payoutId: text('payout_id').notNull(),
    status: text('status').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    currency: text('currency').notNull(),
    arrivalDate: date('arrival_date', { mode: 'string' }).notNull(),
    payoutCreatedAt: ts('payout_created_at').notNull(),
    donationGrossMinor: minor('donation_gross_minor').notNull(),
    donationFeeMinor: minor('donation_fee_minor').notNull(),
    donationCount: integer('donation_count').notNull(),
  },
  (t) => [
    uniqueIndex('recon_payouts_org_run_payout_key').on(t.orgId, t.runId, t.payoutId),
    index('recon_payouts_org_event_idx').on(t.orgId, t.eventId),
    foreignKey({
      name: 'recon_payouts_run_fk',
      columns: [t.orgId, t.runId],
      foreignColumns: [reconRuns.orgId, reconRuns.id],
    }).onDelete('cascade'),
    check('recon_payouts_status_check', inList('status', RECON_PAYOUT_STATUSES)),
    check('recon_payouts_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('recon_payouts_payout_id_length', sql`length(payout_id) between 1 and 200`),
    check('recon_payouts_count_check', sql`donation_count >= 0 and donation_fee_minor >= 0`),
  ],
);
