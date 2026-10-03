import type { AttributionModel } from '../attribution/models.ts';

/**
 * The curated explorer's catalogue (M6.2b, decision P6-2: "a curated explorer … built in the
 * app", no free SQL). A fixed set of measures and dimensions; every combination the explorer
 * accepts is listed here, and the queries take nothing else.
 *
 * - Count measures need `orders:read`; money measures need `finance:read` (they go through a
 *   separate query and DTO, like the dashboards). Money is per currency, never added across.
 * - Attribution measures take a model (first, last, linear) and can be broken down by channel
 *   (UTM medium), source and campaign; the others by period or event only.
 */
export const COUNT_MEASURES = [
  'registrations',
  'tickets',
  'comp_tickets',
  'refunded_tickets',
  'checkins',
  'no_shows',
  'attributed_orders',
] as const;
export const MONEY_MEASURES = ['gross', 'refunds', 'net', 'attributed_revenue'] as const;
export const MEASURES = [...COUNT_MEASURES, ...MONEY_MEASURES] as const;
export type CountMeasure = (typeof COUNT_MEASURES)[number];
export type MoneyMeasure = (typeof MONEY_MEASURES)[number];
export type Measure = (typeof MEASURES)[number];

export const DIMENSIONS = ['period', 'event', 'channel', 'source', 'campaign'] as const;
export type Dimension = (typeof DIMENSIONS)[number];
/** Dimensions only attribution measures have (a touch's, not an order's). */
export const TOUCH_DIMENSIONS: readonly Dimension[] = ['channel', 'source', 'campaign'];

export const RANGE_PRESETS = ['7d', '30d', '90d', '365d', 'custom'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const PRESET_DAYS: Readonly<Record<Exclude<RangePreset, 'custom'>, number>> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '365d': 365,
};

export const isMoneyMeasure = (m: string): m is MoneyMeasure => (MONEY_MEASURES as readonly string[]).includes(m);
export const isAttributionMeasure = (m: Measure) => m === 'attributed_orders' || m === 'attributed_revenue';

/** Why a measure and dimension cannot go together (null: they can). */
export function comboProblem(measure: Measure, dimension: Dimension): 'touch_dimension' | null {
  return TOUCH_DIMENSIONS.includes(dimension) && !isAttributionMeasure(measure) ? 'touch_dimension' : null;
}

export type { AttributionModel };
