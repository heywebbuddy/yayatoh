/**
 * Pure matching-gift rules (M4.8f, P4-17). A challenge match is a sponsor's promise to match the
 * campaign's confirmed gifts made in a window, at a ratio, up to a cap; what it comes to becomes
 * the sponsor's own pledge. Universal (no `node:*`): the console and the giving page format with it.
 */

/**
 * `active` while it runs (before, during or after its window, until the host acts); `closed` once
 * the host recorded the sponsor's pledge; `cancelled` when withdrawn before that.
 */
export const MATCH_STATUSES = ['active', 'closed', 'cancelled'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** Where an active match stands at a moment: before its window, in it, or after it. */
export type MatchPhase = 'scheduled' | 'live' | 'ended';

/**
 * The ratio as the sponsor's amount per 100 of gifts: 100 is 1:1 ("every gift doubled"), 200 is
 * 2:1 (tripled), 50 is 1:2 (half). The console offers these; the store accepts 1–1,000.
 */
export const MATCH_RATIOS = [50, 100, 200, 300] as const;
export const MATCH_RATIO_MIN = 1;
export const MATCH_RATIO_MAX = 1_000;

/** A cap from 1.00 up to 10,000,000.00 (minor units). */
export const MATCH_CAP_MIN_MINOR = 100;
export const MATCH_CAP_MAX_MINOR = 1_000_000_000;

/** At most this many matches per campaign (cancelled ones included). */
export const MAX_MATCHES_PER_CAMPAIGN = 20;

/**
 * What one confirmed gift counts toward a match: its amount less whatever of it was refunded.
 * A refund takes back the whole charge (gift plus the fee the donor covered) first from the fee
 * cover, then from the gift; never below zero.
 */
export function matchableAmount(gift: {
  readonly amountMinor: number;
  readonly feeCoverMinor: number;
  readonly refundedMinor: number;
}): number {
  const fromGift = Math.max(0, gift.refundedMinor - gift.feeCoverMinor);
  return Math.max(0, gift.amountMinor - fromGift);
}

/**
 * The sponsor's match of `eligibleMinor` (the confirmed gifts in the window): the ratio applied to
 * the sum, rounded down to the minor unit, and never above the cap. Exact integer arithmetic.
 */
export function matchedAmount(eligibleMinor: number, ratioPercent: number, capMinor: number): number {
  if (eligibleMinor <= 0 || ratioPercent <= 0 || capMinor <= 0) return 0;
  const raw = (BigInt(Math.trunc(eligibleMinor)) * BigInt(ratioPercent)) / 100n;
  return Number(raw < BigInt(capMinor) ? raw : BigInt(capMinor));
}

/** Gifts still needed in the window to use the whole cap (0 once it is reached). */
export function remainingToCap(eligibleMinor: number, ratioPercent: number, capMinor: number): number {
  if (ratioPercent <= 0) return 0;
  const needed = (BigInt(capMinor) * 100n + BigInt(ratioPercent) - 1n) / BigInt(ratioPercent);
  const left = needed - BigInt(Math.max(0, Math.trunc(eligibleMinor)));
  return left > 0n ? Number(left) : 0;
}

/** Whether `at` falls in the window: from `startsAt` (included) to `endsAt` (excluded). */
export const inWindow = (at: Date, w: { readonly startsAt: Date; readonly endsAt: Date }) =>
  at.getTime() >= w.startsAt.getTime() && at.getTime() < w.endsAt.getTime();

export function matchPhase(now: Date, w: { readonly startsAt: Date; readonly endsAt: Date }): MatchPhase {
  if (now.getTime() < w.startsAt.getTime()) return 'scheduled';
  return now.getTime() < w.endsAt.getTime() ? 'live' : 'ended';
}

/**
 * After a refund or a cancelled pledge, the sponsor's recorded pledge follows the match down, never
 * up (Yayatoh never asks a sponsor for more than they pledged, P4-12). `null` means cancel it.
 */
export function resyncedPledge(currentMinor: number, recomputedMinor: number): number | null {
  const next = Math.min(currentMinor, recomputedMinor);
  return next > 0 ? next : null;
}
