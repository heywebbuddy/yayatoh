import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, type Query, requireOrg } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { z } from 'zod';
import { ATTRIBUTION_MODELS } from '../attribution/models.ts';
import { dayIn } from '../compute.ts';
import {
  addDays,
  bucketOf,
  bucketsBetween,
  buildCounts,
  buildRevenue,
  type CountFigures,
  GRANULARITIES,
  type Granularity,
  noShowsOf,
  resolveRange,
} from '../dashboard.ts';
import type { DailyMetric } from '../schema.ts';
import { orgTimeZoneTx } from '../sync.ts';
import type { AnalyticsWarehouse, DayRange, WarehouseScope } from '../warehouse/port.ts';
import { lazyWarehouse } from '../warehouse/select.ts';
import {
  COUNT_MEASURES,
  type CountMeasure,
  comboProblem,
  DIMENSIONS,
  type Dimension,
  isAttributionMeasure,
  MEASURES,
  type Measure,
  MONEY_MEASURES,
  type MoneyMeasure,
  PRESET_DAYS,
  RANGE_PRESETS,
  type RangePreset,
} from './catalog.ts';

/**
 * The curated explorer (M6.2b): one measure broken down by one dimension over a period, read
 * from the warehouse port only (Postgres rollups or Tinybird), in the org's time zone. Counts go
 * through `analytics.explore` (`orders:read`); money through `analytics.exploreMoney`
 * (`finance:read`), so a member without finance never receives a money figure. Inputs are closed
 * enums: there is no way to ask for anything the catalogue does not list.
 */

export const MAX_ROWS = 500;
export const UNITS = ['count', 'order_bps', 'minor'] as const;

const ExploreBase = z.object({
  dimension: z.enum(DIMENSIONS).default('period'),
  model: z.enum(ATTRIBUTION_MODELS).default('linear'),
  granularity: z.enum(GRANULARITIES).default('day'),
  range: z.enum(RANGE_PRESETS).default('30d'),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  eventId: z.uuid().optional(),
});
export const ExploreInput = ExploreBase.extend({ measure: z.enum(COUNT_MEASURES) });
export type ExploreInput = z.input<typeof ExploreInput>;
export const ExploreMoneyInput = ExploreBase.extend({ measure: z.enum(MONEY_MEASURES) });
export type ExploreMoneyInput = z.input<typeof ExploreMoneyInput>;

const Day = z.iso.date();
export const ExploreRowDto = z.object({
  /** Period: the bucket's first day; event: its id; channel/source: the value ('' = none); campaign: its key. */
  key: z.string(),
  /** Event names and UTM campaign names; null where the page words it (none, messaging campaigns). */
  label: z.string().nullable(),
  currency: z.string().nullable(),
  value: z.int(),
});
export type ExploreRowDto = z.infer<typeof ExploreRowDto>;
export const ExploreDto = z.object({
  asOf: z.date(),
  measure: z.enum(MEASURES),
  dimension: z.enum(DIMENSIONS),
  /** The attribution model (attribution measures only). */
  model: z.enum(ATTRIBUTION_MODELS).nullable(),
  granularity: z.enum(GRANULARITIES),
  range: z.enum(RANGE_PRESETS),
  from: Day,
  to: Day,
  timeZone: z.string(),
  eventId: z.uuid().nullable(),
  /** `count`; `order_bps`: attributed orders in basis points of an order; `minor`: money per currency. */
  unit: z.enum(UNITS),
  rows: z.array(ExploreRowDto),
  totals: z.array(z.object({ currency: z.string().nullable(), value: z.int() })),
  truncated: z.boolean(),
});
export type ExploreDto = z.infer<typeof ExploreDto>;

/** The day range of an explorer request: a preset ending today (org time), or custom dates. */
export function exploreRange(
  input: { range: RangePreset; from?: string | undefined; to?: string | undefined },
  timeZone: string,
  now: Date,
): { from: string; to: string } {
  if (input.range === 'custom') {
    if (!input.from || !input.to)
      throw new DomainError('validation_failed', 'A custom period needs both dates', {
        reason: 'custom_needs_dates',
      });
    return resolveRange({ from: input.from, to: input.to, granularity: 'day' }, timeZone, now);
  }
  const to = dayIn(now, timeZone);
  return { from: addDays(to, -(PRESET_DAYS[input.range] - 1)), to };
}

