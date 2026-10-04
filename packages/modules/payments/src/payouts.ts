import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { sql } from 'drizzle-orm';
import { RELEASE_POLICY, releaseDate } from './settlements.ts';

/**
 * Read-only payout facts for the Money dashboards (U5). Everything here reads the ledger
 * (`journal_entries` + `postings`) and `settlements` inside the caller's tenant transaction; no
 * money moves. Amounts are integer minor units per currency, never summed across currencies.
 */

const n = (v: unknown) => Number(v ?? 0);
const date = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));

export interface HeldFundsFact {
  readonly eventId: string;
  readonly currency: string;
  /** The organizer's share still held for the event (positive). */
  readonly heldMinor: number;
  /** What the release keeps back as reserve (5 %), and so what is expected to be paid out. */
  readonly reserveMinor: number;
  readonly expectedMinor: number;
  /** When the release job may release it (5 business days after the event ends). */
  readonly releaseAt: Date;
}

/** Funds held per event and currency (platform_mor), with the date each becomes releasable. */
export async function heldFundsTx(tx: TenantTx): Promise<HeldFundsFact[]> {
  const rows = await tx.execute<{ event_id: string; currency: string; held: string }>(sql`
    select j.event_id, p.currency, (-sum(p.amount_minor))::text as held
    from payments.postings p join payments.journal_entries j on j.id = p.journal_id
    where p.account = 'org:payable_held' and j.event_id is not null
    group by j.event_id, p.currency having sum(p.amount_minor) < 0
    order by j.event_id, p.currency`);
  const out: HeldFundsFact[] = [];
  for (const r of rows) {
    const event = await findEventTx(tx, r.event_id);
    if (!event) continue;
    const held = n(r.held);
    const reserve = Math.floor((held * RELEASE_POLICY.reserveBps) / 10_000);
    out.push({
      eventId: r.event_id,
      currency: r.currency,
      heldMinor: held,
      reserveMinor: reserve,
      expectedMinor: held - reserve,
      releaseAt: releaseDate(event.endsAt),
    });
  }
  return out.sort((a, b) => a.releaseAt.getTime() - b.releaseAt.getTime());
}

export interface ReserveFact {
  /** The event settlement that kept the reserve. */
  readonly settlementId: string;
  readonly eventId: string | null;
  readonly currency: string;
  /** Kept at release. */
  readonly reserveMinor: number;
  /** What is left after refunds drew on it (what the reserve release will pay, before netting). */
  readonly leftMinor: number;
  readonly releaseAt: Date;
}

/** Reserves kept at release and not released yet, soonest first. */
export async function reservesHeldTx(tx: TenantTx): Promise<ReserveFact[]> {
  const rows = await tx.execute<{
    id: string;
    event_id: string | null;
    currency: string;
    reserve: string;
    release_at: Date;
    left: string | null;
  }>(sql`
    select s.id, s.event_id, s.currency, s.reserve_minor::text as reserve, s.reserve_release_at as release_at,
      (select (-sum(p.amount_minor))::text from payments.postings p
        join payments.journal_entries j on j.id = p.journal_id
        where p.account = 'org:reserve' and p.currency = s.currency and j.event_id = s.event_id) as left
    from payments.settlements s
    where s.kind = 'event' and s.reserve_minor > 0 and s.reserve_released_at is null
      and s.reserve_release_at is not null
    order by s.reserve_release_at, s.id`);
  return rows.map((r) => ({
    settlementId: r.id,
    eventId: r.event_id,
    currency: r.currency,
    reserveMinor: n(r.reserve),
    leftMinor: Math.min(n(r.reserve), Math.max(0, n(r.left))),
    releaseAt: date(r.release_at),
  }));
}

export type PayoutLineKind = 'sale' | 'refund';

export interface PayoutLineFact {
  readonly journalId: string;
  readonly kind: PayoutLineKind;
  readonly orderId: string;
  /** Set on refund lines. */
  readonly refundId: string | null;
  readonly occurredAt: Date;
  /** What the buyer paid (sale, positive) or got back (refund, negative). */
  readonly grossMinor: number;
  /** The platform fee taken (sale, positive) or given back (refund, negative). */
  readonly feeMinor: number;
  /** The organizer's share this line added to (sale) or took from (refund) the held funds. */
  readonly organizerMinor: number;
}

export interface SettlementLinesFact {
  readonly settlementId: string;
  readonly kind: 'event' | 'reserve';
  readonly eventId: string | null;
  readonly currency: string;
  readonly status: 'ready' | 'waiting_account' | 'transferred' | 'failed';
  readonly releasedMinor: number;
  readonly reserveMinor: number;
  readonly nettedMinor: number;
  readonly amountMinor: number;
  readonly releasedAt: Date;
  readonly transferredAt: Date | null;
  readonly reserveReleaseAt: Date | null;
  /** For a reserve release: the event settlement whose reserve it pays out. */
  readonly reserveOfSettlementId: string | null;
  readonly lines: readonly PayoutLineFact[];
}

/**
 * What one settlement paid out, line by line (U5 drill-down). An event settlement releases the
 * event's held funds: every journal that moved `org:payable_held` for that event and currency
 * after the previous release and before this one (journal ids are time-ordered uuidv7). The
 * lines' organizer shares sum to the settlement's `releasedMinor`. A reserve release has no
 * lines of its own; it names the event settlement that kept the reserve.
 */
