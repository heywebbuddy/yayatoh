/**
 * Store credit on a cart (M3.10c): the credit note's balance is taken off the tickets' prices
 * (after any promo), the same amount off every ticket of a line so each ticket's price stays one
 * number (refunds and receipts stay per ticket). Lines are served dearest first; a ticket never
 * goes below zero and at most `budgetMinor` is used. What cannot be split evenly stays on the note.
 */
export function allocateCredit(
  lines: readonly { readonly unitNetMinor: number; readonly quantity: number; readonly eligible: boolean }[],
  budgetMinor: number,
): number[] {
  const out = lines.map(() => 0);
  let left = Math.max(0, Math.floor(budgetMinor));
  const order = lines
    .map((l, i) => ({ ...l, i }))
    .filter((l) => l.eligible && l.quantity > 0 && l.unitNetMinor > 0)
    .sort((a, b) => b.unitNetMinor - a.unitNetMinor || a.i - b.i);
  for (const l of order) {
    if (left <= 0) break;
    const unit = Math.min(l.unitNetMinor, Math.floor(left / l.quantity));
    out[l.i] = unit;
    left -= unit * l.quantity;
  }
  return out;
}
