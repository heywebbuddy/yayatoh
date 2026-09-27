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
  /** The event the money belongs to (settlements release per event). */
  readonly eventId?: string | null;
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
      ${ctx.now.toISOString()}::timestamptz, ${JSON.stringify(j.memo ?? {})}::jsonb, ${JSON.stringify(lines)}::jsonb,
      ${j.eventId ?? null}::uuid
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
  o: {
    orderId: string;
    eventId: string;
    fundsFlow: FundsFlow;
    totalMinor: number;
    feeMinor: number;
    currency: string;
  },
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
    eventId: o.eventId,
    memo: { fundsFlow: o.fundsFlow, grossMinor: o.totalMinor, feeMinor: o.feeMinor },
    postings: lines,
  });
}

/** An account's balance for this org (debit positive), optionally for one event's journals. */
export async function balanceTx(
  tx: TenantTx,
  account: LedgerAccount,
  currency: string,
  eventId?: string,
): Promise<number> {
  const [r] = await tx.execute<{ b: string | null }>(sql`
    select sum(p.amount_minor)::text as b from payments.postings p
    ${eventId ? sql`join payments.journal_entries j on j.id = p.journal_id and j.event_id = ${eventId}` : sql``}
    where p.account = ${account} and p.currency = ${currency}`);
  return Number(r?.b ?? 0);
}

/**
 * A refund that succeeded (roadmap §5.3). `platform_mor`: cash goes back to the buyer and the
 * platform takes back its refunded fee; the organizer's share comes first from the event's
 * held funds, then the event's reserve, and the rest becomes a **receivable** (after a transfer:
 * the caller then attempts an explicit transfer reversal). `organizer_mor`: the refund is on the
 * organizer's own account; the platform only gives back the refunded part of its application fee.
 */
export async function postRefundTx(
  tx: TenantTx,
  ctx: Ctx,
  r: {
    refundId: string;
    orderId: string;
    eventId: string;
    fundsFlow: FundsFlow;
    amountMinor: number;
    feeRefundedMinor: number;
    currency: string;
  },
): Promise<{ receivableMinor: number }> {
  const c = r.currency;
  let lines: Posting[];
  let receivableMinor = 0;
  if (r.fundsFlow === 'platform_mor') {
    const orgShare = r.amountMinor - r.feeRefundedMinor;
    const held = Math.max(0, -(await balanceTx(tx, 'org:payable_held', c, r.eventId)));
    const fromHeld = Math.min(orgShare, held);
    const reserve = Math.max(0, -(await balanceTx(tx, 'org:reserve', c, r.eventId)));
    const fromReserve = Math.min(orgShare - fromHeld, reserve);
    receivableMinor = orgShare - fromHeld - fromReserve;
    lines = [
      { account: 'platform:stripe_cash', amountMinor: -r.amountMinor, currency: c },
      { account: 'org:payable_held', amountMinor: fromHeld, currency: c },
      { account: 'org:reserve', amountMinor: fromReserve, currency: c },
      { account: 'org:receivable', amountMinor: receivableMinor, currency: c },
      { account: 'platform:platform_fee_deferred', amountMinor: r.feeRefundedMinor, currency: c },
    ];
  } else {
    lines = [
      { account: 'platform:stripe_cash', amountMinor: -r.feeRefundedMinor, currency: c },
      { account: 'platform:platform_fee_revenue', amountMinor: r.feeRefundedMinor, currency: c },
    ];
  }
  if (lines.every((l) => l.amountMinor === 0)) return { receivableMinor: 0 };
  await postJournalTx(tx, ctx, {
    key: `refund:${r.refundId}`,
    kind: 'refund',
    refType: 'order',
    refId: r.orderId,
    eventId: r.eventId,
    memo: {
      refundId: r.refundId,
      fundsFlow: r.fundsFlow,
      amountMinor: r.amountMinor,
      feeRefundedMinor: r.feeRefundedMinor,
      receivableMinor,
    },
    postings: lines,
  });
  return { receivableMinor };
}

/** A transfer reversal succeeded: the organizer's debt is paid back from their account. */
export async function postTransferReversalTx(
  tx: TenantTx,
  ctx: Ctx,
  r: {
    refundId: string;
    orderId: string;
    eventId: string;
    amountMinor: number;
    currency: string;
    reversalId: string;
  },
) {
  return postJournalTx(tx, ctx, {
    key: `reversal:${r.refundId}`,
    kind: 'transfer_reversal',
    refType: 'order',
    refId: r.orderId,
    eventId: r.eventId,
    memo: { refundId: r.refundId, reversalId: r.reversalId },
    postings: [
      { account: 'platform:stripe_cash', amountMinor: r.amountMinor, currency: r.currency },
      { account: 'org:receivable', amountMinor: -r.amountMinor, currency: r.currency },
    ],
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
