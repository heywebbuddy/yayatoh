import { describe, expect, it } from 'vitest';
import { AnalyticsEvent, fakeAnalyticsSink } from '../src/analytics.ts';
import {
  bucketEnd,
  bucketStart,
  checkinSeriesPoints,
  MAX_RANGE_MS,
  metricShardOf,
  PROJECTED_KEYS,
  PROJECTED_METRICS,
  ProjectedMetricValue,
  percentile,
  projectedKeysFor,
  REFRESH_REGISTRY_KEYS,
  SERIES_KEYS,
  salesSeriesPoints,
  sumSeries,
} from '../src/metrics/catalog.ts';
import { CHECKIN_EVENTS, DEVICE_EVENTS, METRIC_EVENTS, REFRESH_EVENTS } from '../src/metrics/projector.ts';
import { checkinRateBps, METRICS } from '../src/metrics/registry.ts';

const t = (iso: string) => new Date(iso);

describe('bucketing (UTC)', () => {
  it('aligns minutes and hours, half-open', () => {
    const at = t('2028-06-01T23:41:59.999Z');
    expect(bucketStart(at, 'minute').toISOString()).toBe('2028-06-01T23:41:00.000Z');
    expect(bucketStart(at, 'hour').toISOString()).toBe('2028-06-01T23:00:00.000Z');
    expect(bucketEnd(bucketStart(at, 'hour'), 'hour').toISOString()).toBe('2028-06-02T00:00:00.000Z');
    // The first instant of a bucket belongs to it; the end belongs to the next.
    expect(bucketStart(t('2028-06-01T23:42:00Z'), 'minute').toISOString()).toBe('2028-06-01T23:42:00.000Z');
  });

  it('is independent of the event timezone (UTC buckets, including half-hour zones)', () => {
    // 05:30 in Kolkata is 00:00 UTC: it lands in the 00:00 UTC hour.
    expect(bucketStart(t('2028-06-02T05:30:00+05:30'), 'hour').toISOString()).toBe(
      '2028-06-02T00:00:00.000Z',
    );
  });

  it('limits a read to a day of minutes or 90 days of hours', () => {
    expect(MAX_RANGE_MS.minute).toBe(86_400_000);
    expect(MAX_RANGE_MS.hour).toBe(90 * 86_400_000);
  });
});

