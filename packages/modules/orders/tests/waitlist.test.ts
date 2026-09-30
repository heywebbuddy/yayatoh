import { describe, expect, it } from 'vitest';
import {
  canRejoin,
  compareQueue,
  DEFAULT_OFFER_MINUTES,
  isActive,
  MAX_OFFER_MINUTES,
  MIN_OFFER_MINUTES,
  offerExpiresAt,
  offerOpen,
  planOffers,
  queuePosition,
  sortQueue,
} from '../src/domain/waitlist.ts';

const at = (m: number) => new Date(Date.UTC(2027, 9, 1, 12, m));
const e = (id: string, quantity: number, minute: number) => ({ id, quantity, positionAt: at(minute) });

describe('waitlist queue ordering (M3.10a)', () => {
  it('orders by place in line, then by id for people who joined in the same instant', () => {
    const q = sortQueue([e('0003', 1, 5), e('0002', 1, 1), e('0001', 1, 5), e('0004', 1, 0)]);
    expect(q.map((x) => x.id)).toEqual(['0004', '0002', '0001', '0003']);
    expect(compareQueue(e('a', 1, 1), e('a', 2, 1))).toBe(0);
  });

  it('a rejoin (a later position) goes behind everyone already waiting', () => {
    const line = [e('amy', 1, 1), e('ben', 1, 2), e('cat', 1, 3)];
    const rejoined = { ...e('amy', 1, 9) };
    expect(sortQueue([rejoined, ...line.slice(1)]).map((x) => x.id)).toEqual(['ben', 'cat', 'amy']);
  });

  it('shows 1-based positions, null for someone not in the line', () => {
    const line = [e('b', 2, 2), e('a', 1, 1)];
    expect(queuePosition(line, 'a')).toBe(1);
    expect(queuePosition(line, 'b')).toBe(2);
    expect(queuePosition(line, 'z')).toBeNull();
  });

  it('offers in strict line order while each whole quantity fits', () => {
    const line = [e('a', 2, 1), e('b', 1, 2), e('c', 3, 3), e('d', 1, 4)];
    expect(planOffers(line, 3).map((x) => x.id)).toEqual(['a', 'b']);
    expect(planOffers(line, 7).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(planOffers(line, 0)).toEqual([]);
    expect(planOffers([], 5)).toEqual([]);
  });

  it('never skips the front of the line: a party that does not fit blocks those behind it', () => {
    const line = [e('party', 4, 1), e('single', 1, 2)];
    expect(planOffers(line, 3)).toEqual([]);
    expect(planOffers(line, 4).map((x) => x.id)).toEqual(['party']);
    expect(planOffers(line, 5).map((x) => x.id)).toEqual(['party', 'single']);
  });

  it("caps offers by the date's room as well as the pass's free stock", () => {
    const line = [e('a', 1, 1), e('b', 1, 2), e('c', 1, 3)];
    expect(planOffers(line, 5, 2).map((x) => x.id)).toEqual(['a', 'b']);
    expect(planOffers(line, 1, 5).map((x) => x.id)).toEqual(['a']);
    expect(planOffers(line, 5, null)).toHaveLength(3);
    expect(planOffers(line, 5, -3)).toEqual([]);
  });

  it('input order does not matter (the plan sorts)', () => {
    expect(planOffers([e('late', 1, 9), e('early', 1, 1)], 1).map((x) => x.id)).toEqual(['early']);
  });
});

describe('offer windows', () => {
  const now = new Date('2027-10-01T12:00:00.000Z');

  it('defaults to 24 hours; the window ends exactly at the expiry instant', () => {
    expect(DEFAULT_OFFER_MINUTES).toBe(1440);
    const end = offerExpiresAt(now, DEFAULT_OFFER_MINUTES);
    expect(end.toISOString()).toBe('2027-10-02T12:00:00.000Z');
    expect(offerOpen(end, new Date(end.getTime() - 1))).toBe(true);
    expect(offerOpen(end, end)).toBe(false);
    expect(offerOpen(end, new Date(end.getTime() + 1))).toBe(false);
    expect(offerOpen(null, now)).toBe(false);
  });

  it('accepts 15 minutes to 7 days, whole minutes only', () => {
    expect(offerExpiresAt(now, MIN_OFFER_MINUTES).getTime() - now.getTime()).toBe(15 * 60_000);
    expect(offerExpiresAt(now, MAX_OFFER_MINUTES).getTime() - now.getTime()).toBe(7 * 86_400_000);
    for (const bad of [14, MAX_OFFER_MINUTES + 1, 30.5, 0, -60])
      expect(() => offerExpiresAt(now, bad)).toThrow(RangeError);
  });

  it('only lapsed or declined offers may rejoin; waiting and offered places are active', () => {
    expect(['expired', 'declined'].every(canRejoin)).toBe(true);
    expect(['waiting', 'offered', 'accepted', 'left', 'removed'].some(canRejoin)).toBe(false);
    expect(['waiting', 'offered'].every(isActive)).toBe(true);
    expect(['accepted', 'expired', 'declined', 'left', 'removed'].some(isActive)).toBe(false);
  });
});
