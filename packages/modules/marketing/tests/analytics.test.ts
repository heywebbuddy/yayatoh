import { describe, expect, it } from 'vitest';
import { bpsToPct } from '../src/analytics.ts';
import {
  type AggregateInput,
  type AnalyticsLink,
  type AttributionFact,
  aggregate,
  dayRange,
  parseCampaignKey,
} from '../src/domain/analytics.ts';

const C1 = '01900000-0000-7000-8000-000000000001';
const link = (id: string, over: Partial<AnalyticsLink> = {}): AnalyticsLink => ({
  id,
  campaignId: null,
  medium: 'email',
  campaign: 'spring',
  ...over,
});
const range = { from: new Date('2027-05-01T05:00:00Z'), to: new Date('2027-06-01T05:00:00Z') };
const inside = new Date('2027-05-20T12:00:00Z');
const order = (orderId: string, totalMinor: number, currency = 'USD', createdAt = inside, sold = true) => ({
  orderId,
  totalMinor,
  currency,
  createdAt,
  sold,
});
const click = (orderId: string, first: string, last: string): AttributionFact => ({
  orderId,
  model: 'click',
  firstLinkId: first,
  lastLinkId: last,
  utmMedium: null,
  utmCampaign: null,
  firstUtmMedium: null,
  firstUtmCampaign: null,
});
const utm = (
  orderId: string,
  medium: string | null,
  campaign: string | null,
  first?: string,
): AttributionFact => ({
  orderId,
  model: 'utm',
  firstLinkId: null,
  lastLinkId: null,
  utmMedium: medium,
  utmCampaign: campaign,
  firstUtmMedium: medium,
  firstUtmCampaign: first ?? campaign,
});

function base(over: Partial<AggregateInput> = {}): AggregateInput {
  const links = [
    link('A', { campaignId: C1, campaign: 'launch' }),
    link('B', { medium: 'social', campaign: 'social' }),
  ];
  return {
    dimension: 'campaign',
    currency: 'USD',
    links,
    clicks: [
      { linkId: 'A', visitor: 'd1', clicks: 1 },
      { linkId: 'B', visitor: 'd1', clicks: 1 },
      { linkId: 'A', visitor: 'd2', clicks: 1 },
      { linkId: 'A', visitor: 'd3', clicks: 2 },
      { linkId: 'B', visitor: 'd4', clicks: 1 },
    ],
    attributions: [click('o1', 'A', 'B'), click('o2', 'A', 'A'), utm('o3', 'audio', 'podcast')],
    orders: new Map([
      ['o1', order('o1', 2500)],
      ['o2', order('o2', 5000)],
      ['o3', order('o3', 2500)],
    ]),
    range,
    sends: [{ campaignId: C1, channel: 'email', sent: 120, delivered: 112 }],
    ...over,
  };
}

describe('marketing analytics: first- and last-touch credit', () => {
  it('credits each sold order once first touch and once last touch, per campaign', () => {
    const { rows, totals } = aggregate(base());
    expect(
      rows.map((r) => [
        r.key,
        r.sends,
        r.clicks,
        r.uniqueClickers,
        r.firstTouch,
        r.lastTouch,
        r.conversionBps,
      ]),
    ).toEqual([
      [`c.${C1}`, 120, 4, 3, { orders: 2, revenueMinor: 7500 }, { orders: 1, revenueMinor: 5000 }, 2500],
      ['u.social', null, 2, 2, { orders: 0, revenueMinor: 0 }, { orders: 1, revenueMinor: 2500 }, 5000],
      ['u.podcast', null, 0, 0, { orders: 1, revenueMinor: 2500 }, { orders: 1, revenueMinor: 2500 }, 0],
    ]);
    expect(totals).toMatchObject({
      sends: 120,
      deliveries: 112,
      clicks: 6,
      uniqueClickers: 4,
      firstTouch: { orders: 3, revenueMinor: 10_000 },
      lastTouch: { orders: 3, revenueMinor: 10_000 },
      conversionBps: 5000,
    });
  });

  it('per channel and per link; UTM-only orders have no link row but count in the totals', () => {
    const ch = aggregate(base({ dimension: 'channel' }));
    expect(ch.rows.map((r) => [r.key, r.sends, r.lastTouch.orders])).toEqual([
      ['m.email', 120, 1],
      ['m.social', null, 1],
      ['m.audio', null, 1],
    ]);
    const ln = aggregate(base({ dimension: 'link' }));
    expect(ln.rows.map((r) => [r.key, r.firstTouch.orders, r.lastTouch.orders])).toEqual([
      ['l.A', 2, 1],
      ['l.B', 0, 1],
    ]);
    expect(ln.totals.lastTouch.orders).toBe(3);
  });

  it('only sold orders created inside the range count; other currencies are counted, never added', () => {
    const { rows, totals } = aggregate(
      base({
        orders: new Map([
          ['o1', order('o1', 2500, 'USD', new Date('2027-04-30T12:00:00Z'))],
          ['o2', order('o2', 5000, 'USD', inside, false)],
          ['o3', order('o3', 3000, 'EUR')],
        ]),
      }),
    );
    expect(totals.lastTouch).toEqual({ orders: 1, revenueMinor: 0 });
    expect(totals.otherCurrencyOrders).toBe(1);
    expect(rows.find((r) => r.key === 'u.podcast')).toMatchObject({
      lastTouch: { orders: 1, revenueMinor: 0 },
      otherCurrencyOrders: 1,
    });
    // The range's end is exclusive.
    const edge = aggregate(base({ orders: new Map([['o2', order('o2', 5000, 'USD', range.to)]]) }));
    expect(edge.totals.lastTouch.orders).toBe(0);
  });

  it('a link nobody clicked still has its row; a UTM-only first touch uses the first landing', () => {
    const r = aggregate(
      base({
        links: [...base().links, link('C', { campaign: 'quiet' })],
        attributions: [utm('o3', 'audio', 'last-podcast', 'first-podcast')],
      }),
    );
    expect(r.rows.find((x) => x.key === 'u.quiet')).toMatchObject({ clicks: 0, lastTouch: { orders: 0 } });
    expect(r.rows.find((x) => x.key === 'u.first-podcast')?.firstTouch.orders).toBe(1);
    expect(r.rows.find((x) => x.key === 'u.last-podcast')?.lastTouch.orders).toBe(1);
  });

  it('conversion is last-touch orders per click in basis points (rounded)', () => {
    const r = aggregate(
      base({ clicks: [{ linkId: 'A', visitor: 'x', clicks: 3 }], attributions: [click('o2', 'A', 'A')] }),
    );
    expect(r.rows[0]?.conversionBps).toBe(3333);
    expect(bpsToPct(3333)).toBe('33.33');
    expect(bpsToPct(2500)).toBe('25.00');
    expect(bpsToPct(5)).toBe('0.05');
    expect(bpsToPct(0)).toBe('0.00');
  });
});

