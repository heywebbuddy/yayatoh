/**
 * The cart of each event (M7.3c), kept for the life of the app process, outside any screen. That is
 * what makes "cancel returns to the event with the selection intact" hold: the payment page opens over
 * the app, a cancel link brings the person back (to the same screen, or a new one opened by the link),
 * and the quantities, the date and the promo code are still there. Nothing is written to disk: a cart
 * is only ids and counts, and a killed app starts with an empty one.
 */
import { useSyncExternalStore } from 'react';
import type { Cart } from './selection';

/** One try at paying: its idempotency key stays while the cart does not change, so a retry never makes a second order. */
export interface Attempt {
  readonly fingerprint: string;
  readonly key: string;
  readonly orderId: string | null;
}

export interface CartEntry {
  readonly cart: Cart;
  readonly occurrenceId: string | null;
  readonly promoCode: string;
  /** Passes the server said are bought on the web (P7-7), learnt from a `buy_on_web` answer. */
  readonly webOnly: readonly string[];
  readonly attempt: Attempt | null;
}

const EMPTY: CartEntry = { cart: {}, occurrenceId: null, promoCode: '', webOnly: [], attempt: null };

const entries = new Map<string, CartEntry>();
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export const getCartEntry = (slug: string): CartEntry => entries.get(slug) ?? EMPTY;

export function updateCart(slug: string, patch: Partial<CartEntry>): void {
  entries.set(slug, { ...getCartEntry(slug), ...patch });
  emit();
}

export function clearCart(slug: string): void {
  entries.delete(slug);
  emit();
}

/** Forgets every cart (tests; the app has no reason to). */
export function clearAllCarts(): void {
  entries.clear();
  emit();
}

export function useCartEntry(slug: string): CartEntry {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => getCartEntry(slug),
    () => EMPTY,
  );
}
