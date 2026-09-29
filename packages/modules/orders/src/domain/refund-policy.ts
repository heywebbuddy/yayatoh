import { utcToZonedInput, zonedTimeToUtc } from '@yayatoh/kernel';
import { REFUND_POLICY_KINDS, type REFUND_REASONS } from '../schema.ts';

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

/** Per-event refund policy kinds (M1.6e): no refunds on request, until N days before, or always. */
export { REFUND_POLICY_KINDS };
export type RefundPolicyKind = (typeof REFUND_POLICY_KINDS)[number];

export interface RefundPolicy {
  readonly kind: RefundPolicyKind;
  /** `until` only: the last day to ask is this many calendar days before the event's start date. */
  readonly daysBefore: number | null;
  /** Kept by the organizer per refunded ticket on discretionary refunds (event currency, minor units). */
  readonly retainedMinor: number;
}

/**
 * The platform minimum (roadmap §5.3) always refunds in full, whatever the organizer's policy:
 * an organizer cancellation, or a postponement over 90 days with no new date. Duplicates and fraud
 * are not the buyer's choice either. The organizer's policy governs only discretionary refunds:
 * the buyer changed their mind, or a goodwill gesture.
 */
export const PLATFORM_MINIMUM_REASONS = ['event_cancelled', 'event_postponed'] as const;
export const DISCRETIONARY_REASONS = ['requested_by_customer', 'goodwill'] as const;
export const isDiscretionary = (r: RefundReason) => (DISCRETIONARY_REASONS as readonly string[]).includes(r);

/**
 * The instant discretionary refunds close under an `until` policy: midnight (the event's timezone)
 * at the end of the calendar day `daysBefore` days before the event's start date. `0` is "until
 * the day of the event, inclusive". Null when the policy has no deadline.
 */
