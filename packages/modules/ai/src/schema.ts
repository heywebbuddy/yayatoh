import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { check, index, integer, pgSchema, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { CREDIT_ENTRY_KINDS, DRAFT_KINDS } from './domain/ledger.ts';

export const aiSchema = pgSchema('ai');

const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');

/**
 * M1.4f: one AI-credit account per org. `balance` is the running total of the ledger (the
 * ledger is the record, the account is the lock and the fast read). `period` is the UTC month
 * the free allowance was last topped up for. The CHECK makes a negative balance impossible even
 * if a bug skipped the command's own check.
 */
export const creditAccounts = tenantTable(
  aiSchema,
  'credit_accounts',
  {
    balance: integer('balance').notNull(),
    allowance: integer('allowance').notNull(),
    period: text('period').notNull(),
  },
  (t) => [
    uniqueIndex('credit_accounts_org_key').on(t.orgId),
    check('credit_accounts_balance_check', sql`balance >= 0`),
    check('credit_accounts_allowance_check', sql`allowance >= 0`),
    check('credit_accounts_period_check', sql`period ~ '^[0-9]{4}-[0-9]{2}$'`),
  ],
);

/**
 * Append-only credit ledger (UPDATE/DELETE revoked from app_user in the migration). `amount` is
 * signed: grants and refunds add, debits subtract; `balance_after` is the account's balance
 * once the entry applied, so the ledger can be audited line by line.
 */
export const creditLedger = tenantTable(
  aiSchema,
  'credit_ledger',
  {
    kind: text('kind').notNull(),
    amount: integer('amount').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    period: text('period').notNull(),
    reason: text('reason').notNull(),
    draftKind: text('draft_kind'),
    eventId: uuid('event_id'),
    /** A refund names the debit it gives back (one refund per debit). */
    refId: uuid('ref_id'),
    actor: text('actor'),
  },
  (t) => [
    index('credit_ledger_org_created_idx').on(t.orgId, t.createdAt),
    uniqueIndex('credit_ledger_org_refund_key').on(t.orgId, t.refId).where(sql`kind = 'refund'`),
    check('credit_ledger_kind_check', sql.raw(`kind in (${list(CREDIT_ENTRY_KINDS)})`)),
    check(
      'credit_ledger_draft_kind_check',
      sql.raw(`draft_kind is null or draft_kind in (${list(DRAFT_KINDS)})`),
    ),
    check('credit_ledger_balance_after_check', sql`balance_after >= 0`),
    check(
      'credit_ledger_sign_check',
      sql`(kind = 'debit' and amount < 0) or (kind in ('grant', 'refund') and amount > 0) or kind = 'adjust'`,
    ),
  ],
);
