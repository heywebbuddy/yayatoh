/** How the checkout's return and cancel links come back to the event screen (M7.2f, M7.3c). */

export type CheckoutReturn = 'return' | 'cancelled';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The markers a return link carries: `?checkout=return|cancelled&order={id}`. Anything else is ignored,
 * so a made-up link cannot open another person's order: the order screen asks the server, which only
 * answers for the signed-in person's own orders.
 */
export function parseCheckoutReturn(
  checkout: string | string[] | undefined,
  order: string | string[] | undefined,
): { readonly outcome: CheckoutReturn; readonly orderId: string | null } | null {
  const c = Array.isArray(checkout) ? checkout[0] : checkout;
  const o = Array.isArray(order) ? order[0] : order;
  if (c !== 'return' && c !== 'cancelled') return null;
  return { outcome: c, orderId: o && UUID.test(o) ? o : null };
}

/** The outcome in a return URL the browser session ended on (`…/events/slug?checkout=return&order=…`). */
export function outcomeOfUrl(url: string): { readonly outcome: CheckoutReturn; readonly orderId: string | null } | null {
  const query = url.split('#')[0]?.split('?')[1];
  if (!query) return null;
  const params = new Map<string, string>();
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (eq > 0) params.set(decodeURIComponent(pair.slice(0, eq)), decodeURIComponent(pair.slice(eq + 1)));
  }
  return parseCheckoutReturn(params.get('checkout'), params.get('order'));
}
