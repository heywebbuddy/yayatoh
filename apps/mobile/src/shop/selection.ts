/**
 * Ticket selection with the web's rules (M7.3c). The page lists the on-sale passes with their all-in
 * prices; the person picks quantities. A pass can be chosen only while it is `available`; a
 * quantity is 0, or from the pass's minimum to its per-order maximum. The server prices and checks
 * the cart again (limits per buyer, sales windows, promo codes) and its answer wins: this module only
 * keeps the screen from offering what the page would not.
 */
import type { Schemas } from '@yayatoh/sdk';

export type Pass = Schemas['PublicTicketType'];
/** Quantities by pass id; passes at zero are absent. */
export type Cart = Readonly<Record<string, number>>;

export type PassStatus =
  | 'buyable'
  | 'sold_out'
  | 'not_yet_on_sale'
  | 'sales_ended'
  /** Gives access to a live stream (or the whole event is online): bought on the web (P7-7). */
  | 'web_only';

export function passStatus(pass: Pass, webOnly: ReadonlySet<string>, eventIsOnline: boolean): PassStatus {
  if (pass.availability !== 'available') return pass.availability;
  return eventIsOnline || webOnly.has(pass.id) ? 'web_only' : 'buyable';
}

/** The largest quantity of `pass` one order may hold. */
export const maxQuantity = (pass: Pass): number => Math.max(0, pass.maxPerOrder);
/** The smallest non-zero quantity (some passes sell in packs of two or more). */
export const minQuantity = (pass: Pass): number => Math.min(Math.max(1, pass.minPerOrder), maxQuantity(pass));

/** One step up or down, jumping between 0 and the minimum and stopping at the maximum. */
export function stepQuantity(pass: Pass, current: number, direction: 1 | -1): number {
  const max = maxQuantity(pass);
  const min = minQuantity(pass);
  if (max === 0) return 0;
  if (direction === 1) return current <= 0 ? min : Math.min(current + 1, max);
  return current <= min ? 0 : current - 1;
}

/** The cart with `pass` set to `quantity` (clamped to what the pass allows). */
export function withQuantity(cart: Cart, pass: Pass, quantity: number): Cart {
  const next = { ...cart };
  const q = Math.floor(quantity);
  const max = maxQuantity(pass);
  const clamped = q <= 0 || max === 0 ? 0 : q < minQuantity(pass) ? minQuantity(pass) : Math.min(q, max);
  if (clamped === 0) delete next[pass.id];
  else next[pass.id] = clamped;
  return next;
}

export interface CartLine {
  readonly pass: Pass;
  readonly quantity: number;
  readonly lineMinor: number;
}

export interface CartSummary {
  readonly lines: readonly CartLine[];
  readonly count: number;
  readonly totalMinor: number;
  readonly currency: string | null;
}

/** The lines, ticket count and the all-in total the screen shows (the server's price is final). */
export function summarize(passes: readonly Pass[], cart: Cart): CartSummary {
  const lines: CartLine[] = [];
  for (const pass of passes) {
    const quantity = cart[pass.id] ?? 0;
    if (quantity > 0) lines.push({ pass, quantity, lineMinor: pass.allInMinor * quantity });
  }
  return {
    lines,
    count: lines.reduce((n, l) => n + l.quantity, 0),
    totalMinor: lines.reduce((n, l) => n + l.lineMinor, 0),
    currency: lines[0]?.pass.currency ?? null,
  };
}

export type CartIssue =
  | { readonly kind: 'empty' }
  | { readonly kind: 'unavailable'; readonly passId: string }
  | { readonly kind: 'below_minimum'; readonly passId: string; readonly minimum: number }
  | { readonly kind: 'above_maximum'; readonly passId: string; readonly maximum: number }
  | { readonly kind: 'web_only'; readonly passId: string };

/**
 * What stops this cart from going to checkout. The page may have changed under the person (a pass
 * sold out, a sale ended) between choosing and paying, so the checkout screen asks again.
 */
export function cartIssues(
  passes: readonly Pass[],
  cart: Cart,
  webOnly: ReadonlySet<string>,
  eventIsOnline: boolean,
): CartIssue[] {
  const issues: CartIssue[] = [];
  const entries = Object.entries(cart).filter(([, q]) => q > 0);
  if (entries.length === 0) return [{ kind: 'empty' }];
  for (const [passId, quantity] of entries) {
    const pass = passes.find((p) => p.id === passId);
    if (!pass) {
      issues.push({ kind: 'unavailable', passId });
      continue;
    }
    const status = passStatus(pass, webOnly, eventIsOnline);
    if (status === 'web_only') issues.push({ kind: 'web_only', passId });
    else if (status !== 'buyable') issues.push({ kind: 'unavailable', passId });
    else if (quantity < minQuantity(pass))
      issues.push({ kind: 'below_minimum', passId, minimum: minQuantity(pass) });
    else if (quantity > maxQuantity(pass))
      issues.push({ kind: 'above_maximum', passId, maximum: maxQuantity(pass) });
  }
  return issues;
}

/** A stable text for "the same cart", so a retry reuses its idempotency key and a changed cart gets a new one. */
export function cartFingerprint(cart: Cart, occurrenceId: string | null, promoCode: string): string {
  const items = Object.entries(cart)
    .filter(([, q]) => q > 0)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, q]) => `${id}:${q}`)
    .join(',');
  return `${items}|${occurrenceId ?? ''}|${promoCode.trim().toLowerCase()}`;
}