export function refundDeadline(policy: RefundPolicy, eventStartsAt: Date, timeZone: string): Date | null {
  if (policy.kind !== 'until' || policy.daysBefore === null) return null;
  const startDay = utcToZonedInput(eventStartsAt, timeZone).slice(0, 10);
  const d = new Date(`${startDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - policy.daysBefore + 1);
  return zonedTimeToUtc(`${d.toISOString().slice(0, 10)}T00:00`, timeZone);
}

export type PolicyBasis = 'platform_minimum' | 'not_discretionary' | 'no_policy' | 'policy' | 'override';
export type PolicyRefusal = 'policy_no_refunds' | 'policy_window_closed';
export type PolicyDecision =
  | {
      readonly allowed: true;
      readonly basis: PolicyBasis;
      readonly retainedPerTicketMinor: number;
      readonly deadline: Date | null;
    }
  | { readonly allowed: false; readonly code: PolicyRefusal; readonly deadline: Date | null };

/**
 * Evaluate the event's refund policy for one refund (M1.6e). Staff with the override permission
 * may refund outside it (audited, with a note); nothing is retained then.
 */
export function evaluateRefundPolicy(i: {
  policy: RefundPolicy | null;
  reason: RefundReason;
  now: Date;
  eventStartsAt: Date;
  timeZone: string;
  override?: boolean;
}): PolicyDecision {
  const deadline = i.policy ? refundDeadline(i.policy, i.eventStartsAt, i.timeZone) : null;
  if ((PLATFORM_MINIMUM_REASONS as readonly string[]).includes(i.reason))
    return { allowed: true, basis: 'platform_minimum', retainedPerTicketMinor: 0, deadline };
  if (!isDiscretionary(i.reason))
    return { allowed: true, basis: 'not_discretionary', retainedPerTicketMinor: 0, deadline };
  if (!i.policy) return { allowed: true, basis: 'no_policy', retainedPerTicketMinor: 0, deadline };
  const refusal: PolicyRefusal | null =
    i.policy.kind === 'none'
      ? 'policy_no_refunds'
      : deadline && i.now >= deadline
        ? 'policy_window_closed'
        : null;
  if (refusal && !i.override) return { allowed: false, code: refusal, deadline };
  if (i.override) return { allowed: true, basis: 'override', retainedPerTicketMinor: 0, deadline };
  return { allowed: true, basis: 'policy', retainedPerTicketMinor: i.policy.retainedMinor, deadline };
}

/**
 * The refund policy stored on an order at purchase (M3.10b): what the buyer was shown. `unset`
 * when the event had none (refunds were then at the organizer's discretion).
 */
export interface PolicySnapshot {
  readonly kind: RefundPolicyKind | 'unset';
  readonly daysBefore: number | null;
  readonly retainedMinor: number;
}

export function policySnapshot(policy: RefundPolicy | null): PolicySnapshot {
  return policy
    ? { kind: policy.kind, daysBefore: policy.daysBefore, retainedMinor: policy.retainedMinor }
    : { kind: 'unset', daysBefore: null, retainedMinor: 0 };
}

export function snapshotPolicy(s: PolicySnapshot): RefundPolicy | null {
  return s.kind === 'unset'
    ? null
    : { kind: s.kind, daysBefore: s.daysBefore, retainedMinor: s.retainedMinor };
}

/**
 * How long a policy leaves discretionary refunds open, as "days before the start" (larger is
 * stricter): `always` (and no policy) −1, `until N` N, `none` +∞.
 */
function closesDaysBefore(p: RefundPolicy | null): number {
  if (!p || p.kind === 'always') return -1;
  if (p.kind === 'none') return Number.POSITIVE_INFINITY;
  return p.daysBefore ?? 0;
}

/** What a policy keeps per refunded ticket (nothing when there is no policy, or no refunds). */
const keeps = (p: RefundPolicy | null) => (!p || p.kind === 'none' ? 0 : p.retainedMinor);

/**
 * Is `next` stricter than `prev` in any way (M3.10b)? Refunds close earlier (or not at all), or
 * more is kept per ticket. No policy counts as the most generous (refunds at the organizer's
 * discretion, nothing kept). A tightening applies only to orders placed after it.
 */
export function isTighter(next: RefundPolicy | null, prev: RefundPolicy | null): boolean {
  if (closesDaysBefore(next) > closesDaysBefore(prev)) return true;
  // Keeping more only matters when refunds were possible before (from "no refunds" it's a loosening).
  return next?.kind !== 'none' && prev?.kind !== 'none' && keeps(next) > keeps(prev);
}

/** `a` is at least as generous as `b` on every count. */
export const isAtLeastAsGenerous = (a: RefundPolicy | null, b: RefundPolicy | null) => !isTighter(a, b);

/**
 * The policies that may govern an order's discretionary refunds (M3.10b): the one shown at
 * purchase and the current one; the buyer gets the better answer, so a later tightening never
 * reaches the order and a loosening does. An order bought with no policy shown (`unset`, refunds
 * at the organizer's discretion) or before snapshots existed (`null`) follows the current policy,
 * as before M3.10b: nothing was promised to hold the organizer to.
 */
export function orderPolicies(
  snapshot: PolicySnapshot | null,
  current: RefundPolicy | null,
): readonly (RefundPolicy | null)[] {
  return snapshot && snapshot.kind !== 'unset' ? [snapshotPolicy(snapshot), current] : [current];
}

/** The policy to show on an order: the one bought under, or the current one if it is as generous. */
export function displayedOrderPolicy(
  snapshot: PolicySnapshot | null,
  current: RefundPolicy | null,
): RefundPolicy | null {
  if (!snapshot || snapshot.kind === 'unset') return current;
  const bought = snapshotPolicy(snapshot);
  return isAtLeastAsGenerous(current, bought) ? current : bought;
}

/** Does an order bought under `snapshot` keep its terms when the policy becomes `next`? */
export const keepsTermsUnder = (snapshot: PolicySnapshot | null, next: RefundPolicy | null) =>
  snapshot !== null && snapshot.kind !== 'unset' && isTighter(next, snapshotPolicy(snapshot));

/**
 * Evaluate a refund for one order (M3.10b): each policy that may govern it (see `orderPolicies`)
 * is evaluated, and the buyer gets the best answer: allowed with the least kept, else the
 * refusal whose deadline is latest.
 */
export function evaluateOrderRefundPolicy(i: {
  snapshot: PolicySnapshot | null;
  current: RefundPolicy | null;
  reason: RefundReason;
  now: Date;
  eventStartsAt: Date;
  timeZone: string;
  override?: boolean;
}): PolicyDecision {
  const decisions = orderPolicies(i.snapshot, i.current).map((policy) =>
    evaluateRefundPolicy({ ...i, policy }),
  );
  let best: PolicyDecision | undefined;
  for (const d of decisions) {
    if (!best) best = d;
    else if (d.allowed && (!best.allowed || d.retainedPerTicketMinor < best.retainedPerTicketMinor)) best = d;
    else if (!d.allowed && !best.allowed && (d.deadline?.getTime() ?? 0) > (best.deadline?.getTime() ?? 0))
      best = d;
  }
  if (!best) throw new Error('no policy decision');
  return best;
}
