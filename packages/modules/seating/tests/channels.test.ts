import { describe, expect, it } from 'vitest';
import {
  type ChannelRef,
  channelHolds,
  normalizeChannelCode,
  saleChannel,
  seatNumberList,
  sellableThrough,
} from '../src/index.ts';

const now = new Date('2029-06-01T12:00:00Z');
const later = new Date('2029-06-02T12:00:00Z');
const earlier = new Date('2029-05-31T12:00:00Z');
const ch = (
  id: string,
  kind: ChannelRef['kind'],
  code: string | null = null,
  releaseAt: Date | null = null,
) => ({
  id,
  kind,
  code,
  releaseAt,
});
const channels = [
  ch('pub', 'public'),
  ch('box', 'box_office'),
  ch('promo', 'promoter', 'DJ-KAI'),
  ch('spons', 'sponsor', 'ACME2029', earlier),
];

describe('sales channels (M6.11b)', () => {
  it('a seat in a channel sells only through that channel until its release', () => {
    expect(sellableThrough(null, null, now)).toBe(true);
    expect(sellableThrough(null, 'promo', now)).toBe(true);
    const promo = ch('promo', 'promoter', 'DJ-KAI', later);
    expect(sellableThrough(promo, 'promo', now)).toBe(true);
    expect(sellableThrough(promo, null, now)).toBe(false);
    expect(sellableThrough(promo, 'pub', now)).toBe(false);
    expect(sellableThrough(promo, 'box', now)).toBe(false);
    // Released: unsold seats go back to every channel.
    expect(sellableThrough(promo, null, later)).toBe(true);
    expect(sellableThrough(promo, 'box', new Date(later.getTime() + 1))).toBe(true);
    // No release time: kept for good.
    expect(sellableThrough(ch('x', 'sponsor', 'ABC'), null, new Date('2099-01-01'))).toBe(false);
    expect(channelHolds({ releaseAt: later }, now)).toBe(true);
    expect(channelHolds({ releaseAt: now }, now)).toBe(false);
  });

  it('every sale goes through exactly one channel; an unknown code never falls back to the public', () => {
    expect(saleChannel(channels, { via: 'online' })?.valueOf()).toMatchObject({ id: 'pub' });
    expect(saleChannel(channels, { via: 'online', code: '' })).toMatchObject({ id: 'pub' });
    expect(saleChannel(channels, { via: 'online', code: ' dj-kai ' })).toMatchObject({ id: 'promo' });
    expect(saleChannel(channels, { via: 'online', code: 'acme2029' })).toMatchObject({ id: 'spons' });
    expect(saleChannel(channels, { via: 'online', code: 'NOPE' })).toBe('invalid_code');
    expect(saleChannel(channels, { via: 'online', code: '!' })).toBe('invalid_code');
    expect(saleChannel(channels, { via: 'box_office', code: 'DJ-KAI' })).toMatchObject({ id: 'box' });
    expect(saleChannel([], { via: 'online' })).toBeNull();
    expect(saleChannel([], { via: 'box_office' })).toBeNull();
  });

  it('codes are 3–32 letters, digits or dashes, kept upper-case', () => {
    expect(normalizeChannelCode(' summer-24 ')).toBe('SUMMER-24');
    expect(normalizeChannelCode('ab')).toBeNull();
    expect(normalizeChannelCode('-AB')).toBeNull();
    expect(normalizeChannelCode('A B C')).toBeNull();
    expect(normalizeChannelCode('vip_2029')).toBe('VIP_2029');
    expect(normalizeChannelCode('A'.repeat(33))).toBeNull();
    expect(normalizeChannelCode(null)).toBeNull();
  });

  it('seat numbers typed with ranges', () => {
    expect([...seatNumberList('1, 2; 5-7 A')]).toEqual(['1', '2', '5', '6', '7', 'a']);
    expect([...seatNumberList('9-3')]).toEqual(['9-3']);
    expect(seatNumberList('1-600').size).toBe(1);
    expect(seatNumberList(' ').size).toBe(0);
  });
});
