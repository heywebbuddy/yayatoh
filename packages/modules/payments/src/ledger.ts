import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FundsFlow } from './port.ts';
import { LEDGER_ACCOUNTS, type LedgerAccount, postings } from './schema.ts';

export interface Posting {
  readonly account: LedgerAccount;
  /** Debit positive, credit negative; integer minor units. */
  readonly amountMinor: number;
  readonly currency: string;
}

export interface JournalInput {
  /** Unique per org: the same key never posts twice. */
  readonly key: string;
  readonly kind: string;
  readonly refType: string;
  readonly refId: string;
  readonly memo?: Record<string, unknown>;
  readonly postings: readonly Posting[];
}

/**
 * Post one balanced journal through `payments.post_journal` (the only writer), inside the
 * caller's tenant transaction. Zero lines are dropped; an unbalanced journal is refused by the
 * database. Returns whether this call created it (false on an idempotent replay).
 */
export async function postJournalTx(
  tx: TenantTx,
  ctx: Ctx,
  j: JournalInput,
): Promise<{ journalId: string; created: boolean }> {
  const lines = j.postings
    .filter((p) => p.amountMinor !== 0)
    .map((p) => {
      if (!Number.isSafeInteger(p.amountMinor))
        throw new DomainError('internal', 'Ledger amounts are integers');
      return { account: p.account, amount: p.amountMinor, currency: p.currency };
    });
  const [r] = await tx.execute<{ journal_id: string; created: boolean }>(sql`
    select journal_id, created from payments.post_journal(
      ${requireOrg(ctx)}, ${j.key}, ${j.kind}, ${j.refType}, ${j.refId},
      ${ctx.now.toISOString()}::timestamptz, ${JSON.stringify(j.memo ?? {})}::jsonb, ${JSON.stringify(lines)}::jsonb
    )`);
  if (!r) throw new DomainError('internal', 'Journal not posted');
  return { journalId: r.journal_id, created: r.created };
}

/**
 * A paid order (roadmap §5.3). `platform_mor`: the platform holds the whole charge; the
 * organizer's share waits in `payable_held` until release, the fee is deferred revenue until
 * the event. `organizer_mor`: the charge is on the organizer's own account; the platform only
 * receives the application fee (the gross is kept as a memo for reconciliation).
 */
export async function postSaleTx(
  tx: TenantTx,
  ctx: Ctx,
  o: { orderId: string; fundsFlow: FundsFlow; totalMinor: number; feeMinor: number; currency: string },
) {
  if (o.totalMinor === 0) return null;
  const c = o.currency;
  const lines: Posting[] =
    o.fundsFlow === 'platform_mor'
      ? [
          { account: 'platform:stripe_cash', amountMinor: o.totalMinor, currency: c },
          { account: 'org:payable_held', amountMinor: -(o.totalMinor - o.feeMinor), currency: c },
          { account: 'platform:platform_fee_deferred', amountMinor: -o.feeMinor, currency: c },
        ]
      : [
          { account: 'platform:stripe_cash', amountMinor: o.feeMinor, currency: c },
          { account: 'platform:platform_fee_revenue', amountMinor: -o.feeMinor, currency: c },
        ];
  if (lines.every((l) => l.amountMinor === 0)) return null;
  return postJournalTx(tx, ctx, {
    key: `sale:${o.orderId}`,
    kind: 'sale',
    refType: 'order',
    refId: o.orderId,
    memo: { fundsFlow: o.fundsFlow, grossMinor: o.totalMinor, feeMinor: o.feeMinor },
    postings: lines,
  });
}

/**
 * A refund that succeeded (roadmap §5.3), before any transfer (transfers arrive in M1.6c).
 * `platform_mor`: cash goes back to the buyer; the organizer's held payable carries its share and
 * the platform its refunded fee. `organizer_mor`: the refund is on the organizer's account; the
 * platform only gives back the refunded part of its application fee.
 */
export async function postRefundTx(
  tx: TenantTx,
  ctx: Ctx,
  r: {
    refundId: string;
    orderId: string;
    fundsFlow: FundsFlow;
    amountMinor: number;
    feeRefundedMinor: number;
    currency: string;
  },
) {
  const c = r.currency;
  const lines: Posting[] =
    r.fundsFlow === 'platform_mor'
      ? [
          { account: 'platform:stripe_cash', amountMinor: -r.amountMinor, currency: c },
          { account: 'org:payable_held', amountMinor: r.amountMinor - r.feeRefundedMinor, currency: c },
          { account: 'platform:platform_fee_deferred', amountMinor: r.feeRefundedMinor, currency: c },
        ]
      : [
          { account: 'platform:stripe_cash', amountMinor: -r.feeRefundedMinor, currency: c },
          { account: 'platform:platform_fee_revenue', amountMinor: r.feeRefundedMinor, currency: c },
        ];
  if (lines.every((l) => l.amountMinor === 0)) return null;
  return postJournalTx(tx, ctx, {
    key: `refund:${r.refundId}`,
    kind: 'refund',
    refType: 'order',
    refId: r.orderId,
    memo: {
      refundId: r.refundId,
      fundsFlow: r.fundsFlow,
      amountMinor: r.amountMinor,
      feeRefundedMinor: r.feeRefundedMinor,
    },
    postings: lines,
  });
}

export const LedgerBalanceDto = z.object({
  account: z.enum(LEDGER_ACCOUNTS),
  currency: z.string(),
  /** Debit positive; organizer balances (payables) are negative, i.e. owed to the organizer. */
  balanceMinor: z.int(),
});

/** The org's ledger balances per account and currency (finance and staff). */
export const ledgerBalancesQuery = tenantQuery({
  name: 'payments.ledgerBalances',
  input: z.object({}),
  output: z.array(LedgerBalanceDto),
  entitlement: null,
  permission: 'finance:read',
  handler: async ({ tx }) => {
    const rows = await tx
      .select({
        account: postings.account,
        currency: postings.currency,
        balance: sql<string>`sum(${postings.amountMinor})`,
      })
      .from(postings)
      .groupBy(postings.account, postings.currency)
      .orderBy(postings.account, postings.currency);
    return rows.map((r) => ({
      account: r.account as LedgerAccount,
      currency: r.currency,
      balanceMinor: Number(r.balance),
    }));
  },
});
