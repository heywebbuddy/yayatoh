/**
 * Cancellation money (M3.10b): what refunding everyone would give back, per order and in total,
 * before anything moves. Pure: the wizard's preview and the batch use the same rules as a single
 * refund with the platform minimum (roadmap §5.3): every live ticket back at its all-in price with
 * the platform fee.
 */

export type FundsFlow = 'organizer_mor' | 'platform_mor';

export interface PreviewOrder {
  readonly id: string;
  readonly fundsFlow: FundsFlow;
  readonly collectedBy: 'platform' | 'organizer';
  readonly status: string;
  readonly totalMinor: number;
  readonly feeMinor: number;
  /** Refunds already made or on their way (succeeded + pending). */
  readonly refundedMinor: number;
  /** The platform fee already given back by them. */
  readonly feeRefundedMinor: number;
  /** A chargeback is still open on the payment. */
  readonly disputed: boolean;
  /** Live tickets per order line, with what one of them was paid (all-in) and its fee part. */
  readonly live: readonly {
    readonly count: number;
    readonly unitAllInMinor: number;
    readonly unitFeeMinor: number;
  }[];
}

export type OrderRefundPlan =
  | { readonly kind: 'tickets'; readonly amountMinor: number; readonly feeRefundedMinor: number }
  | { readonly kind: 'amount'; readonly amountMinor: number; readonly feeRefundedMinor: number }
  | { readonly kind: 'none' };

const SOLD = ['paid', 'partially_refunded'];

/** The fee still to give back with an amount refund of `amountMinor` (never more than the amount). */
export const amountFeeBack = (o: Pick<PreviewOrder, 'feeMinor' | 'feeRefundedMinor'>, amountMinor: number) =>
  Math.max(0, Math.min(o.feeMinor - o.feeRefundedMinor, amountMinor));

/**
 * What cancelling refunds on one order: its live tickets in full (face + fee), or — when earlier
 * partial refunds leave less than that — whatever is left, as an amount, with whatever of the
 * platform fee has not gone back yet (the platform minimum returns the fee). Nothing when nothing
 * is left to refund.
 */
export function cancellationRefund(o: PreviewOrder): OrderRefundPlan {
  const left = o.totalMinor - o.refundedMinor;
  if (!SOLD.includes(o.status) || left <= 0) return { kind: 'none' };
  const tickets = o.live.reduce((n, l) => n + l.count * l.unitAllInMinor, 0);
  const fee = o.live.reduce((n, l) => n + l.count * l.unitFeeMinor, 0);
  if (tickets > 0 && tickets <= left) return { kind: 'tickets', amountMinor: tickets, feeRefundedMinor: fee };
  return { kind: 'amount', amountMinor: left, feeRefundedMinor: amountFeeBack(o, left) };
}

export interface FlowTotals {
  orders: number;
  /** What buyers get back. */
  amountMinor: number;
  /** The platform fee given back with it. */
  feeBackMinor: number;
  /** The organizer's share of it (amount less fee back): from their funds, or their own account. */
  organizerMinor: number;
}

export interface CancellationPreview {
  /** Paid (or partly refunded) orders with money on them. */
  orders: number;
  grossMinor: number;
  feesMinor: number;
  alreadyRefundedMinor: number;
  /** What the mass refund will refund (disputed charges and organizer-collected orders excluded). */
  refund: FlowTotals;
  byFlow: Record<FundsFlow, FlowTotals>;
  /** Left out: an open chargeback (refunding would pay the buyer twice). */
  disputed: { orders: number; grossMinor: number };
  /** Left out: box office and other money the organizer collected (refunded in person). */
  organizerCollected: { orders: number; grossMinor: number };
  /** Already fully refunded. */
  nothingLeft: number;
}

const zero = (): FlowTotals => ({ orders: 0, amountMinor: 0, feeBackMinor: 0, organizerMinor: 0 });

export function cancellationPreview(list: readonly PreviewOrder[]): CancellationPreview {
  const p: CancellationPreview = {
    orders: 0,
    grossMinor: 0,
    feesMinor: 0,
    alreadyRefundedMinor: 0,
    refund: zero(),
    byFlow: { organizer_mor: zero(), platform_mor: zero() },
    disputed: { orders: 0, grossMinor: 0 },
    organizerCollected: { orders: 0, grossMinor: 0 },
    nothingLeft: 0,
  };
  for (const o of list) {
    if (!SOLD.includes(o.status) || o.totalMinor <= 0) continue;
    p.orders += 1;
    p.grossMinor += o.totalMinor;
    p.feesMinor += o.feeMinor;
    p.alreadyRefundedMinor += o.refundedMinor;
    if (o.collectedBy === 'organizer') {
      p.organizerCollected.orders += 1;
      p.organizerCollected.grossMinor += o.totalMinor;
      continue;
    }
    if (o.disputed) {
      p.disputed.orders += 1;
      p.disputed.grossMinor += o.totalMinor;
      continue;
    }
    const plan = cancellationRefund(o);
    if (plan.kind === 'none') {
      p.nothingLeft += 1;
      continue;
    }
    for (const t of [p.refund, p.byFlow[o.fundsFlow]]) {
      t.orders += 1;
      t.amountMinor += plan.amountMinor;
      t.feeBackMinor += plan.feeRefundedMinor;
      t.organizerMinor += plan.amountMinor - plan.feeRefundedMinor;
    }
  }
  return p;
}
