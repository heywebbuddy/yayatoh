import type { SeatRegion } from '@yayatoh/floorplan';

/** One price on the buyer's map. Ticket types at the same price share it, and its colour. */
export interface PriceLevel {
  readonly label: string;
  /** The place in the palette: cheapest first. */
  readonly index: number;
}

/**
 * The prices on sale on a map, cheapest first. Without amounts (an older caller) they keep the
 * order the labels came in; a label can't be sorted, as its format follows the locale.
 */
export function priceLevels(
  seats: readonly { readonly ticketTypeId: string }[],
  prices: Readonly<Record<string, string>>,
  amounts: Readonly<Record<string, number>> = {},
): PriceLevel[] {
  const cheapest = new Map<string, number>();
  for (const { ticketTypeId } of seats) {
    const label = prices[ticketTypeId];
    if (label === undefined) continue;
    const amount = amounts[ticketTypeId] ?? Number.POSITIVE_INFINITY;
    cheapest.set(label, Math.min(cheapest.get(label) ?? Number.POSITIVE_INFINITY, amount));
  }
  return [...cheapest.entries()]
    .map(([label, amount], order) => ({ label, amount, order }))
    .sort((a, b) => a.amount - b.amount || a.order - b.order)
    .map(({ label }, index) => ({ label, index }));
}

export interface SectionStats {
  /** Free seats, at the prices being shown. */
  readonly left: number;
  /** Free seats at any price: a section can have none at the prices shown, yet not be sold out. */
  readonly free: number;
  /** The cheapest of those, or null when there is none. */
  readonly from: PriceLevel | null;
}

/** For each section: how many seats a buyer can still choose, and from which price. */
export function sectionStats(
  regions: readonly SeatRegion[],
  available: ReadonlySet<string>,
  levelOf: (seatId: string) => PriceLevel | null,
  shownPrices: ReadonlySet<string>,
): ReadonlyMap<string, SectionStats> {
  return new Map(
    regions.map((region) => {
      let left = 0;
      let free = 0;
      let from: PriceLevel | null = null;
      for (const id of region.seatIds) {
        if (!available.has(id)) continue;
        free++;
        const level = levelOf(id);
        if (level && shownPrices.size > 0 && !shownPrices.has(level.label)) continue;
        left++;
        if (level && (!from || level.index < from.index)) from = level;
      }
      return [region.id, { left, free, from }];
    }),
  );
}
