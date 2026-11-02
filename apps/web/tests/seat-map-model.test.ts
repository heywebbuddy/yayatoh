import type { seatRegions } from '@yayatoh/floorplan';
import { describe, expect, it } from 'vitest';
import { priceLevels, sectionStats } from '../src/lib/seat-map-model.ts';

describe('priceLevels', () => {
  const seats = [{ ticketTypeId: 'gold' }, { ticketTypeId: 'silver' }, { ticketTypeId: 'bronze' }];

  it('orders prices by amount, not by how the label reads', () => {
    const levels = priceLevels(
      seats,
      { gold: '$1,000', silver: '$90', bronze: '$200' },
      { gold: 100_000, silver: 9_000, bronze: 20_000 },
    );
    expect(levels).toEqual([
      { label: '$90', index: 0 },
      { label: '$200', index: 1 },
      { label: '$1,000', index: 2 },
    ]);
  });

  it('makes ticket types at the same price one level', () => {
    const levels = priceLevels(
      seats,
      { gold: '$50', silver: '$50', bronze: '$20' },
      {
        gold: 5_000,
        silver: 5_000,
        bronze: 2_000,
      },
    );
    expect(levels.map((l) => l.label)).toEqual(['$20', '$50']);
  });

  it('keeps the given order without amounts, and skips seats with no price', () => {
    expect(priceLevels(seats, { gold: '$9', bronze: '$1' }).map((l) => l.label)).toEqual(['$9', '$1']);
  });
});

describe('sectionStats', () => {
  const regions = [{ id: 'r', seatIds: ['a', 'b', 'c'] }] as unknown as ReturnType<typeof seatRegions>;
  const cheap = { label: '$10', index: 0 };
  const dear = { label: '$99', index: 1 };
  const levelOf = (id: string) => (id === 'a' ? cheap : dear);

  it('counts free seats and finds the cheapest', () => {
    const stats = sectionStats(regions, new Set(['a', 'b']), levelOf, new Set());
    expect(stats.get('r')).toEqual({ left: 2, free: 2, from: cheap });
  });

  it('counts only the prices being shown', () => {
    const stats = sectionStats(regions, new Set(['a', 'b', 'c']), levelOf, new Set(['$99']));
    expect(stats.get('r')).toEqual({ left: 2, free: 3, from: dear });
  });

  it('tells a section with only other prices from a sold-out one', () => {
    const stats = sectionStats(regions, new Set(['a']), levelOf, new Set(['$99']));
    expect(stats.get('r')).toEqual({ left: 0, free: 1, from: null });
  });

  it('has nothing to offer when no seat is free', () => {
    expect(sectionStats(regions, new Set(), levelOf, new Set()).get('r')).toEqual({
      left: 0,
      free: 0,
      from: null,
    });
  });
});