const COUNT_FIELD: Readonly<Record<Exclude<CountMeasure, 'attributed_orders'>, keyof CountFigures>> = {
  registrations: 'registrations',
  tickets: 'tickets',
  comp_tickets: 'compTickets',
  refunded_tickets: 'refundedTickets',
  checkins: 'checkins',
  no_shows: 'noShows',
};

/** How much a warehouse metric adds to a count measure (net tickets subtract refunded ones). */
function countDelta(measure: CountMeasure, metric: DailyMetric, value: number): number {
  if (measure === 'registrations') return metric === 'orders' ? value : 0;
  if (measure === 'tickets') return metric === 'tickets' ? value : metric === 'refunded_tickets' ? -value : 0;
  if (measure === 'comp_tickets') return metric === 'comp_tickets' ? value : 0;
  if (measure === 'refunded_tickets') return metric === 'refunded_tickets' ? value : 0;
  if (measure === 'checkins') return metric === 'checkins' ? value : 0;
  return 0;
}

/** How much a warehouse metric adds to a money measure (net = gross minus refunds). */
function moneyDelta(measure: MoneyMeasure, metric: DailyMetric, value: number): number {
  if (measure === 'gross') return metric === 'gross' ? value : 0;
  if (measure === 'refunds') return metric === 'refunds' ? value : 0;
  if (measure === 'net') return metric === 'gross' ? value : metric === 'refunds' ? -value : 0;
  return 0;
}

type Acc = Map<string, Map<string, number>>;
const add = (acc: Acc, key: string, currency: string, value: number) => {
  const per = acc.get(key) ?? new Map<string, number>();
  per.set(currency, (per.get(currency) ?? 0) + value);
  acc.set(key, per);
};

function touchKey(dim: Dimension, r: { medium: string; source: string; campaign: string }): string {
  if (dim === 'channel') return r.medium;
  if (dim === 'source') return r.source;
  return r.campaign;
}

