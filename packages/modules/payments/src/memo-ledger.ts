import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { journalEntries } from './schema.ts';

/**
 * Memo entries (M4.8g): money that never touches a platform account but that the ledger must
 * still remember, for reports and reconciliation. A gift is a direct charge on the charity's own
 * connected account with no application fee (P4-9, P4-10), so it posts no balanced journal; it
 * gets a memo-only journal instead (no postings), written by `payments.post_memo` (the only writer,
 * which accepts these kinds only). Balances and the platform reconciliation (M1.6e) ignore them.
 */
export const MEMO_JOURNAL_KINDS = ['donation_memo', 'donation_refund_memo'] as const;
export type MemoJournalKind = (typeof MEMO_JOURNAL_KINDS)[number];

async function postMemoTx(
  tx: TenantTx,
  ctx: Ctx,
  m: {
    key: string;
    kind: MemoJournalKind;
    refId: string;
    eventId: string;
    memo: Record<string, unknown>;
  },
): Promise<{ journalId: string; created: boolean }> {
  const [r] = await tx.execute<{ journal_id: string; created: boolean }>(sql`
    select journal_id, created from payments.post_memo(
      ${requireOrg(ctx)}, ${m.key}, ${m.kind}, 'order', ${m.refId},
      ${ctx.now.toISOString()}::timestamptz, ${JSON.stringify(m.memo)}::jsonb, ${m.eventId}::uuid
    )`);
  if (!r) throw new DomainError('internal', 'Memo not posted');
  return { journalId: r.journal_id, created: r.created };
}

const assertMinor = (n: number) => {
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new DomainError('internal', 'Memo amounts are positive integers');
};

/** A gift paid on the charity's connected account: its gross (gift plus any covered fee). */
export async function postDonationMemoTx(
  tx: TenantTx,
  ctx: Ctx,
  o: {
    orderId: string;
    eventId: string;
    grossMinor: number;
    currency: string;
    connectedAccountId: string | null;
  },
) {
  assertMinor(o.grossMinor);
  return postMemoTx(tx, ctx, {
    key: `donation:${o.orderId}`,
    kind: 'donation_memo',
    refId: o.orderId,
    eventId: o.eventId,
    memo: {
      fundsFlow: 'organizer_mor',
      connectedAccountId: o.connectedAccountId,
      grossMinor: o.grossMinor,
      currency: o.currency,
    },
  });
}

/** A refund of a gift that succeeded on the charity's connected account. */
export async function postDonationRefundMemoTx(
  tx: TenantTx,
  ctx: Ctx,
  r: { refundId: string; orderId: string; eventId: string; amountMinor: number; currency: string },
) {
  assertMinor(r.amountMinor);
  return postMemoTx(tx, ctx, {
    key: `donation_refund:${r.refundId}`,
    kind: 'donation_refund_memo',
    refId: r.orderId,
    eventId: r.eventId,
    memo: { refundId: r.refundId, amountMinor: r.amountMinor, currency: r.currency },
  });
}

/** One memo entry as reports read it: signed (refunds negative), with the provider reference. */
export interface MemoEntry {
  readonly kind: MemoJournalKind;
  readonly orderId: string;
  /** What the provider calls the same money: `order:<id>` or `refund:<id>`. */
  readonly reference: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly occurredAt: Date;
  /** A gift's: the connected account it was charged on. */
  readonly connectedAccountId: string | null;
}

/** An event's memo entries (oldest first), optionally only some orders'. */
export async function memoEntriesTx(
  tx: TenantTx,
  eventId: string,
  orderIds?: readonly string[],
): Promise<MemoEntry[]> {
  if (orderIds && orderIds.length === 0) return [];
  const rows = await tx
    .select({
      kind: journalEntries.kind,
      refId: journalEntries.refId,
      occurredAt: journalEntries.occurredAt,
      memo: journalEntries.memo,
    })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.eventId, eventId),
        inArray(journalEntries.kind, [...MEMO_JOURNAL_KINDS]),
        orderIds ? inArray(journalEntries.refId, [...orderIds]) : undefined,
      ),
    )
    .orderBy(asc(journalEntries.occurredAt), asc(journalEntries.id));
  return rows.map((r) => {
    const m = r.memo as {
      grossMinor?: number;
      amountMinor?: number;
      currency?: string;
      refundId?: string;
      connectedAccountId?: string | null;
    };
    const refund = r.kind === 'donation_refund_memo';
    return {
      kind: r.kind as MemoJournalKind,
      orderId: r.refId,
      reference: refund ? `refund:${m.refundId}` : `order:${r.refId}`,
      amountMinor: refund ? -Number(m.amountMinor ?? 0) : Number(m.grossMinor ?? 0),
      currency: String(m.currency ?? ''),
      occurredAt: r.occurredAt,
      connectedAccountId: m.connectedAccountId ?? null,
    };
  });
}
