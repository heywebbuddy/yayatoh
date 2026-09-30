/**
 * TypeScript twin of T4's exact item split (src/transforms/t4-commerce.ts): a legacy booking row of
 * quantity N carries totals (face, discount, fee, all-in, organizer net) in minor units. When every
 * total divides by N it is one item of N units; otherwise N−1 units at the floor and one unit with
 * the remainder, so units × quantity always sum back to the row's totals exactly.
 */
export interface RowTotals {
  readonly face: number;
  readonly discount: number;
  readonly fee: number;
  readonly allIn: number;
  readonly organizerNet: number;
}

export interface ItemPart extends RowTotals {
  readonly quantity: number;
}

export function splitRow(totals: RowTotals, quantity: number): ItemPart[] {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('quantity must be a positive integer');
  const keys = ['face', 'discount', 'fee', 'allIn', 'organizerNet'] as const;
  const floor = Object.fromEntries(
    keys.map((k) => [k, Math.floor(totals[k] / quantity)]),
  ) as unknown as RowTotals;
  if (keys.every((k) => floor[k] * quantity === totals[k])) return [{ ...floor, quantity }];
  const last = Object.fromEntries(
    keys.map((k) => [k, totals[k] - floor[k] * (quantity - 1)]),
  ) as unknown as RowTotals;
  return [
    { ...floor, quantity: quantity - 1 },
    { ...last, quantity: 1 },
  ];
}

/** Legacy money columns → minor units: `net_price − price + reward` is the fee added on top. */
export function rowTotals(row: {
  price: number;
  net: number;
  reward: number;
  earning: number | null;
}): RowTotals {
  const fee = Math.max(0, row.net - row.price + row.reward);
  return {
    face: row.price,
    discount: row.reward,
    fee,
    allIn: row.net,
    organizerNet: row.earning ?? row.net - fee,
  };
}

/** The order a legacy booking belongs to (per instance): one checkout, one event, one buyer. */
export const orderKey = (b: { common_order: string; event_id: number; customer_id: number }) =>
  `${b.common_order}|${b.event_id}|${b.customer_id}`;
