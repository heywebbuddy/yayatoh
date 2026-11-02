import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { AI_PURPOSES, CREDIT_ENTRY_KINDS } from './domain/ledger.ts';
import { TONES } from './domain/tones.ts';

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
      sql.raw(`draft_kind is null or draft_kind in (${list(AI_PURPOSES)})`),
    ),
    check('credit_ledger_balance_after_check', sql`balance_after >= 0`),
    check(
      'credit_ledger_sign_check',
      sql`(kind = 'debit' and amount < 0) or (kind in ('grant', 'refund') and amount > 0) or kind = 'adjust'`,
    ),
  ],
);

/**
 * AI1: one row per provider call, for cost and quality tracking. Never the prompt or the reply.
 * Append-only for `app_user` (UPDATE/DELETE revoked in the migration), like the ledger.
 */
export const aiUsage = tenantTable(
  aiSchema,
  'usage',
  {
    purpose: text('purpose').notNull(),
    eventId: uuid('event_id'),
    debitId: uuid('debit_id'),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    cacheReadTokens: integer('cache_read_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    costMicros: integer('cost_micros').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    outcome: text('outcome').notNull(),
  },
  (t) => [
    index('usage_org_created_idx').on(t.orgId, t.createdAt),
    check('usage_purpose_check', sql.raw(`purpose in (${list(AI_PURPOSES)})`)),
    check('usage_outcome_check', sql`outcome in ('ok', 'refused', 'unusable', 'unavailable')`),
  ],
);

/**
 * AI1: the saved summary of an event's reviews or a survey's answers. `input_hash` is the digest
 * of the answers read: unchanged answers show this row again, without a provider call or a credit.
 */
export const aiInsights = tenantTable(
  aiSchema,
  'insights',
  {
    eventId: uuid('event_id').notNull(),
    subject: text('subject').notNull(),
    subjectId: uuid('subject_id').notNull(),
    inputHash: text('input_hash').notNull(),
    result: jsonb('result').$type<unknown>().notNull(),
    basedOn: integer('based_on').notNull(),
    total: integer('total').notNull(),
    model: text('model').notNull(),
  },
  (t) => [
    uniqueIndex('insights_org_subject_key').on(t.orgId, t.subject, t.subjectId),
    check('insights_subject_check', sql`subject in ('reviews', 'survey')`),
  ],
);

/**
 * M6.12b: brand kits — a named brand voice that AI drafts follow (campaigns, pages, agendas):
 * a description of the voice, a default tone, words to prefer and words to avoid. Colours and
 * the logo stay on the organization (tenancy); the kit is about words. One may be the default.
 */
export const brandKits = tenantTable(
  aiSchema,
  'brand_kits',
  {
    name: text('name').notNull(),
    voice: text('voice').notNull().default(''),
    tone: text('tone').notNull().default('friendly'),
    keywords: text('keywords').array().notNull().default(sql`'{}'::text[]`),
    avoid: text('avoid').array().notNull().default(sql`'{}'::text[]`),
    isDefault: boolean('is_default').notNull().default(false),
    createdBy: text('created_by'),
  },
  (t) => [
    uniqueIndex('brand_kits_org_name_key').on(t.orgId, sql`lower(${t.name})`),
    uniqueIndex('brand_kits_org_default_key').on(t.orgId).where(sql`is_default`),
    check('brand_kits_tone_check', sql.raw(`tone in (${list(TONES)})`)),
    check('brand_kits_name_check', sql`char_length(name) between 1 and 60`),
    check('brand_kits_voice_check', sql`char_length(voice) <= 600`),
    check('brand_kits_terms_check', sql`cardinality(keywords) <= 12 and cardinality(avoid) <= 12`),
  ],
);
