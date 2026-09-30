import { devicesOnlineTx } from '@yayatoh/checkin';
import type { TenantTx } from '@yayatoh/db';
import { type EventDto, findEventTx } from '@yayatoh/events';
import { DomainError } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { metricSnapshots, metricTimeseries } from '../schema.ts';
import {
  BUCKETS,
  bucketStart,
  COUNTER_SHARDS,
  MAX_RANGE_MS,
  PROJECTED_KEYS,
  type ProjectedKey,
  ProjectedMetricValue,
  projectedDef,
  projectedKeysFor,
  SERIES_KEYS,
} from './catalog.ts';
import { FINANCE_KEYS, FinanceReportDto } from './event-report.ts';
import { liveEventRowsTx, METRICS_CONSUMER } from './projector.ts';
import {
  checkinRateBps,
  type MetricKey,
  MetricValue,
  metricDef,
  metricKeysFor,
  reportCurrencies,
} from './registry.ts';

/** One event's projected values, shards summed: `key|currency` → value, and when they were projected. */
interface EventRows {
  readonly values: Map<string, number>;
  readonly projectedAt: Map<string, Date>;
  /** False when the event has no complete projection yet (read live instead). */
  readonly materialized: boolean;
}

async function projectedRowsTx(tx: TenantTx, eventId: string): Promise<EventRows> {
  const rows = await tx
    .select({
      key: metricSnapshots.key,
      currency: metricSnapshots.currency,
      value: sql<string>`sum(${metricSnapshots.value})::text`,
      shards: sql<number>`count(*)::int`,
      projectedAt: sql<Date>`max(${metricSnapshots.projectedAt})`,
    })
    .from(metricSnapshots)
    .where(eq(metricSnapshots.eventId, eventId))
    .groupBy(metricSnapshots.key, metricSnapshots.currency);
  const values = new Map<string, number>();
  const projectedAt = new Map<string, Date>();
  for (const r of rows) {
    values.set(`${r.key}|${r.currency}`, Number(r.value));
    projectedAt.set(`${r.key}|${r.currency}`, new Date(r.projectedAt));
  }
  const counter = rows.find((r) => r.key === 'checkins.tickets');
  const materialized = values.has('tickets.capacity|') && counter?.shards === COUNTER_SHARDS;
  return { values, projectedAt, materialized };
}

/** The projection if the event has one, otherwise the same rows computed live from the sources. */
async function eventRowsTx(tx: TenantTx, event: EventDto, now: Date): Promise<EventRows & { live: boolean }> {
  const projected = await projectedRowsTx(tx, event.id);
  if (projected.materialized) return { ...projected, live: false };
  const values = new Map<string, number>();
  for (const r of await liveEventRowsTx(tx, event, now)) {
    const k = `${r.key}|${r.currency}`;
    values.set(k, (values.get(k) ?? 0) + r.value);
  }
  return { values, projectedAt: new Map(), materialized: true, live: true };
}

/** Registry metric values (one per currency for money) from projected rows. */
function registryValues(
  rows: EventRows,
  keys: readonly MetricKey[],
  currencies: readonly string[],
  asOf: Date,
) {
  const v = (key: string, currency = '') => rows.values.get(`${key}|${currency}`) ?? 0;
  return keys.flatMap((key): MetricValue[] => {
    const def = metricDef(key);
    if (def.unit === 'money')
      return currencies.map((currency) => ({ key, unit: def.unit, currency, value: v(key, currency), asOf }));
    const value =
      key === 'checkins.rate' ? checkinRateBps(v('checkins.tickets'), v('tickets.valid')) : v(key);
    return [{ key, unit: def.unit, currency: null, value, asOf }];
  });
}

const moneyCurrencies = (rows: EventRows, defaultCurrency: string) =>
  reportCurrencies(
    defaultCurrency,
    [...rows.values.keys()]
      .filter((k) => k.startsWith('sales.gross|'))
      .map((k) => ({ currency: k.slice('sales.gross|'.length) })),
  );

export const EventKpisDto = z.object({
  asOf: z.date(),
  eventId: z.uuid(),
  currencies: z.array(z.string()),
  hasSales: z.boolean(),
  metrics: z.array(MetricValue),
  /** `projection` (metric_snapshots, L1) or `live` (no projection yet: read from the sources). */
  source: z.enum(['projection', 'live']),
});
export type EventKpisDto = z.infer<typeof EventKpisDto>;

/**
 * The event home's key numbers (M1.12 tiles, M3.1): the same registry metrics as
 * `reports.eventReport`, read from `metric_snapshots`. An event without a projection yet is read
 * live, so the numbers are always the report's.
 */
