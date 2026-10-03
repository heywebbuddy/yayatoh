/**
 * Pure giving rules (M4.8a): the processing-fee cover, gift amounts and how a donor's name
 * appears. Universal (no `node:*`): the giving page imports it in the browser to show the exact
 * fee before the donor ticks the box.
 */

/** How a donor's name appears to the host and on screens (P4-13). */
export const DISPLAY_AS = ['full_name', 'first_name', 'anonymous'] as const;
export type DisplayAs = (typeof DISPLAY_AS)[number];

/** A gift may honor or remember someone (tribute), with an optional note to a named recipient. */
export const TRIBUTE_KINDS = ['honor', 'memory'] as const;
export type TributeKind = (typeof TRIBUTE_KINDS)[number];

export const CAMPAIGN_STATUSES = ['open', 'closed'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** pending → paid | failed | expired (a payment after the hold lapsed still makes it paid). */
export const GIFT_STATUSES = ['pending', 'paid', 'failed', 'expired'] as const;
export type GiftStatus = (typeof GIFT_STATUSES)[number];

/** Where a gift came from. Paddle raise, QR-to-give and auctions arrive later (P4-16). */
export const GIFT_SOURCES = ['online'] as const;

/**
 * The card processor's rate the donor may cover (P4-10): Stripe's standard US card pricing,
 * 2.9 % + 30 minor units, charged on the connected account (direct charge). Pending owner: a
 * charity on Stripe's nonprofit rate would want its own rate here (docs/owner-inbox.md).
 */
export interface ProcessingFeeRule {
  readonly percentBps: number;
  readonly fixedMinor: number;
}
export const DEFAULT_PROCESSING_FEE: ProcessingFeeRule = { percentBps: 290, fixedMinor: 30 };

/**
 * What the donor adds so the charity receives the whole gift after the processor's fee: the
 * charge C is the smallest whole amount with C − (C·rate + fixed) ≥ gift, so the cover is
 * C − gift. Integer minor units only.
 */
export function processingFeeCover(amountMinor: number, rule: ProcessingFeeRule = DEFAULT_PROCESSING_FEE) {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return 0;
  const net = 10_000 - rule.percentBps;
  const charge = Math.ceil(((amountMinor + rule.fixedMinor) * 10_000) / net);
  return charge - amountMinor;
}

/** Hard limits on any gift: one minor unit up to 1,000,000.00 (the provider's per-charge cap is lower). */
export const GIFT_HARD_MIN_MINOR = 100;
export const GIFT_HARD_MAX_MINOR = 100_000_000;
export const DEFAULT_MIN_GIFT_MINOR = 500;
export const DEFAULT_MAX_GIFT_MINOR = 2_500_000;

/** Why an own amount is refused, if it is. */
export function giftAmountProblem(
  amountMinor: number,
  limits: { readonly minGiftMinor: number; readonly maxGiftMinor: number },
): 'amount' | 'amount_min' | 'amount_max' | null {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return 'amount';
  if (amountMinor < limits.minGiftMinor) return 'amount_min';
  if (amountMinor > limits.maxGiftMinor) return 'amount_max';
  return null;
}

/**
 * The name a gift shows to the host and (later) on screens, per the donor's choice. `null`
 * means Anonymous: the caller renders the localized word. The donor's full name is never
 * derived from an anonymous gift.
 */
export function shownName(donorName: string, displayAs: DisplayAs): string | null {
  if (displayAs === 'anonymous') return null;
  const name = donorName.trim().replace(/\s+/g, ' ');
  if (displayAs === 'first_name') return name.split(' ')[0] ?? name;
  return name;
}