describe('date range in the org’s time zone', () => {
  const now = new Date('2027-03-15T03:30:00Z'); // 22:30 on the 14th in Chicago

  it('defaults to the last 30 days up to today (the zone’s today)', () => {
    const r = dayRange({}, 'America/Chicago', now);
    expect(r).toMatchObject({ fromDay: '2027-02-13', toDay: '2027-03-14' });
    if ('problem' in r) throw new Error('unexpected');
    expect(r.from.toISOString()).toBe('2027-02-13T06:00:00.000Z');
    // Daylight saving started on March 14: midnight after the 14th is 05:00 UTC.
    expect(r.to.toISOString()).toBe('2027-03-15T05:00:00.000Z');
  });

  it('the last N days up to today, in the zone (batch 3g: the Command Center tile)', () => {
    expect(dayRange({ days: 90 }, 'America/Chicago', now)).toMatchObject({
      fromDay: '2026-12-15',
      toDay: '2027-03-14',
    });
    expect(dayRange({ days: 1 }, 'UTC', now)).toMatchObject({ fromDay: '2027-03-15', toDay: '2027-03-15' });
  });

  it('a day across the DST change is 23 hours long', () => {
    const r = dayRange({ from: '2027-03-14', to: '2027-03-14' }, 'America/Chicago', now);
    if ('problem' in r) throw new Error('unexpected');
    expect(r.to.getTime() - r.from.getTime()).toBe(23 * 3_600_000);
  });

  it('refuses bad input', () => {
    expect(dayRange({ from: '2027-02-30', to: '2027-03-01' }, 'UTC', now)).toEqual({
      problem: 'invalid_date',
    });
    expect(dayRange({ from: 'yesterday' }, 'UTC', now)).toEqual({ problem: 'invalid_date' });
    expect(dayRange({ from: '2027-03-02', to: '2027-03-01' }, 'UTC', now)).toEqual({
      problem: 'from_after_to',
    });
    expect(dayRange({ from: '2026-01-01', to: '2027-01-02' }, 'UTC', now)).toEqual({
      problem: 'range_too_long',
    });
    expect('problem' in dayRange({ from: '2026-01-02', to: '2027-01-02' }, 'UTC', now)).toBe(false);
  });
});

describe('campaign keys', () => {
  it('parses campaign and UTM keys, refuses anything else', () => {
    expect(parseCampaignKey(`c.${C1}`)).toEqual({ kind: 'campaign', id: C1 });
    expect(parseCampaignKey('u.spring')).toEqual({ kind: 'utm', campaign: 'spring' });
    expect(parseCampaignKey('u.')).toEqual({ kind: 'utm', campaign: '' });
    expect(parseCampaignKey('c.nope')).toBeNull();
    expect(parseCampaignKey('l.x')).toBeNull();
    expect(parseCampaignKey(`u.${'x'.repeat(101)}`)).toBeNull();
  });
});