export const eventKpisQuery = tenantQuery({
  name: 'reports.eventKpis',
  input: z.object({ eventId: z.uuid() }),
  output: EventKpisDto,
  entitlement: 'reports',
  permission: 'orders:read',
  handler: async ({ input, ctx, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const keys = metricKeysFor('event', 'orders:read');
    const rows = await eventRowsTx(tx, event, ctx.now);
    const currencies = moneyCurrencies(rows, event.currency);
    return {
      asOf: ctx.now,
      eventId: event.id,
      currencies,
      hasSales: (rows.values.get('orders.sold|') ?? 0) > 0,
      metrics: registryValues(rows, keys, currencies, ctx.now),
      source: rows.live ? ('live' as const) : ('projection' as const),
    };
  },
});

/** The finance tile (net revenue) from the projection: the same waterfall as `reports.eventFinance`. */
export const eventFinanceKpisQuery = tenantQuery({
  name: 'reports.eventFinanceKpis',
  input: z.object({ eventId: z.uuid() }),
  output: FinanceReportDto,
  entitlement: 'reports',
  permission: 'finance:read',
  handler: async ({ input, ctx, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const rows = await eventRowsTx(tx, event, ctx.now);
    const currencies = moneyCurrencies(rows, event.currency);
    return { asOf: ctx.now, currencies, metrics: registryValues(rows, FINANCE_KEYS, currencies, ctx.now) };
  },
});

/** Lag of the metrics projector over the last `minutes`: sample count and percentiles (ms). */
async function lagStatsTx(tx: TenantTx, minutes: number) {
  const [r] = await tx.execute<{ n: number; p50: number | null; p95: number | null; max: number | null }>(sql`
    select count(*)::int as n,
      percentile_disc(0.5) within group (order by lag_ms) as p50,
      percentile_disc(0.95) within group (order by lag_ms) as p95,
      max(lag_ms) as max
    from reports.projector_lag
    where consumer = ${METRICS_CONSUMER} and projected_at >= now() - make_interval(mins => ${minutes}::int)`);
  return {
    samples: Number(r?.n ?? 0),
    p50Ms: Number(r?.p50 ?? 0),
    p95Ms: Number(r?.p95 ?? 0),
    maxMs: Number(r?.max ?? 0),
  };
}

const EventMetricsDto = z.object({ eventId: z.uuid(), metrics: z.array(ProjectedMetricValue) });

async function eventMetricsTx(tx: TenantTx, eventId: string, keys: readonly ProjectedKey[], now: Date) {
  const event = await findEventTx(tx, eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  const rows = await eventRowsTx(tx, event, now);
  const currencies = moneyCurrencies(rows, event.currency);
  const at = (k: string) => (rows.live ? now : (rows.projectedAt.get(k) ?? now));
  const out: ProjectedMetricValue[] = [];
  for (const key of [...new Set(keys)]) {
    const def = projectedDef(key);
    if (key === 'devices.online') {
      const [d] = await tx
        .select({ value: metricSnapshots.value, projectedAt: metricSnapshots.projectedAt })
        .from(metricSnapshots)
        .where(and(isNull(metricSnapshots.eventId), eq(metricSnapshots.key, 'devices.online')));
      out.push({
        key,
        unit: 'count',
        currency: null,
        value: d ? d.value : await devicesOnlineTx(tx, now),
        asOf: d ? d.projectedAt : now,
      });
    } else if (key === 'pipeline.lagP95Ms') {
      out.push({ key, unit: 'duration', currency: null, value: (await lagStatsTx(tx, 5)).p95Ms, asOf: now });
    } else if (def.unit === 'money') {
      for (const currency of currencies)
        out.push({
          key,
          unit: 'money',
          currency,
          value: rows.values.get(`${key}|${currency}`) ?? 0,
          asOf: at(`${key}|${currency}`),
        });
    } else if (key === 'checkins.rate') {
      const v = (k: string) => rows.values.get(`${k}|`) ?? 0;
      out.push({
        key,
        unit: 'percent',
        currency: null,
        value: checkinRateBps(v('checkins.tickets'), v('tickets.valid')),
        asOf: at('checkins.tickets|'),
      });
    } else {
      out.push({
        key,
        unit: def.unit,
        currency: null,
        value: rows.values.get(`${key}|`) ?? 0,
        asOf: at(`${key}|`),
      });
    }
  }
  return { eventId: event.id, metrics: out };
}

const nonFinanceKeys = projectedKeysFor('orders:read') as [ProjectedKey, ...ProjectedKey[]];
const financeKeys = projectedKeysFor('finance:read') as [ProjectedKey, ...ProjectedKey[]];

/**
 * `getEventMetrics(eventId, keys)` for the Command Center (M3.2): current values from
 * `metric_snapshots`, each with the time it was projected. Finance keys are refused here (see
 * `reports.eventFinanceMetrics`).
 */
export const eventMetricsQuery = tenantQuery({
  name: 'reports.eventMetrics',
  input: z.object({
    eventId: z.uuid(),
    keys: z.array(z.enum(nonFinanceKeys)).min(1).max(PROJECTED_KEYS.length),
  }),
  output: EventMetricsDto,
  entitlement: 'reports',
  permission: 'orders:read',
  handler: ({ input, ctx, tx }) => eventMetricsTx(tx, input.eventId, input.keys, ctx.now),
});

/** `getEventMetrics` for finance keys (platform fees, disputes lost, net revenue): `finance:read`. */
export const eventFinanceMetricsQuery = tenantQuery({
  name: 'reports.eventFinanceMetrics',
  input: z.object({ eventId: z.uuid(), keys: z.array(z.enum(financeKeys)).min(1).max(financeKeys.length) }),
  output: EventMetricsDto,
  entitlement: 'reports',
  permission: 'finance:read',
  handler: ({ input, ctx, tx }) => eventMetricsTx(tx, input.eventId, input.keys, ctx.now),
});

export const TimeseriesDto = z.object({
  eventId: z.uuid(),
  key: z.enum(SERIES_KEYS),
  unit: z.enum(['money', 'count']),
  bucket: z.enum(BUCKETS),
  from: z.date(),
  to: z.date(),
  /** Non-zero buckets only, oldest first (money: one point per currency). */
  points: z.array(z.object({ bucketStart: z.date(), currency: z.string().nullable(), value: z.int() })),
});
export type TimeseriesDto = z.infer<typeof TimeseriesDto>;

/**
 * `getTimeseries(eventId, key, range, bucket)` for the Command Center: per-minute or per-hour UTC
 * buckets in [from, to), shards summed. A range is at most 24 hours of minutes or 90 days of hours.
 */
export const eventTimeseriesQuery = tenantQuery({
  name: 'reports.eventTimeseries',
  input: z
    .object({
      eventId: z.uuid(),
      key: z.enum(SERIES_KEYS),
      bucket: z.enum(BUCKETS),
      from: z.coerce.date(),
      to: z.coerce.date(),
    })
    .refine((v) => v.to.getTime() > v.from.getTime(), {
      message: 'The range ends before it starts',
      path: ['to'],
    })
    .refine((v) => v.to.getTime() - v.from.getTime() <= MAX_RANGE_MS[v.bucket], {
      message: 'The range is too long for this bucket',
      path: ['from'],
    }),
  output: TimeseriesDto,
  entitlement: 'reports',
  permission: 'orders:read',
  handler: async ({ input, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const from = bucketStart(input.from, input.bucket);
    const rows = await tx
      .select({
        bucketStart: metricTimeseries.bucketStart,
        currency: metricTimeseries.currency,
        value: sql<string>`sum(${metricTimeseries.value})::text`,
      })
      .from(metricTimeseries)
      .where(
        and(
          eq(metricTimeseries.eventId, event.id),
          eq(metricTimeseries.key, input.key),
          eq(metricTimeseries.bucket, input.bucket),
          gte(metricTimeseries.bucketStart, from),
          lt(metricTimeseries.bucketStart, input.to),
        ),
      )
      .groupBy(metricTimeseries.bucketStart, metricTimeseries.currency)
      .orderBy(metricTimeseries.bucketStart, metricTimeseries.currency);
    const money = projectedDef(input.key).unit === 'money';
    return {
      eventId: event.id,
      key: input.key,
      unit: money ? ('money' as const) : ('count' as const),
      bucket: input.bucket,
      from,
      to: input.to,
      points: rows
        .map((r) => ({
          bucketStart: new Date(r.bucketStart),
          currency: money ? r.currency : null,
          value: Number(r.value),
        }))
        .filter((p) => p.value !== 0),
    };
  },
});

export const MetricsPipelineDto = z.object({
  asOf: z.date(),
  windowMinutes: z.int(),
  samples: z.int().nonnegative(),
  p50Ms: z.int().nonnegative(),
  p95Ms: z.int().nonnegative(),
  maxMs: z.int().nonnegative(),
});

/** The metrics projector's lag for this org (event written → projection committed), last N minutes. */
export const metricsPipelineQuery = tenantQuery({
  name: 'reports.metricsPipeline',
  input: z.object({ windowMinutes: z.int().min(1).max(1440).default(5) }),
  output: MetricsPipelineDto,
  entitlement: 'reports',
  permission: 'orders:read',
  handler: async ({ input, ctx, tx }) => ({
    asOf: ctx.now,
    windowMinutes: input.windowMinutes,
    ...(await lagStatsTx(tx, input.windowMinutes)),
  }),
});
