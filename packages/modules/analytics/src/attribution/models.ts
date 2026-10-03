import { z } from 'zod';

/**
 * Multi-touch attribution (M6.2b), pure. An attributed order's revenue and its one order of
 * credit are shared among the touches of its path (marketing's touch paths: tracked-link clicks,
 * UTM landings and referral landings inside the org's lookback window, in time order):
 *
 * - **first**: everything to the first touch;
 * - **last**: everything to the last touch;
 * - **linear**: an equal share to every touch. Shares are whole minor units (and whole basis
 *   points of an order): each touch gets `floor(total / n)`, and the remainder (fewer than `n`
 *   units) goes to the **last** touch, so the shares always add up to the order's total exactly.
 *
 * Revenue is the sold order's gross total in its own currency (refunds are not netted, as in the
 * M3.8b marketing report); currencies are never added together. A touch's dimensions are its
 * source, medium (channel) and campaign key; a path touching the same source twice gives that
 * source two shares. Orders without an attribution record are not attributed.
 */
export const ATTRIBUTION_MODELS = ['first', 'last', 'linear'] as const;
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];
/** One order of credit, in basis points (linear shares stay whole numbers). */
export const ORDER_CREDIT_BPS = 10_000;

export interface PathTouch {
  readonly source: string;
  readonly medium: string | null;
  readonly campaignKey: string | null;
  readonly linkId: string | null;
}

/** `total` split into `n` whole shares: `floor(total / n)` each, the remainder to the last one. */
export function splitEvenly(total: number, n: number): number[] {
  if (!Number.isInteger(total) || total < 0) throw new Error('splitEvenly: total must be a whole number ≥ 0');
  if (!Number.isInteger(n) || n < 1) throw new Error('splitEvenly: at least one share');
  const base = Math.floor(total / n);
  const shares = Array.from({ length: n }, () => base);
  shares[n - 1] = base + (total - base * n);
  return shares;
}

/** The share of an order (revenue and credit) each touch of its path gets under a model. */
export function creditTouches<T extends PathTouch>(
  touches: readonly T[],
  model: AttributionModel,
  totalMinor: number,
): { touch: T; creditBps: number; revenueMinor: number }[] {
  if (touches.length === 0) return [];
  if (model === 'first' || model === 'last') {
    const touch = (model === 'first' ? touches[0] : touches[touches.length - 1]) as T;
    return [{ touch, creditBps: ORDER_CREDIT_BPS, revenueMinor: totalMinor }];
  }
  const credit = splitEvenly(ORDER_CREDIT_BPS, touches.length);
  const revenue = splitEvenly(totalMinor, touches.length);
  return touches.map((touch, i) => ({
    touch,
    creditBps: credit[i] as number,
    revenueMinor: revenue[i] as number,
  }));
}

const Day = z.iso.date();
/** One attributed figure of an event: per payment day, model, touch dimensions and currency. */
export const AttributionRow = z.object({
  day: Day,
  model: z.enum(ATTRIBUTION_MODELS),
  source: z.string().min(1).max(255),
  /** '' = no medium. */
  medium: z.string().max(100),
  /** '' = no campaign; else `c.{id}` or `u.{utm_campaign}`. */
  campaign: z.string().max(102),
  linkId: z.uuid().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  creditBps: z.int().nonnegative(),
  revenueMinor: z.int().nonnegative(),
});
export type AttributionRow = z.infer<typeof AttributionRow>;

const rowKey = (r: Omit<AttributionRow, 'creditBps' | 'revenueMinor'>) =>
  [r.day, r.model, r.source, r.medium, r.campaign, r.linkId ?? '', r.currency].join('|');

/** Canonical order of attribution rows (hashing, comparisons, fixtures). */
export function sortAttribution(rows: readonly AttributionRow[]): AttributionRow[] {
  return [...rows].sort((a, b) => (rowKey(a) < rowKey(b) ? -1 : rowKey(a) > rowKey(b) ? 1 : 0));
}

/** Add rows that share every dimension; drop empty ones; canonical order. */
export function foldAttribution(rows: readonly AttributionRow[]): AttributionRow[] {
  const by = new Map<string, AttributionRow>();
  for (const r of rows) {
    const k = rowKey(r);
    const cur = by.get(k);
    by.set(
      k,
      cur
        ? { ...cur, creditBps: cur.creditBps + r.creditBps, revenueMinor: cur.revenueMinor + r.revenueMinor }
        : { ...r },
    );
  }
  return sortAttribution([...by.values()].filter((r) => r.creditBps !== 0 || r.revenueMinor !== 0));
}

export interface AttributableOrder {
  readonly orderId: string;
  readonly day: string;
  readonly currency: string;
  readonly totalMinor: number;
}

/** Every model's attribution rows for an event's sold orders and their touch paths. */
export function attributionRowsOf(
  orders: readonly AttributableOrder[],
  paths: readonly { orderId: string; touches: readonly PathTouch[] }[],
): AttributionRow[] {
  const pathOf = new Map(paths.map((p) => [p.orderId, p.touches] as const));
  const rows: AttributionRow[] = [];
  for (const o of orders) {
    const touches = pathOf.get(o.orderId);
    if (!touches?.length) continue;
    for (const model of ATTRIBUTION_MODELS)
      for (const c of creditTouches(touches, model, o.totalMinor))
        rows.push({
          day: o.day,
          model,
          source: c.touch.source.slice(0, 255),
          medium: (c.touch.medium ?? '').slice(0, 100),
          campaign: (c.touch.campaignKey ?? '').slice(0, 102),
          linkId: c.touch.linkId,
          currency: o.currency,
          creditBps: c.creditBps,
          revenueMinor: c.revenueMinor,
        });
  }
  return foldAttribution(rows);
}
