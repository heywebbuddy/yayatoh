/**
 * Pure rules of the live giving screen (M4.8d): who is thanked by name, and how full the
 * thermometer is. Universal (no `node:*`): the screen's client component imports it.
 */
import { type DisplayAs, shownName } from './giving.ts';

/** How many names the screen's thank-you list holds (newest first). */
export const SCREEN_THANKS_MAX = 8;

/** Where a QR code to the giving page was printed: the room's screen or a table card. */
export const QR_PLACES = ['screen', 'table'] as const;
export type QrPlace = (typeof QR_PLACES)[number];

/**
 * The name a gift may show on the room's screen (P4-13), or null. Only a donor who ticked "thank me
 * by name on the screen" is named, and then only as they chose to appear (full or first name);
 * an anonymous gift never shows a name, whatever else is set. Pledges from paddles carry no such
 * consent, so they are never named on a screen.
 */
export function screenName(g: {
  readonly donorName: string;
  readonly displayAs: DisplayAs;
  readonly showOnScreen: boolean;
}): string | null {
  if (!g.showOnScreen) return null;
  return shownName(g.donorName, g.displayAs);
}

/** The thermometer's fill: whole percent of the goal (0–100), and whether the goal is reached. */
export function thermometer(totalMinor: number, goalMinor: number): { percent: number; reached: boolean } {
  if (!Number.isFinite(totalMinor) || totalMinor <= 0 || !(goalMinor > 0))
    return { percent: 0, reached: false };
  const reached = totalMinor >= goalMinor;
  return { percent: reached ? 100 : Math.min(99, Math.floor((totalMinor * 100) / goalMinor)), reached };
}

/**
 * The query string of a QR code to the giving page: the campaign, and where it was scanned (so the
 * gift is recorded as a QR gift). `c` is the giving page's own campaign parameter.
 */
export function givingQrQuery(campaignId: string, place: QrPlace): string {
  return `?c=${encodeURIComponent(campaignId)}&via=${place}`;
}
