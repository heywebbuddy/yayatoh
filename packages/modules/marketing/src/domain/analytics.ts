import { utcToZonedInput, zonedTimeToUtc } from '@yayatoh/kernel';
import { conversionBps } from './window.ts';

/**
 * Marketing analytics (M3.8b), pure: campaign → registrations and revenue, per campaign, channel
 * and link, with first- and last-touch credit. Inputs are facts the queries read under RLS (links,
 * click tallies, attribution records, order outcomes, send tallies); outputs are numbers only.
 *
 * - **Campaign.** A link a messaging campaign created (M3.6b `campaign_id`) belongs to that
 *   campaign (`c.{id}`); any other link to its UTM campaign (`u.{utm_campaign}`). Orders credited by
 *   UTM values alone (no click) go to their UTM campaign too.
 * - **Channel.** The link's (or the landing's) UTM medium (`m.{medium}`).
 * - **Link.** One tracked link (`l.{id}`); UTM-only orders have no link.
 * - **Credit.** Each sold order in the range counts once first touch (its first click's link, or
 *   its first UTM landing) and once last touch. Revenue is the order's gross total in integer minor
 *   units when it is in the org's currency; orders in other currencies are counted and reported
 *   apart, never converted or added.
 * - **Conversion** is last-touch orders per click (basis points), as in M3.8a.
 */

