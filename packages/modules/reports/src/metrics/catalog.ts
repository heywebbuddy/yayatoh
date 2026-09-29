import { z } from 'zod';
import { METRICS, type MetricKey, type MetricUnit } from './registry.ts';

/**
 * The projected metrics (M3.1): what `metric_snapshots` and `metric_timeseries` hold for the
 * Command Center. The report metrics keep their registry definitions (one meaning everywhere);
 * operations metrics are added here. Freshness L1: projected from the outbox within seconds
 * (projector lag p95 ≤ 2 s at 20 scans/s), and exact once the projector has caught up.
 */

/** How a projected metric is kept current. */
export type ProjectionClass =
  /** Recomputed from its sources for the whole event whenever a domain event touches it. */
  | 'refresh'
  /** A hot counter: N shards, each recomputed alone from its share of the sources; summed on read. */
  | 'counter'
  /** Computed on read from other projected values (e.g. a rate). */
  | 'derived'
  /** Computed on read from pipeline samples. */
  | 'pipeline';

export interface ProjectedMetricDef {
  readonly key: string;
  readonly unit: MetricUnit | 'duration';
  readonly grain: 'event' | 'org';
  readonly permission: 'orders:read' | 'finance:read';
  readonly projection: ProjectionClass;
  readonly definition: string;
}

/** Hot counters use this many shards (a ticket's shard is its id's last byte modulo this). */
export const COUNTER_SHARDS = 8;
/** Time-series points are sharded the same way (by order or ticket id). */
export const SERIES_SHARDS = 8;

const registryDef = (key: MetricKey): ProjectedMetricDef => {
  const m = METRICS.find((x) => x.key === key) as (typeof METRICS)[number];
  return {
    key,
    unit: m.unit,
    grain: 'event',
    permission: m.permission,
    projection: key === 'checkins.tickets' ? 'counter' : key === 'checkins.rate' ? 'derived' : 'refresh',
    definition: m.definition,
  };
};

export const PROJECTED_METRICS = [
  ...METRICS.map((m) => registryDef(m.key)),
  {
    key: 'tickets.distributed',
    unit: 'count',
    grain: 'event',
    permission: 'orders:read',
    projection: 'refresh',
    definition: 'Active tickets someone claimed through a claim link (handed on by the buyer).',
  },
  {
    key: 'seats.occupied',
    unit: 'count',
    grain: 'event',
    permission: 'orders:read',
    projection: 'refresh',
    definition: 'Seats sold with a ticket plus seats the organizer assigned to a guest.',
  },
  {
    key: 'devices.online',
    unit: 'count',
    grain: 'org',
    permission: 'orders:read',
    projection: 'refresh',
    definition:
      'Check-in devices not revoked whose last heartbeat was within 90 seconds when the value was projected (its asOf).',
  },
  {
    key: 'pipeline.lagP95Ms',
    unit: 'duration',
    grain: 'org',
    permission: 'orders:read',
    projection: 'pipeline',
    definition:
      "95th percentile of the metrics projector's lag (domain event written → projection committed) over the last 5 minutes, in milliseconds.",
  },
] as const satisfies readonly ProjectedMetricDef[];

export type ProjectedKey = (typeof PROJECTED_METRICS)[number]['key'];
export const PROJECTED_KEYS = PROJECTED_METRICS.map((m) => m.key) as unknown as readonly [
  ProjectedKey,
  ...ProjectedKey[],
];
const BY_KEY = new Map<string, ProjectedMetricDef>(PROJECTED_METRICS.map((m) => [m.key, m]));
export const projectedDef = (key: ProjectedKey) => BY_KEY.get(key) as ProjectedMetricDef;

/** Keys a permission may read (finance keys are finance-only, as in the registry). */
export const projectedKeysFor = (permission: ProjectedMetricDef['permission']): ProjectedKey[] =>
  PROJECTED_METRICS.filter((m) => m.permission === permission).map((m) => m.key);

/** The event-grain keys the `refresh` projection writes from the registry facts. */
export const REFRESH_REGISTRY_KEYS = METRICS.filter(
  (m) => m.key !== 'checkins.tickets' && m.key !== 'checkins.rate' && m.grains.includes('event' as never),
).map((m) => m.key) as MetricKey[];

/** Keys with time series. Money per currency; counts carry currency ''. */
export const SERIES_KEYS = [
  'sales.gross',
  'sales.refunds',
  'orders.sold',
  'tickets.sold',
  'tickets.refunded',
  'checkins.tickets',
] as const;
export type SeriesKey = (typeof SERIES_KEYS)[number];
/** Keys fed by orders and refunds (one recompute group); check-ins are the other group. */
export const SALES_SERIES_KEYS = SERIES_KEYS.filter((k) => k !== 'checkins.tickets');

