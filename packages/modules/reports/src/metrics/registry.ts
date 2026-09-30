import { z } from 'zod';

/**
 * The metric registry (roadmap M1.12, research 18 §1): every number a report, dashboard tile or
 * export shows is one of these, derived from the owning modules' facts by `deriveMetrics`, so a
 * figure means the same thing everywhere. Every value carries the `asOf` instant it was read at.
 *
 * Money is integer minor units **per currency**; currencies are never added together.
 * Percentages are basis points (10 000 = 100 %).
 */

export const METRIC_UNITS = ['money', 'count', 'percent'] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];
export type MetricGrain = 'event' | 'org';

export interface MetricDef {
  readonly key: string;
  readonly unit: MetricUnit;
  readonly grains: readonly MetricGrain[];
  /** Who may see it. Money that reveals the organizer's take is finance-only. */
  readonly permission: 'orders:read' | 'finance:read';
  /** Freshness class (research 18): L0 = exact, read from the transactional tables. */
  readonly freshness: 'L0';
  /** The plain-English definition (docs, spec, the report's "how we count" notes). */
  readonly definition: string;
}

const both = ['event', 'org'] as const;
const eventOnly = ['event'] as const;

export const METRICS = [
  {
    key: 'sales.gross',
    unit: 'money',
    grains: both,
    permission: 'orders:read',
    freshness: 'L0',
    definition:
      'What buyers paid: the totals (face value after promo discounts, plus pass-on fees) of orders that were paid, including orders later refunded. Organizer-collected (box office) sales included. Periods: by payment time.',
  },
  {
    key: 'sales.refunds',
    unit: 'money',
    grains: both,
    permission: 'orders:read',
    freshness: 'L0',
    definition: 'Succeeded refunds (tickets and amounts). Periods: by the time the refund succeeded.',
  },
  {
    key: 'sales.discounts',
    unit: 'money',
    grains: both,
    permission: 'orders:read',
    freshness: 'L0',
    definition: 'Promo-code discounts given on sold orders (already taken off gross sales).',
  },
  {
    key: 'finance.platformFees',
    unit: 'money',
    grains: both,
    permission: 'finance:read',
    freshness: 'L0',
    definition:
      'Platform fees kept: the fee inside sold orders (passed on to the buyer or absorbed) minus the fee part of succeeded refunds.',
  },
  {
    key: 'finance.disputesLost',
    unit: 'money',
    grains: both,
    permission: 'finance:read',
    freshness: 'L0',
    definition: 'Card disputes (chargebacks) lost. Periods: by the day the dispute closed.',
  },
  {
    key: 'finance.net',
    unit: 'money',
    grains: both,
    permission: 'finance:read',
    freshness: 'L0',
    definition:
      "Net revenue: gross sales − refunds − disputes lost − platform fees kept. The organizer's proceeds before card-processing costs on their own Stripe account (organizer_mor); for platform_mor the platform absorbs processing costs. Box-office money is held by the organizer; its platform fee is netted from the next payout.",
  },
  {
    key: 'orders.sold',
    unit: 'count',
    grains: both,
    permission: 'orders:read',
    freshness: 'L0',
    definition: 'Orders that were paid (complimentary and later-refunded orders included).',
  },
  {
    key: 'orders.comp',
    unit: 'count',
    grains: both,
    permission: 'orders:read',
    freshness: 'L0',
    definition: 'Complimentary orders: sold orders with a zero total (free passes, 100 % codes, door comps).',
  },
  {
    key: 'orders.failed',
    unit: 'count',
    grains: both,
    permission: 'orders:read',
    freshness: 'L0',
    definition: 'Orders whose payment failed (declined card) and were not paid. Periods: by checkout start.',
  },
  {
    key: 'orders.refunded',
    unit: 'count',
    grains: both,
    permission: 'orders:read',
    freshness: 'L0',
    definition: 'Orders now fully or partially refunded. Periods: by checkout start.',
  },
  {
    key: 'tickets.sold',
    unit: 'count',
    grains: both,
    permission: 'orders:read',
    freshness: 'L0',
    definition:
      'Paid tickets issued minus tickets refunded (complimentary tickets excluded). Periods: tickets paid in the period minus tickets refunded in it, so it can be negative.',
  },
  {
    key: 'tickets.comp',
    unit: 'count',
    grains: both,
    permission: 'orders:read',
    freshness: 'L0',
    definition: 'Tickets on complimentary orders.',
  },
  {
    key: 'tickets.refunded',
    unit: 'count',
    grains: both,
    permission: 'orders:read',
    freshness: 'L0',
    definition: 'Tickets voided by succeeded refunds.',
  },
  {
    key: 'tickets.capacity',
    unit: 'count',
    grains: eventOnly,
    permission: 'orders:read',
    freshness: 'L0',
    definition: "Places for sale: the quantities of the event's ticket types that are not archived.",
  },
  {
    key: 'tickets.valid',
    unit: 'count',
    grains: eventOnly,
    permission: 'orders:read',
    freshness: 'L0',
    definition: 'Tickets issued and not void (sold + complimentary, after refunds and lost disputes).',
  },
  {
    key: 'checkins.tickets',
    unit: 'count',
    grains: both,
    permission: 'orders:read',
    freshness: 'L0',
    definition: 'Tickets with at least one live (not undone) admission. Periods: admissions in the period.',
  },
  {
    key: 'checkins.rate',
    unit: 'percent',
    grains: eventOnly,
    permission: 'orders:read',
    freshness: 'L0',
    definition: 'Checked-in tickets ÷ valid tickets (capped at 100 %).',
  },
] as const satisfies readonly MetricDef[];

