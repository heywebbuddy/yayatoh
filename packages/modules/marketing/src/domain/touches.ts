import type { Touch } from './window.ts';

/**
 * The touch path of an order (M6.2b multi-touch attribution). Pure: the checkout hook and the
 * tests share it.
 *
 * - A **click** touch is one counting click (the order's event, inside the window: `pickTouches`
 *   rules), with its tracked link's UTM values and campaign.
 * - A **utm** touch is a landing with UTM values and no click id (the `yy_utm` cookie keeps the
 *   first and the last one, so a UTM path has at most two touches).
 * - A **referral** touch is a landing from another site without UTM values: the referring host
 *   as the source and `referral` as the medium (`referralUtm`), kept in the same cookie.
 * Paths are in time order (ties by click id). A path keeps at most `MAX_TOUCHES`: the first touch
 * and the latest `MAX_TOUCHES - 1` (first touch credit never moves).
 */
export const TOUCH_KINDS = ['click', 'utm', 'referral'] as const;
export type TouchKind = (typeof TOUCH_KINDS)[number];
export const MAX_TOUCHES = 50;
/** The medium a referral landing is recorded with (the usual analytics convention). */
export const REFERRAL_MEDIUM = 'referral';

/** Counting clicks in path order, capped at `MAX_TOUCHES` (the first and the latest ones). */
export function clickPath<T extends Touch>(counting: readonly T[]): T[] {
  const sorted = [...counting].sort(
    (a, b) => a.clickedAt.getTime() - b.clickedAt.getTime() || a.clickId.localeCompare(b.clickId),
  );
  if (sorted.length <= MAX_TOUCHES) return sorted;
  return [sorted[0] as T, ...sorted.slice(sorted.length - (MAX_TOUCHES - 1))];
}

/** A landing's kind: a referral (medium `referral`, no campaign) or a UTM landing. */
export const landingKind = (utm: { medium: string | null; campaign: string | null }): TouchKind =>
  utm.medium === REFERRAL_MEDIUM && !utm.campaign ? 'referral' : 'utm';
