/**
 * Per-type capacity maths (M5.1a), pure. The counter (held + sold) lives on the type row with a
 * CHECK; open waitlist offers and people waiting are kept back like M3.10a keeps them for a pass.
 */

export interface TypeCounter {
  /** Null: no limit for this type. */
  readonly capacity: number | null;
  readonly held: number;
  readonly sold: number;
}

export interface Demand {
  /** Places the type's open waitlist offers hold. */
  readonly offered: number;
  /** Places people on the type's lines wait for. */
  readonly waiting: number;
}

/** Places a buyer outside the waitlist may take now (null = unlimited). */
export function publicRoom(c: TypeCounter, d: Demand): number | null {
  if (c.capacity === null) return null;
  return Math.max(0, c.capacity - c.held - c.sold - d.offered - d.waiting);
}

/** Places free for offers to the people waiting (null = unlimited: nobody waits). */
export function offerRoom(c: TypeCounter, d: Pick<Demand, 'offered'>): number | null {
  if (c.capacity === null) return null;
  return Math.max(0, c.capacity - c.held - c.sold - d.offered);
}

/** The lowest capacity an organizer may set: what is held, sold or offered already. */
export function capacityFloor(c: Omit<TypeCounter, 'capacity'>, d: Pick<Demand, 'offered'>): number {
  return c.held + c.sold + d.offered;
}

export interface Claim {
  readonly held: number;
  readonly sold: number;
}

/** What to add to the counter to move a claim from `prev` to `next` (both non-negative). */
export function claimDelta(prev: Claim, next: Claim): Claim & { readonly changed: boolean } {
  const held = next.held - prev.held;
  const sold = next.sold - prev.sold;
  return { held, sold, changed: held !== 0 || sold !== 0 };
}

/** The part of an order's per-ticket-type quantities that falls on the given ticket types. */
export function countOn(quantities: ReadonlyMap<string, number>, ticketTypeIds: ReadonlySet<string>): number {
  let n = 0;
  for (const [id, q] of quantities) if (ticketTypeIds.has(id)) n += q;
  return n;
}

/**
 * The waiting people to offer to now, strictly in line order: stop at the first one whose places
 * don't fit (someone behind them never jumps the line).
 */
export function planTypeOffers<T extends { readonly quantity: number }>(
  waiting: readonly T[],
  room: number,
): T[] {
  const out: T[] = [];
  let left = room;
  for (const w of waiting) {
    if (w.quantity > left) break;
    out.push(w);
    left -= w.quantity;
  }
  return out;
}
