import type { REFUND_REASONS } from '../schema.ts';

export type RefundReason = (typeof REFUND_REASONS)[number];

/**
 * Whether the platform fee goes back with a refund (roadmap §5.3). The platform minimum: an
 * organizer cancellation, or a postponement over 90 days with no new date, refunds 100% of face
 * value plus the fee. Duplicates and fraud are not the buyer's doing either. A buyer's own request
 * and goodwill keep the fee — the default until the owner settles D3 (fee-refund policy).
 */
export function refundsFee(reason: RefundReason): boolean {
  return reason !== 'requested_by_customer' && reason !== 'goodwill';
}

export interface PaidUnit {
  readonly unitAllInMinor: number;
  readonly unitFeeMinor: number;
  readonly unitFaceMinor: number;
  readonly unitDiscountMinor: number;
}

/**
 * What one ticket refunds: the buyer gets back what they paid, less the fee when the fee is kept
 * and was added on top (pass-on). When the organizer absorbed the fee, the buyer gets the whole
 * price and the organizer carries the kept fee.
 */
export function ticketRefund(
  u: PaidUnit,
  feeBack: boolean,
): { amountMinor: number; feeRefundedMinor: number } {
  const passOn = u.unitAllInMinor - u.unitFeeMinor === u.unitFaceMinor - u.unitDiscountMinor;
  return feeBack
    ? { amountMinor: u.unitAllInMinor, feeRefundedMinor: u.unitFeeMinor }
    : { amountMinor: u.unitAllInMinor - (passOn ? u.unitFeeMinor : 0), feeRefundedMinor: 0 };
}
