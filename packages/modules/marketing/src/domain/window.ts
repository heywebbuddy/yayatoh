/**
 * Attribution rules (M3.8a). Pure: the command and the tests share them.
 *
 * - A click counts for an order when it is for the order's event and happened inside the window
 *   before the order: `orderAt - window <= clickedAt <= orderAt` (a click after the order never
 *   counts; a small clock skew allowance covers the redirect and the checkout on different nodes).
 * - First touch is the earliest counting click, last touch the latest (they may be the same).
 * - Without a counting click, the UTM values the buyer landed with (inside the same window) give a
 *   `utm` attribution; without either there is no record.
 */

export const ATTRIBUTION_MODELS = ['click', 'utm'] as const;
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];

/** Default window (pending owner, docs/owner-inbox.md). */
export const DEFAULT_WINDOW_DAYS = 30;
export const MIN_WINDOW_DAYS = 1;
export const MAX_WINDOW_DAYS = 90;
export const DAY_MS = 24 * 60 * 60 * 1000;
/** Clicks stamped up to this far after the order (clock skew between nodes) still count. */
export const CLOCK_SKEW_MS = 2 * 60 * 1000;

export interface Touch {
  readonly clickId: string;
  readonly linkId: string;
  readonly eventId: string;
  readonly clickedAt: Date;
}

/** Whether a click time falls inside the window that ends at `orderAt`. */
export function inWindow(clickedAt: Date, orderAt: Date, windowDays: number): boolean {
  const t = clickedAt.getTime();
  const end = orderAt.getTime();
  return t >= end - windowDays * DAY_MS && t <= end + CLOCK_SKEW_MS;
}

/** First and last touch among the clicks that count for this order, or null when none does. */
export function pickTouches(
  clicks: readonly Touch[],
  order: { eventId: string; at: Date },
  windowDays: number,
): { first: Touch; last: Touch } | null {
  const counting = clicks
    .filter((c) => c.eventId === order.eventId && inWindow(c.clickedAt, order.at, windowDays))
    .sort((a, b) => a.clickedAt.getTime() - b.clickedAt.getTime() || a.clickId.localeCompare(b.clickId));
  const first = counting[0];
  const last = counting[counting.length - 1];
  return first && last ? { first, last } : null;
}

/** Conversion in basis points (orders per click); 0 without clicks. */
export function conversionBps(orders: number, clicks: number): number {
  return clicks > 0 ? Math.round((orders * 10_000) / clicks) : 0;
}