export const DIMENSIONS = ['campaign', 'channel', 'link'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface AnalyticsLink {
  readonly id: string;
  readonly campaignId: string | null;
  readonly medium: string;
  readonly campaign: string;
}

export interface AttributionFact {
  readonly orderId: string;
  readonly model: string;
  readonly firstLinkId: string | null;
  readonly lastLinkId: string | null;
  /** Last-touch UTM values (UTM-only records). */
  readonly utmMedium: string | null;
  readonly utmCampaign: string | null;
  /** First-touch UTM values (UTM-only records). */
  readonly firstUtmMedium: string | null;
  readonly firstUtmCampaign: string | null;
}

export interface OrderFact {
  readonly orderId: string;
  readonly sold: boolean;
  readonly totalMinor: number;
  readonly currency: string;
  readonly createdAt: Date;
}

/** Clicks of one link by one visitor (a device, or the click itself when no device was known). */
export interface ClickTally {
  readonly linkId: string;
  readonly visitor: string;
  readonly clicks: number;
}

/** Messages a campaign sent (per message channel). */
export interface SendFact {
  readonly campaignId: string;
  readonly channel: string;
  readonly sent: number;
  readonly delivered: number;
}

export interface Credit {
  readonly orders: number;
  /** Org currency, integer minor units. */
  readonly revenueMinor: number;
}

export interface Figures {
  /** Messages sent (campaign and channel rows backed by messaging campaigns), else null. */
  readonly sends: number | null;
  readonly deliveries: number | null;
  readonly clicks: number;
  readonly uniqueClickers: number;
  readonly firstTouch: Credit;
  readonly lastTouch: Credit;
  /** Sold orders credited here (either touch) in another currency: counted, not in revenue. */
  readonly otherCurrencyOrders: number;
  readonly conversionBps: number;
}

export interface AnalyticsRow extends Figures {
  readonly key: string;
}

export const campaignKeyOf = (l: Pick<AnalyticsLink, 'campaignId' | 'campaign'>) =>
  l.campaignId ? `c.${l.campaignId}` : `u.${l.campaign}`;

/** The key a link falls under for a dimension. */
export function linkKey(dim: Dimension, l: AnalyticsLink): string {
  if (dim === 'campaign') return campaignKeyOf(l);
  if (dim === 'channel') return `m.${l.medium}`;
  return `l.${l.id}`;
}

/** The key a UTM-only touch falls under (null: the link view has no row for it). */
function utmKey(dim: Dimension, medium: string | null, campaign: string | null): string | null {
  if (dim === 'campaign') return `u.${campaign ?? ''}`;
  if (dim === 'channel') return `m.${medium ?? ''}`;
  return null;
}

interface Acc {
  sends: number | null;
  deliveries: number | null;
  clicks: number;
  visitors: Set<string>;
  first: { orders: number; revenueMinor: number };
  last: { orders: number; revenueMinor: number };
  otherCurrency: Set<string>;
}

const blank = (): Acc => ({
  sends: null,
  deliveries: null,
  clicks: 0,
  visitors: new Set(),
  first: { orders: 0, revenueMinor: 0 },
  last: { orders: 0, revenueMinor: 0 },
  otherCurrency: new Set(),
});

export interface AggregateInput {
  readonly dimension: Dimension;
  readonly currency: string;
  readonly links: readonly AnalyticsLink[];
  readonly clicks: readonly ClickTally[];
  readonly attributions: readonly AttributionFact[];
  /** Outcomes of the attributed orders; only sold orders created inside the range count. */
  readonly orders: ReadonlyMap<string, OrderFact>;
  readonly range: { readonly from: Date; readonly to: Date };
  readonly sends: readonly SendFact[];
}

const finish = (key: string, a: Acc): AnalyticsRow => ({
  key,
  sends: a.sends,
  deliveries: a.deliveries,
  clicks: a.clicks,
  uniqueClickers: a.visitors.size,
  firstTouch: { ...a.first },
  lastTouch: { ...a.last },
  otherCurrencyOrders: a.otherCurrency.size,
  conversionBps: conversionBps(a.last.orders, a.clicks),
});

/** Aggregate the facts into one row per key of the dimension, plus the totals. */
export function aggregate(input: AggregateInput): { rows: AnalyticsRow[]; totals: Figures } {
  const byId = new Map(input.links.map((l) => [l.id, l]));
  const acc = new Map<string, Acc>();
  const total = blank();
  const at = (key: string) => {
    let a = acc.get(key);
    if (!a) {
      a = blank();
      acc.set(key, a);
    }
    return a;
  };
  const addSends = (a: Acc, sent: number, delivered: number) => {
    a.sends = (a.sends ?? 0) + sent;
    a.deliveries = (a.deliveries ?? 0) + delivered;
  };

  // Every link's row exists (a link nobody clicked yet still shows, with zeros).
  for (const l of input.links) at(linkKey(input.dimension, l));

  for (const s of input.sends) {
    if (input.dimension === 'campaign') addSends(at(`c.${s.campaignId}`), s.sent, s.delivered);
    if (input.dimension === 'channel') addSends(at(`m.${s.channel}`), s.sent, s.delivered);
    addSends(total, s.sent, s.delivered);
  }

  for (const c of input.clicks) {
    const link = byId.get(c.linkId);
    if (!link) continue;
    const a = at(linkKey(input.dimension, link));
    a.clicks += c.clicks;
    a.visitors.add(c.visitor);
    total.clicks += c.clicks;
    total.visitors.add(c.visitor);
  }

  const { from, to } = input.range;
  for (const r of input.attributions) {
    const o = input.orders.get(r.orderId);
    if (!o?.sold || o.createdAt < from || o.createdAt >= to) continue;
    const click = r.model === 'click';
    const firstLink = click && r.firstLinkId ? byId.get(r.firstLinkId) : undefined;
    const lastLink = click && r.lastLinkId ? byId.get(r.lastLinkId) : undefined;
    const firstKey = click
      ? firstLink
        ? linkKey(input.dimension, firstLink)
        : null
      : utmKey(input.dimension, r.firstUtmMedium ?? r.utmMedium, r.firstUtmCampaign ?? r.utmCampaign);
    const lastKey = click
      ? lastLink
        ? linkKey(input.dimension, lastLink)
        : null
      : utmKey(input.dimension, r.utmMedium, r.utmCampaign);
    const same = o.currency === input.currency;
    const credit = (a: Acc, touch: 'first' | 'last') => {
      a[touch].orders += 1;
      if (same) a[touch].revenueMinor += o.totalMinor;
      else a.otherCurrency.add(o.orderId);
    };
    if (firstKey !== null) credit(at(firstKey), 'first');
    if (lastKey !== null) credit(at(lastKey), 'last');
    credit(total, 'first');
    credit(total, 'last');
  }

  const rows = [...acc].map(([key, a]) => finish(key, a));
  rows.sort(
    (a, b) =>
      b.lastTouch.revenueMinor - a.lastTouch.revenueMinor ||
      b.lastTouch.orders - a.lastTouch.orders ||
      b.clicks - a.clicks ||
      (b.sends ?? 0) - (a.sends ?? 0) ||
      a.key.localeCompare(b.key),
  );
  const { key: _key, ...totals } = finish('', total);
  return { rows, totals };
}

// --- Date range in the org's time zone ------------------------------------------------------

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 366;

export interface DayRange {
  /** Inclusive calendar days in the org's zone (`YYYY-MM-DD`). */
  readonly fromDay: string;
  readonly toDay: string;
  /** `[from, to)` instants: midnight of `fromDay` to midnight after `toDay`, in the zone. */
  readonly from: Date;
  readonly to: Date;
}

const nextDay = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const validDay = (day: string) => DAY.test(day) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;

export type RangeProblem = 'invalid_date' | 'from_after_to' | 'range_too_long';

/**
 * The report's range: calendar days in the org's time zone (daylight saving shifts included), by
 * default the last 30 days up to today. Returns a problem for bad input instead of guessing.
 */
export function dayRange(
  input: { readonly from?: string | null; readonly to?: string | null },
  timeZone: string,
  now: Date,
): DayRange | { readonly problem: RangeProblem } {
  const today = utcToZonedInput(now, timeZone).slice(0, 10);
  const toDay = input.to || today;
  const fromDay = input.from || addDays(toDay, -(DEFAULT_RANGE_DAYS - 1));
  if (!validDay(fromDay) || !validDay(toDay)) return { problem: 'invalid_date' };
  if (fromDay > toDay) return { problem: 'from_after_to' };
  if (addDays(fromDay, MAX_RANGE_DAYS - 1) < toDay) return { problem: 'range_too_long' };
  return {
    fromDay,
    toDay,
    from: zonedTimeToUtc(`${fromDay}T00:00`, timeZone),
    to: zonedTimeToUtc(`${nextDay(toDay)}T00:00`, timeZone),
  };
}

/** Parse a campaign key from a URL (`c.{uuid}` or `u.{utm campaign}`). */
export function parseCampaignKey(key: string): { kind: 'campaign'; id: string } | { kind: 'utm'; campaign: string } | null {
  if (key.startsWith('c.')) {
    const id = key.slice(2);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? { kind: 'campaign', id } : null;
  }
  if (key.startsWith('u.') && key.length <= 102) return { kind: 'utm', campaign: key.slice(2) };
  return null;
}