describe('sharding math', () => {
  it('uses the last byte of the UUID, as Postgres get_byte(uuid_send(id), 15) does', () => {
    expect(metricShardOf('0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f10ff', 8)).toBe(0xff % 8);
    expect(metricShardOf('0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1003', 8)).toBe(3);
    expect(metricShardOf('0190A1B2-C3D4-7E5F-8A6B-7C8D9E0F100A', 4)).toBe(10 % 4);
    expect(() => metricShardOf('not-a-uuid', 8)).toThrow();
  });

  it('spreads random ids over every shard', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 256; i++) {
      const hex = i.toString(16).padStart(2, '0');
      seen.add(metricShardOf(`0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f10${hex}`, 8));
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('shards add up to the total when summed on read', () => {
    const at = t('2028-06-01T23:00:00Z');
    const points = [0, 1, 2, 3].map((shard) => ({
      key: 'checkins.tickets',
      currency: '',
      bucket: 'hour',
      bucketStart: at,
      value: shard + 1,
    }));
    expect([...sumSeries(points)]).toEqual([['checkins.tickets||hour|2028-06-01T23:00:00.000Z', 10]]);
  });

  it('drops points that sum to zero', () => {
    const at = t('2028-06-01T23:00:00Z');
    const p = (value: number) => ({
      key: 'tickets.sold',
      currency: '',
      bucket: 'minute',
      bucketStart: at,
      value,
    });
    expect(sumSeries([p(2), p(-2)]).size).toBe(0);
  });
});

describe('series points', () => {
  const at = t('2028-06-01T23:10:00Z');
  it('sales: gross per currency, orders, tickets sold minus refunded (comps excluded)', () => {
    const points = salesSeriesPoints(
      'minute',
      [
        {
          bucketStart: at,
          shard: 1,
          currency: 'USD',
          comp: false,
          orders: 2,
          tickets: 5,
          grossMinor: 12_500,
        },
        { bucketStart: at, shard: 1, currency: 'USD', comp: true, orders: 1, tickets: 2, grossMinor: 0 },
      ],
      [{ bucketStart: at, shard: 1, currency: 'USD', tickets: 1, amountMinor: 2500 }],
    );
    const by = Object.fromEntries(points.map((p) => [`${p.key}|${p.currency}`, p.value]));
    expect(by).toEqual({
      'sales.gross|USD': 12_500,
      'orders.sold|': 3,
      'tickets.sold|': 4,
      'sales.refunds|USD': 2500,
      'tickets.refunded|': 1,
    });
  });

  it('a refund-only bucket makes tickets sold negative (period semantics)', () => {
    const points = salesSeriesPoints(
      'hour',
      [],
      [{ bucketStart: at, shard: 0, currency: 'EUR', tickets: 2, amountMinor: 8000 }],
    );
    expect(points.find((p) => p.key === 'tickets.sold')?.value).toBe(-2);
    expect(points.find((p) => p.key === 'sales.refunds')?.currency).toBe('EUR');
  });

  it('check-ins: one point per (bucket, shard), zeros dropped', () => {
    expect(
      checkinSeriesPoints('minute', [
        { bucketStart: at, shard: 2, tickets: 3 },
        { bucketStart: at, shard: 3, tickets: 0 },
      ]),
    ).toEqual([
      { key: 'checkins.tickets', currency: '', bucket: 'minute', bucketStart: at, shard: 2, value: 3 },
    ]);
  });
});

describe('catalog', () => {
  it('projects every registry metric with the same definition, plus operations metrics', () => {
    for (const m of METRICS) {
      const p = PROJECTED_METRICS.find((x) => x.key === m.key);
      expect(p?.definition).toBe(m.definition);
      expect(p?.permission).toBe(m.permission);
    }
    expect(PROJECTED_KEYS).toEqual(
      expect.arrayContaining(['devices.online', 'seats.occupied', 'tickets.distributed']),
    );
    expect(new Set(PROJECTED_KEYS).size).toBe(PROJECTED_KEYS.length);
  });

  it('finance keys are finance-only', () => {
    const finance = projectedKeysFor('finance:read');
    expect(finance.sort()).toEqual(['finance.disputesLost', 'finance.net', 'finance.platformFees']);
    expect(projectedKeysFor('orders:read')).not.toEqual(expect.arrayContaining(['finance.net']));
  });

  it('the hot counter and the rate are not in the refresh class', () => {
    expect(REFRESH_REGISTRY_KEYS).not.toContain('checkins.tickets');
    expect(REFRESH_REGISTRY_KEYS).not.toContain('checkins.rate');
    expect(PROJECTED_METRICS.find((m) => m.key === 'checkins.tickets')?.projection).toBe('counter');
  });

  it('every series key is a projected key', () => {
    for (const k of SERIES_KEYS) expect(PROJECTED_KEYS).toContain(k);
  });

  it('subscribes to each source event once', () => {
    expect(METRIC_EVENTS).toHaveLength(new Set(METRIC_EVENTS).size);
    expect(METRIC_EVENTS).toEqual([...REFRESH_EVENTS, ...CHECKIN_EVENTS, ...DEVICE_EVENTS]);
    for (const e of METRIC_EVENTS) expect(e).toMatch(/^[a-z_]+\.[a-z_]+@\d+$/);
  });

  it('rate: capped at 100 %, zero without valid tickets', () => {
    expect(checkinRateBps(5, 10)).toBe(5000);
    expect(checkinRateBps(12, 10)).toBe(10_000);
    expect(checkinRateBps(3, 0)).toBe(0);
  });

  it('percentile: nearest rank', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 95)).toBe(0);
  });
});

describe('DTOs (allowlists)', () => {
  it('a projected value has exactly its fields', () => {
    const v = ProjectedMetricValue.parse({
      key: 'devices.online',
      unit: 'count',
      currency: null,
      value: 3,
      asOf: new Date(),
      orgId: 'x',
      extra: 1,
    });
    expect(Object.keys(v).sort()).toEqual(['asOf', 'currency', 'key', 'unit', 'value']);
    expect(() =>
      ProjectedMetricValue.parse({ key: 'nope', unit: 'count', currency: null, value: 1, asOf: new Date() }),
    ).toThrow();
    expect(() =>
      ProjectedMetricValue.parse({
        key: 'orders.sold',
        unit: 'count',
        currency: null,
        value: 1.5,
        asOf: new Date(),
      }),
    ).toThrow();
  });

  it('analytics events keep only allowlisted properties', async () => {
    const base = {
      orgId: '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1003',
      eventId: null,
      occurredAt: new Date(),
      sourceEventId: '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1004',
      replayed: false,
    };
    const e = AnalyticsEvent.parse({
      ...base,
      name: 'order_paid',
      props: { currency: 'USD', totalMinor: 100, channel: 'online', email: 'a@b.test', buyerName: 'Ann' },
      buyerEmail: 'a@b.test',
    });
    expect(JSON.stringify(e)).not.toMatch(/a@b\.test|Ann/);
    expect(() =>
      AnalyticsEvent.parse({
        ...base,
        name: 'order_paid',
        props: { currency: 'usd', totalMinor: 1, channel: 'online' },
      }),
    ).toThrow();
    expect(() => AnalyticsEvent.parse({ ...base, name: 'user_signed_up', props: {} })).toThrow();
    const sink = fakeAnalyticsSink();
    await sink.emit({} as never, { ...base, name: 'ticket_admitted', props: { offline: true } });
    expect(sink.events).toHaveLength(1);
  });
});
