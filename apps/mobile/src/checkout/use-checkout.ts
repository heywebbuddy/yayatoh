/**
 * The checkout flow of one event (M7.3c, `payments`): start the checkout with an idempotency key, open
 * the provider's payment page in a secure browser session, and find out how it ended.
 *
 * - `paid` (a free cart): straight to the confirmation.
 * - `pay`: the hosted page opens in an auth session. It ends at the return link, at the cancel link,
 *   or when the person closes it. Whatever happened, the order is read from the server before anything
 *   is claimed: only a `paid` order is a purchase.
 * - `web`: the cart needs the web checkout (questions, seats, registration, a transfer fee, a chosen
 *   amount): the screen says why and opens the web page.
 * - `buy_on_web` (a 409): a pass gives access to a live stream. Apple does not allow selling that in
 *   the app (P7-7), so it is marked web-only and the rest of the cart is left alone.
 *
 * The same cart keeps its idempotency key, so a retry (a double tap, a dropped connection, "try again"
 * after a cancel) returns the same order and never makes a second one. Changing the cart makes a new key.
 */
import { useCore } from '@yayatoh/mobile-core';
import { unwrap } from '@yayatoh/sdk';
import { useCallback, useMemo, useState } from 'react';
import { type CheckoutResult, type MyOrder, shopKeys, useStartCheckout } from '../shop/api';
import { claimCheckout, clearCart, getCartEntry, releaseCheckout, updateCart } from '../shop/cart-store';
import { type Failure, failureOf } from '../shop/errors';
import { type CheckoutReturn, outcomeOfUrl } from '../shop/event-links';
import { useShopPorts } from '../shop/ports';
import { cartFingerprint } from '../shop/selection';

export type WebReason = NonNullable<CheckoutResult['webReason']>;

export type CheckoutState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'starting' }
  /** The payment page is open. */
  | { readonly phase: 'paying'; readonly orderId: string }
  /** Back from the page; reading the order to see whether it was paid. */
  | { readonly phase: 'confirming'; readonly orderId: string }
  /** Done: show the confirmation. `settled` is false when the provider has not confirmed yet. */
  | { readonly phase: 'done'; readonly orderId: string; readonly settled: boolean }
  /** The payment was cancelled or not completed. The cart is kept. */
  | { readonly phase: 'cancelled'; readonly orderId: string | null }
  | { readonly phase: 'web'; readonly reason: WebReason | null; readonly webUrl: string }
  | { readonly phase: 'buy_on_web'; readonly webUrl: string | null; readonly passIds: readonly string[] }
  | { readonly phase: 'failed'; readonly failure: Failure };

/** Reads of the order after a normal return (the provider confirms by webhook, a few seconds behind the page). */
const RETURNED_TRIES = 5;
/** Reads after the sheet was closed without a return link: the person may have paid just before closing. */
const CLOSED_TRIES = 2;
const SETTLE_WAIT_MS = 2_000;

export interface UseCheckoutOptions {
  readonly slug: string;
  /** The web origin, to know where the hosted page's return link points. */
  readonly webBase: string | null;
  /** A link for the app's own scheme to watch for when the web origin is not known. */
  readonly fallbackReturn: string;
  readonly name?: string | undefined;
}