/** Pure-ish core: the explorer's rows for a request over one warehouse. */
export async function exploreTx(
  ctx: Ctx,
  tx: TenantTx,
  warehouse: AnalyticsWarehouse,
  input: z.output<typeof ExploreBase> & { measure: Measure },
): Promise<ExploreDto> {
  const orgId = requireOrg(ctx);
  const { measure, dimension, granularity: g } = input;
  const problem = comboProblem(measure, dimension);
  if (problem)
    throw new DomainError('validation_failed', 'This measure cannot be broken down that way', {
      reason: problem,
    });
  const timeZone = await orgTimeZoneTx(tx, orgId);
  const range = exploreRange(input, timeZone, ctx.now);
  if (input.eventId && !(await findEventTx(tx, input.eventId)))
    throw new DomainError('not_found', 'Event not found');
  const scope: WarehouseScope = { ctx, tx };
  const q: DayRange = { ...range, ...(input.eventId ? { eventId: input.eventId } : {}) };
  const money = (MONEY_MEASURES as readonly string[]).includes(measure);
  const acc: Acc = new Map();

  if (isAttributionMeasure(measure)) {
    for (const r of await warehouse.attributionTotals(scope, { ...q, model: input.model })) {
      const key =
        dimension === 'period'
          ? bucketOf(r.day, g)
          : dimension === 'event'
            ? r.eventId
            : touchKey(dimension, r);
      if (measure === 'attributed_orders') add(acc, key, '', r.creditBps);
      else add(acc, key, r.currency, r.revenueMinor);
    }
  } else if (dimension === 'period') {
    const daily = await warehouse.dailyTotals(scope, q);
    if (money) {
      const { series } = buildRevenue(daily, range, g, null);
      for (const s of series) {
        const v = measure === 'gross' ? s.grossMinor : measure === 'refunds' ? s.refundsMinor : s.netMinor;
        add(acc, s.bucket, s.currency, v);
      }
    } else {
      const states = await warehouse.eventStates(scope, q);
      const { series } = buildCounts(daily, states, range, g, ctx.now);
      const field = COUNT_FIELD[measure as Exclude<CountMeasure, 'attributed_orders'>];
      for (const s of series) add(acc, s.bucket, '', s[field]);
    }
  } else {
    for (const r of await warehouse.eventTotals(scope, q)) {
      if (money) {
        const v = moneyDelta(measure as MoneyMeasure, r.metric, r.value);
        if (v !== 0 || (measure === 'net' && (r.metric === 'gross' || r.metric === 'refunds')))
          add(acc, r.eventId, r.currency, v);
      } else {
        const v = countDelta(measure as CountMeasure, r.metric, r.value);
        if (v !== 0) add(acc, r.eventId, '', v);
      }
    }
    if (measure === 'no_shows')
      for (const s of await warehouse.eventStates(scope, q)) {
        const n = noShowsOf(s, ctx.now);
        if (n > 0) add(acc, s.eventId, '', n);
      }
  }

  // Period rows: every bucket in order, zeros included (counts; money per currency seen).
  let rows: ExploreRowDto[] = [];
  if (dimension === 'period') {
    const currencies = money ? [...new Set([...acc.values()].flatMap((m) => [...m.keys()]))].sort() : [''];
    for (const b of bucketsBetween(range.from, range.to, g))
      for (const c of currencies)
        rows.push({ key: b, label: null, currency: money ? c : null, value: acc.get(b)?.get(c) ?? 0 });
  } else {
    for (const [key, per] of acc)
      for (const [c, value] of per) rows.push({ key, label: null, currency: money ? c : null, value });
    rows.sort(
      (a, b) =>
        (a.currency ?? '').localeCompare(b.currency ?? '') || b.value - a.value || a.key.localeCompare(b.key),
    );
  }
  const totalsBy = new Map<string, number>();
  for (const r of rows) totalsBy.set(r.currency ?? '', (totalsBy.get(r.currency ?? '') ?? 0) + r.value);
  const truncated = rows.length > MAX_ROWS;
  rows = rows.slice(0, MAX_ROWS);
  // Labels: event names; UTM campaign names (messaging campaigns are named by the web, M3.6b).
  const names = new Map<string, string>();
  if (dimension === 'event')
    for (const id of new Set(rows.map((r) => r.key))) {
      const e = await findEventTx(tx, id);
      if (e) names.set(id, e.name);
    }
  rows = rows.map((r) => ({
    ...r,
    label:
      dimension === 'event'
        ? (names.get(r.key) ?? null)
        : dimension === 'campaign'
          ? r.key.startsWith('u.')
            ? r.key.slice(2) || null
            : null
          : dimension === 'channel' || dimension === 'source'
            ? r.key || null
            : null,
  }));
  return {
    asOf: ctx.now,
    measure,
    dimension,
    model: isAttributionMeasure(measure) ? input.model : null,
    granularity: g,
    range: input.range,
    ...range,
    timeZone,
    eventId: input.eventId ?? null,
    unit: measure === 'attributed_orders' ? 'order_bps' : money ? 'minor' : 'count',
    rows,
    totals: [...totalsBy.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, value]) => ({ currency: money ? currency : null, value })),
    truncated,
  };
}

/** The explorer's queries over one warehouse (tests pass each adapter). */
export function explorerQueries(warehouse: AnalyticsWarehouse): {
  exploreQuery: Query<ExploreInput, ExploreDto, ExploreDto, TenantTx>;
  exploreMoneyQuery: Query<ExploreMoneyInput, ExploreDto, ExploreDto, TenantTx>;
} {
  const exploreQuery = tenantQuery({
    name: 'analytics.explore',
    input: ExploreInput,
    output: ExploreDto,
    entitlement: 'analytics_pro',
    permission: 'orders:read',
    handler: ({ input, ctx, tx }) => exploreTx(ctx, tx, warehouse, input),
  }) as Query<ExploreInput, ExploreDto, ExploreDto, TenantTx>;
  const exploreMoneyQuery = tenantQuery({
    name: 'analytics.exploreMoney',
    input: ExploreMoneyInput,
    output: ExploreDto,
    entitlement: 'analytics_pro',
    permission: 'finance:read',
    handler: ({ input, ctx, tx }) => exploreTx(ctx, tx, warehouse, input),
  }) as Query<ExploreMoneyInput, ExploreDto, ExploreDto, TenantTx>;
  return { exploreQuery, exploreMoneyQuery };
}

export const { exploreQuery, exploreMoneyQuery } = explorerQueries(lazyWarehouse());

export type { Granularity };