export async function settlementLinesTx(
  tx: TenantTx,
  settlementId: string,
): Promise<SettlementLinesFact | null> {
  const [s] = await tx.execute<{
    id: string;
    kind: 'event' | 'reserve';
    event_id: string | null;
    currency: string;
    status: SettlementLinesFact['status'];
    released: string;
    reserve: string;
    netted: string;
    amount: string;
    released_at: Date;
    transferred_at: Date | null;
    reserve_release_at: Date | null;
  }>(sql`
    select id, kind, event_id, currency, status, released_minor::text as released, reserve_minor::text as reserve,
      netted_minor::text as netted, amount_minor::text as amount, released_at, transferred_at, reserve_release_at
    from payments.settlements where id = ${settlementId}::uuid`);
  if (!s) return null;
  const base = {
    settlementId: s.id,
    kind: s.kind,
    eventId: s.event_id,
    currency: s.currency,
    status: s.status,
    releasedMinor: n(s.released),
    reserveMinor: n(s.reserve),
    nettedMinor: n(s.netted),
    amountMinor: n(s.amount),
    releasedAt: date(s.released_at),
    transferredAt: s.transferred_at ? date(s.transferred_at) : null,
    reserveReleaseAt: s.reserve_release_at ? date(s.reserve_release_at) : null,
  };
  if (s.kind === 'reserve') {
    const [origin] = await tx.execute<{ id: string }>(sql`
      select id from payments.settlements
      where kind = 'event' and event_id is not distinct from ${s.event_id}::uuid and currency = ${s.currency}
        and reserve_released_at = ${date(s.released_at).toISOString()}::timestamptz
      order by released_at desc limit 1`);
    return { ...base, reserveOfSettlementId: origin?.id ?? null, lines: [] };
  }
  const [rel] = await tx.execute<{ id: string }>(sql`
    select id from payments.journal_entries
    where kind = 'release' and ref_type = 'settlement' and ref_id = ${s.id}::uuid`);
  if (!rel) return { ...base, reserveOfSettlementId: null, lines: [] };
  const rows = await tx.execute<{
    id: string;
    kind: string;
    ref_id: string;
    occurred_at: Date;
    memo: Record<string, unknown>;
    held: string;
    fee: string | null;
    cash: string | null;
  }>(sql`
    with prev as (
      select j.id from payments.journal_entries j
      join payments.postings p on p.journal_id = j.id
      where j.kind = 'release' and j.event_id = ${s.event_id}::uuid and p.account = 'org:payable_held'
        and p.currency = ${s.currency} and j.id < ${rel.id}::uuid
      order by j.id desc limit 1
    )
    select j.id, j.kind, j.ref_id, j.occurred_at, j.memo,
      sum(p.amount_minor) filter (where p.account = 'org:payable_held')::text as held,
      sum(p.amount_minor) filter (where p.account = 'platform:platform_fee_deferred')::text as fee,
      sum(p.amount_minor) filter (where p.account = 'platform:stripe_cash')::text as cash
    from payments.journal_entries j join payments.postings p on p.journal_id = j.id and p.currency = ${s.currency}
    where j.event_id = ${s.event_id}::uuid and j.kind in ('sale', 'refund') and j.id < ${rel.id}::uuid
      and j.id > coalesce((select id from prev), '00000000-0000-0000-0000-000000000000'::uuid)
    group by j.id, j.kind, j.ref_id, j.occurred_at, j.memo
    having sum(p.amount_minor) filter (where p.account = 'org:payable_held') is not null
    order by j.id`);
  return {
    ...base,
    reserveOfSettlementId: null,
    lines: rows.map((r) => ({
      journalId: r.id,
      kind: r.kind === 'refund' ? 'refund' : 'sale',
      orderId: r.ref_id,
      refundId: typeof r.memo?.refundId === 'string' ? r.memo.refundId : null,
      occurredAt: date(r.occurred_at),
      // Cash in (sale, debit) or out (refund, credit) is what the buyer paid or got back.
      grossMinor: n(r.cash),
      // The deferred fee is credited on a sale (negative) and debited back on a refund.
      feeMinor: -n(r.fee) || 0,
      organizerMinor: -n(r.held) || 0,
    })),
  };
}

export interface PayoutTotalFact {
  readonly currency: string;
  readonly payouts: number;
  readonly amountMinor: number;
}

/** Money transferred to the organizer in [from, to) per currency (settlements marked transferred). */
export async function payoutTotalsTx(
  tx: TenantTx,
  scope: { readonly from?: Date; readonly to?: Date },
): Promise<PayoutTotalFact[]> {
  const rows = await tx.execute<{ currency: string; payouts: number; amount: string }>(sql`
    select currency, count(*)::int as payouts, sum(amount_minor)::text as amount
    from payments.settlements
    where status = 'transferred' and amount_minor > 0 and transferred_at is not null
      ${scope.from ? sql`and transferred_at >= ${scope.from.toISOString()}::timestamptz` : sql``}
      ${scope.to ? sql`and transferred_at < ${scope.to.toISOString()}::timestamptz` : sql``}
    group by currency order by currency`);
  return rows.map((r) => ({ currency: r.currency, payouts: n(r.payouts), amountMinor: n(r.amount) }));
}

/** Events with a dispute lost in [from, to) (so per-event money covers events with no sales then). */
export async function lostDisputeEventIdsTx(
  tx: TenantTx,
  scope: { readonly from?: Date; readonly to?: Date },
): Promise<string[]> {
  const rows = await tx.execute<{ event_id: string }>(sql`
    select distinct event_id from payments.disputes
    where status = 'lost' and event_id is not null
      ${scope.from ? sql`and closed_at >= ${scope.from.toISOString()}::timestamptz` : sql``}
      ${scope.to ? sql`and closed_at < ${scope.to.toISOString()}::timestamptz` : sql``}`);
  return rows.map((r) => r.event_id);
}