export type MetricKey = (typeof METRICS)[number]['key'];
export const METRIC_KEYS = METRICS.map((m) => m.key) as unknown as readonly [MetricKey, ...MetricKey[]];

const BY_KEY = new Map<string, MetricDef>(METRICS.map((m) => [m.key, m]));
export function metricDef(key: MetricKey): MetricDef {
  return BY_KEY.get(key) as MetricDef;
}

/** Keys shown at a grain that a permission allows. */
export function metricKeysFor(grain: MetricGrain, permission: MetricDef['permission']): MetricKey[] {
  return METRICS.filter(
    (m) => m.permission === permission && (m.grains as readonly MetricGrain[]).includes(grain),
  ).map((m) => m.key);
}

export const MetricValue = z.object({
  key: z.enum(METRIC_KEYS),
  unit: z.enum(METRIC_UNITS),
  /** Money only: ISO 4217. */
  currency: z.string().nullable(),
  value: z.int(),
  /** When the value was read (L0: the report's transaction time). */
  asOf: z.date(),
});
export type MetricValue = z.infer<typeof MetricValue>;

/** Facts the metrics derive from (each from its owning module's exported read functions). */
export interface MetricFacts {
  /** Currencies to report money in: every currency with data, plus the scope's default one. */
  readonly currencies: readonly string[];
  readonly sales: readonly {
    currency: string;
    comp: boolean;
    orders: number;
    tickets: number;
    grossMinor: number;
    feeMinor: number;
    discountMinor: number;
  }[];
  readonly refunds: readonly {
    currency: string;
    tickets: number;
    amountMinor: number;
    feeRefundedMinor: number;
  }[];
  readonly disputes: readonly { currency: string; amountMinor: number }[];
  readonly statuses: readonly { status: string; orders: number }[];
  readonly checkins: { readonly tickets: number };
  /** Event grain only. */
  readonly tickets?: { readonly capacity: number; readonly valid: number };
}

/** Checked-in tickets ÷ valid tickets in basis points, capped at 100 % (0 with no valid tickets). */
export const checkinRateBps = (checkedIn: number, valid: number) =>
  valid > 0 ? Math.min(10_000, Math.round((checkedIn * 10_000) / valid)) : 0;

const sum = <T>(xs: readonly T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);

/** Pure: facts → metric values (one per currency for money), in `keys` order. */
export function deriveMetrics(facts: MetricFacts, keys: readonly MetricKey[], asOf: Date): MetricValue[] {
  const inCur = <T extends { currency: string }>(xs: readonly T[], c: string) =>
    xs.filter((x) => x.currency === c);
  const money = (c: string): Record<string, number> => {
    const s = inCur(facts.sales, c);
    const r = inCur(facts.refunds, c);
    const gross = sum(s, (x) => x.grossMinor);
    const refunds = sum(r, (x) => x.amountMinor);
    const fees = sum(s, (x) => x.feeMinor) - sum(r, (x) => x.feeRefundedMinor);
    const disputes = sum(inCur(facts.disputes, c), (x) => x.amountMinor);
    return {
      'sales.gross': gross,
      'sales.refunds': refunds,
      'sales.discounts': sum(s, (x) => x.discountMinor),
      'finance.platformFees': fees,
      'finance.disputesLost': disputes,
      'finance.net': gross - refunds - disputes - fees,
    };
  };
  const status = (...ss: string[]) =>
    sum(
      facts.statuses.filter((x) => ss.includes(x.status)),
      (x) => x.orders,
    );
  const valid = facts.tickets?.valid ?? 0;
  const counts: Record<string, number> = {
    'orders.sold': sum(facts.sales, (x) => x.orders),
    'orders.comp': sum(
      facts.sales.filter((x) => x.comp),
      (x) => x.orders,
    ),
    'orders.failed': status('payment_failed'),
    'orders.refunded': status('refunded', 'partially_refunded'),
    'tickets.sold':
      sum(
        facts.sales.filter((x) => !x.comp),
        (x) => x.tickets,
      ) - sum(facts.refunds, (x) => x.tickets),
    'tickets.comp': sum(
      facts.sales.filter((x) => x.comp),
      (x) => x.tickets,
    ),
    'tickets.refunded': sum(facts.refunds, (x) => x.tickets),
    'tickets.capacity': facts.tickets?.capacity ?? 0,
    'tickets.valid': valid,
    'checkins.tickets': facts.checkins.tickets,
    'checkins.rate': checkinRateBps(facts.checkins.tickets, valid),
  };
  const byCurrency = new Map(facts.currencies.map((c) => [c, money(c)]));
  return keys.flatMap((key): MetricValue[] => {
    const def = metricDef(key);
    if (def.unit === 'money')
      return facts.currencies.map((currency) => ({
        key,
        unit: def.unit,
        currency,
        value: byCurrency.get(currency)?.[key] ?? 0,
        asOf,
      }));
    return [{ key, unit: def.unit, currency: null, value: counts[key] ?? 0, asOf }];
  });
}

/** Every currency with data, the default first (the event's or org's own currency). */
export function reportCurrencies(
  defaultCurrency: string,
  ...lists: readonly { currency: string }[][]
): string[] {
  const rest = new Set(lists.flat().map((x) => x.currency));
  rest.delete(defaultCurrency);
  return [defaultCurrency, ...[...rest].sort()];
}
