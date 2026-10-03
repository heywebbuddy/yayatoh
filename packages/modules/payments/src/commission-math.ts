/**
 * Agency commission arithmetic (M6.8a), pure and in integer minor units.
 *
 * - The commission on a sale is `floor(base × bps / 10 000)`, where `base` is the organizer's share
 *   (the order total less the platform fee).
 * - Refunds reverse it **proportionally to the refunded amount, cumulatively**: after refunds
 *   giving back `refunded` of the organizer's share `base` (each refund's amount less the platform
 *   fee it returns), the reversed commission is `floor(commission × refunded / base)`, and exactly
 *   the whole commission once the whole share is refunded. Each refund reverses the difference with what earlier refunds reversed, so partial
 *   refunds add up to the cent and never reverse more than was earned.
 */
export function commissionFor(baseMinor: number, bps: number): number {
  if (!Number.isSafeInteger(baseMinor) || !Number.isInteger(bps)) throw new Error('integer amounts only');
  if (baseMinor <= 0 || bps <= 0) return 0;
  return Number((BigInt(baseMinor) * BigInt(bps)) / 10_000n);
}

/** The commission reversed in total once `refundedMinor` of the organizer's share `baseMinor` is refunded. */
export function cumulativeReversal(
  commissionMinor: number,
  baseMinor: number,
  refundedMinor: number,
): number {
  if (commissionMinor <= 0 || baseMinor <= 0 || refundedMinor <= 0) return 0;
  if (refundedMinor >= baseMinor) return commissionMinor;
  return Number((BigInt(commissionMinor) * BigInt(refundedMinor)) / BigInt(baseMinor));
}

/**
 * What this refund reverses: the cumulative target after it, less what earlier refunds already
 * reversed (never negative).
 */
export function reversalForRefund(o: {
  commissionMinor: number;
  baseMinor: number;
  refundedBeforeMinor: number;
  refundMinor: number;
  reversedBeforeMinor: number;
}): number {
  const target = cumulativeReversal(o.commissionMinor, o.baseMinor, o.refundedBeforeMinor + o.refundMinor);
  return Math.max(0, target - o.reversedBeforeMinor);
}

/**
 * Split a reversal between commission not yet transferred (taken back in the ledger) and
 * commission already transferred (an explicit transfer reversal from the agency; whatever fails
 * stays owed by the agency).
 */
export function splitReversal(reversalMinor: number, untransferredMinor: number) {
  const fromHeld = Math.max(0, Math.min(reversalMinor, untransferredMinor));
  return { fromHeldMinor: fromHeld, afterTransferMinor: reversalMinor - fromHeld };
}

/** Kinds of agency commission movements (the client's journals and the agency's mirror journals). */
export const COMMISSION_ENTRY_KINDS = [
  /** A sale earned commission. */
  'accrued',
  /** A refund took back commission not transferred yet. */
  'reversed',
  /** A refund took back commission already transferred: the agency owes it until reversed. */
  'clawback',
  /** The commission was transferred to the agency (a second transfer in the event's group). */
  'transferred',
  /** What the agency owed was netted from its next commission. */
  'netted',
  /** The explicit transfer reversal succeeded: what the agency owed is paid back. */
  'clawback_paid',
] as const;
export type CommissionEntryKind = (typeof COMMISSION_ENTRY_KINDS)[number];

/**
 * The agency's mirror postings for a movement (its own ledger, never platform cash): `due` is
 * earned and not yet transferred, `earned` its income (credit), `paid` what reached its account,
 * `clawback` what it owes back (credit).
 */
export function mirrorPostings(
  kind: CommissionEntryKind,
  amountMinor: number,
): readonly { account: string; amountMinor: number }[] {
  const a = amountMinor;
  switch (kind) {
    case 'accrued':
      return [
        { account: 'agency:commission_due', amountMinor: a },
        { account: 'agency:commission_earned', amountMinor: -a },
      ];
    case 'reversed':
      return [
        { account: 'agency:commission_earned', amountMinor: a },
        { account: 'agency:commission_due', amountMinor: -a },
      ];
    case 'clawback':
      return [
        { account: 'agency:commission_earned', amountMinor: a },
        { account: 'agency:commission_clawback', amountMinor: -a },
      ];
    case 'transferred':
      return [
        { account: 'agency:commission_paid', amountMinor: a },
        { account: 'agency:commission_due', amountMinor: -a },
      ];
    case 'netted':
      return [
        { account: 'agency:commission_clawback', amountMinor: a },
        { account: 'agency:commission_due', amountMinor: -a },
      ];
    case 'clawback_paid':
      return [
        { account: 'agency:commission_clawback', amountMinor: a },
        { account: 'agency:commission_paid', amountMinor: -a },
      ];
  }
}