export function useCheckout({ slug, webBase, fallbackReturn, name }: UseCheckoutOptions) {
  const core = useCore();
  const ports = useShopPorts();
  const start = useStartCheckout();
  const [state, setState] = useState<CheckoutState>({ phase: 'idle' });

  const readOrder = useCallback(
    (orderId: string): Promise<MyOrder> =>
      core.queryClient.fetchQuery({
        queryKey: shopKeys.order(orderId),
        staleTime: 0,
        queryFn: () => unwrap(core.api.GET('/v1/me/orders/{id}', { params: { path: { id: orderId } } })),
      }),
    [core],
  );

  /**
   * Finds out how the order stands, reading it up to `tries` times while it is not yet paid.
   * `returned` is true when the provider's page sent the person back through the return link.
   */
  const settle = useCallback(
    async (orderId: string, tries: number, returned: boolean): Promise<CheckoutState> => {
      setState({ phase: 'confirming', orderId });
      for (let attempt = 0; attempt < tries; attempt++) {
        try {
          const order = await readOrder(orderId);
          if (order.status === 'paid' || order.status === 'partially_refunded') {
            clearCart(slug);
            return { phase: 'done', orderId, settled: true };
          }
        } catch {
          // `/v1/me/orders` shows an order only once it is paid, so an unpaid one answers 404: not yet.
          // Offline or a server error leaves the order unknown, which reads the same way here.
        }
        if (attempt < tries - 1) await ports.wait(SETTLE_WAIT_MS);
      }
      // Not confirmed. Sent back through the return link means the person paid (the provider confirms
      // a few seconds later); the order screen keeps checking and says it is being confirmed. Anything
      // else is a payment not completed.
      if (returned) {
        clearCart(slug);
        return { phase: 'done', orderId, settled: false };
      }
      return { phase: 'cancelled', orderId };
    },
    [readOrder, ports, slug],
  );

  /** The result of a browser session, or of a return link that reopened the app. */
  const finish = useCallback(
    async (orderId: string, outcome: CheckoutReturn | null): Promise<void> => {
      // Even a cancel link is checked once: a payment may have gone through just before.
      const next =
        outcome === 'return'
          ? await settle(orderId, RETURNED_TRIES, true)
          : await settle(orderId, outcome === 'cancelled' ? 1 : CLOSED_TRIES, false);
      setState(next);
    },
    [settle],
  );

  const pay = useCallback(
    async (items: readonly { ticketTypeId: string; quantity: number }[]): Promise<void> => {
      // A second tap while a start or a payment is under way must not begin another one.
      if (!claimCheckout(slug)) return;
      try {
        const entry = getCartEntry(slug);
        const fingerprint = cartFingerprint(entry.cart, entry.occurrenceId, entry.promoCode);
        const key =
          entry.attempt && entry.attempt.fingerprint === fingerprint ? entry.attempt.key : ports.newKey();
        updateCart(slug, {
          attempt: {
            fingerprint,
            key,
            orderId: entry.attempt?.fingerprint === fingerprint ? entry.attempt.orderId : null,
          },
        });
        setState({ phase: 'starting' });

        let result: CheckoutResult;
        try {
          result = await start.mutateAsync({
            slug,
            key,
            items,
            occurrenceId: entry.occurrenceId ?? undefined,
            promoCode: entry.promoCode,
            name,
          });
        } catch (error) {
          const failure = failureOf(error);
          if (failure.kind === 'buy_on_web') {
            const ids = Array.isArray(failure.details.ticketTypeIds)
              ? (failure.details.ticketTypeIds as unknown[]).filter((v): v is string => typeof v === 'string')
              : [];
            const webUrl = typeof failure.details.webUrl === 'string' ? failure.details.webUrl : null;
            updateCart(slug, {
              webOnly: [...new Set([...getCartEntry(slug).webOnly, ...ids])],
              attempt: null,
            });
            setState({ phase: 'buy_on_web', webUrl, passIds: ids });
            return;
          }
          // An order that lapsed, or a key tied to another cart, needs a fresh start next time.
          if (failure.kind === 'hold_expired' || failure.kind === 'idempotency_reused')
            updateCart(slug, { attempt: null });
          setState({ phase: 'failed', failure });
          return;
        }

        if (result.action === 'web') {
          setState({ phase: 'web', reason: result.webReason, webUrl: result.webUrl ?? '' });
          return;
        }
        if (result.action === 'paid' && result.orderId) {
          clearCart(slug);
          setState({ phase: 'done', orderId: result.orderId, settled: true });
          return;
        }
        if (result.action === 'pay' && result.orderId && result.paymentUrl) {
          const orderId = result.orderId;
          updateCart(slug, { attempt: { fingerprint, key, orderId } });
          setState({ phase: 'paying', orderId });
          const returnPrefix = webBase ? `${webBase.replace(/\/+$/, '')}/events/${slug}` : fallbackReturn;
          const outcome = await ports.browser.openPayment(result.paymentUrl, returnPrefix);
          await finish(
            orderId,
            outcome.type === 'return' ? (outcomeOfUrl(outcome.url)?.outcome ?? null) : null,
          );
          return;
        }
        setState({ phase: 'failed', failure: { kind: 'unknown', retryAfter: null, details: {} } });
      } finally {
        releaseCheckout(slug);
      }
    },
    [slug, ports, start, name, webBase, fallbackReturn, finish],
  );

  /** The app was reopened by the return or cancel link for an order of this event. */
  const resume = useCallback(
    async (orderId: string, outcome: CheckoutReturn): Promise<void> => {
      if (!claimCheckout(slug)) {
        // The payment page is still open over the app: close it. `pay` is waiting on it and reads the order.
        await ports.browser.dismiss();
        return;
      }
      try {
        await ports.browser.dismiss();
        await finish(orderId, outcome);
      } finally {
        releaseCheckout(slug);
      }
    },
    [slug, ports, finish],
  );

  const openWeb = useCallback((url: string) => ports.browser.openWeb(url), [ports]);
  const reset = useCallback(() => setState({ phase: 'idle' }), []);

  return useMemo(
    () => ({ state, pay, resume, openWeb, reset, starting: state.phase === 'starting' }),
    [state, pay, resume, openWeb, reset],
  );
}