export const BUCKETS = ['minute', 'hour'] as const;
export type Bucket = (typeof BUCKETS)[number];
const BUCKET_MS: Record<Bucket, number> = { minute: 60_000, hour: 3_600_000 };

/** The UTC bucket containing `at`. */
export function bucketStart(at: Date, bucket: Bucket): Date {
  const ms = BUCKET_MS[bucket];
  return new Date(Math.floor(at.getTime() / ms) * ms);
}
export const bucketEnd = (start: Date, bucket: Bucket) => new Date(start.getTime() + BUCKET_MS[bucket]);

/** Longest range one time-series read may cover (keeps a read to ≤ 1 440 / 2 160 points). */
export const MAX_RANGE_MS: Record<Bucket, number> = { minute: 24 * 3_600_000, hour: 90 * 24 * 3_600_000 };

/**
 * A row's shard: the last byte of its UUID modulo `count`. Postgres computes the same with
 * `get_byte(uuid_send(id), 15) % count`, so a source row and its projection always agree.
 */
export function metricShardOf(uuid: string, count: number): number {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('metricShardOf: not a UUID');
  return Number.parseInt(hex.slice(-2), 16) % count;
}

/** One stored time-series value (before summing shards). */
export interface SeriesPoint {
  readonly key: SeriesKey;
  readonly currency: string;
  readonly bucket: Bucket;
  readonly bucketStart: Date;
  readonly shard: number;
  readonly value: number;
}

type SalesRow = {
  bucketStart: Date;
  shard: number;
  currency: string;
  comp: boolean;
  orders: number;
  tickets: number;
  grossMinor: number;
};
type RefundRow = { bucketStart: Date; shard: number; currency: string; tickets: number; amountMinor: number };
type CheckinRow = { bucketStart: Date; shard: number; tickets: number };

/**
 * Pure: sales and refund facts per (bucket, shard) → the sales-group points, with the registry's
 * period semantics (tickets sold = paid non-comp tickets − refunded tickets, so it can be
 * negative). Zeros are dropped. Used by the projector and the rebuild alike.
 */
export function salesSeriesPoints(bucket: Bucket, sales: readonly SalesRow[], refunds: readonly RefundRow[]) {
  const acc = new Map<string, SeriesPoint>();
  const add = (key: SeriesKey, currency: string, start: Date, shard: number, v: number) => {
    const id = `${key}|${currency}|${start.toISOString()}|${shard}`;
    const prev = acc.get(id);
    acc.set(id, { key, currency, bucket, bucketStart: start, shard, value: (prev?.value ?? 0) + v });
  };
  for (const s of sales) {
    add('sales.gross', s.currency, s.bucketStart, s.shard, s.grossMinor);
    add('orders.sold', '', s.bucketStart, s.shard, s.orders);
    if (!s.comp) add('tickets.sold', '', s.bucketStart, s.shard, s.tickets);
  }
  for (const r of refunds) {
    add('sales.refunds', r.currency, r.bucketStart, r.shard, r.amountMinor);
    add('tickets.refunded', '', r.bucketStart, r.shard, r.tickets);
    add('tickets.sold', '', r.bucketStart, r.shard, -r.tickets);
  }
  return [...acc.values()].filter((p) => p.value !== 0);
}

/** Pure: check-in facts per (bucket, shard) → points (zeros dropped). */
export function checkinSeriesPoints(bucket: Bucket, rows: readonly CheckinRow[]): SeriesPoint[] {
  return rows
    .filter((r) => r.tickets !== 0)
    .map((r) => ({
      key: 'checkins.tickets' as const,
      currency: '',
      bucket,
      bucketStart: r.bucketStart,
      shard: r.shard,
      value: r.tickets,
    }));
}

/** Pure: sum shards → `key|currency|bucket|start` → value, zeros dropped (what a read sees). */
export function sumSeries(
  points: readonly { key: string; currency: string; bucket: string; bucketStart: Date; value: number }[],
) {
  const out = new Map<string, number>();
  for (const p of points) {
    const id = `${p.key}|${p.currency}|${p.bucket}|${p.bucketStart.toISOString()}`;
    out.set(id, (out.get(id) ?? 0) + p.value);
  }
  for (const [k, v] of out) if (v === 0) out.delete(k);
  return out;
}

/** Pure: nearest-rank percentile of samples (0 when empty). */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] as number;
}

export const ProjectedMetricValue = z.object({
  key: z.enum(PROJECTED_KEYS),
  unit: z.enum(['money', 'count', 'percent', 'duration']),
  /** Money only: ISO 4217. */
  currency: z.string().nullable(),
  value: z.int(),
  /** When the value was last projected (L1), or read (live fallback). */
  asOf: z.date(),
});
export type ProjectedMetricValue = z.infer<typeof ProjectedMetricValue>;
