/**
 * What happens to a link that opens the app (M7.3d): universal links (`https://abc.yayatoh.events/
 * events/summit`), app-scheme links (`yayatoh://claim/…`) and the checkout return link. Expo
 * Router asks `redirectSystemPath` (`app/+native-intent.ts`) about every incoming URL on a cold
 * start, a warm start and while the app is in front; this is its logic, free of React and native
 * modules so it runs under Jest.
 *
 * - The path allowlist is `routeForLink`'s (the same one the server publishes for the associated
 *   domains). A link on one of our hosts that is not on it opens Home instead of a "not found".
 * - A link that is not ours at all (the development client's own URL) is passed through untouched.
 * - Routes that show a person's own tickets or orders need sign-in. Signed out, the link is kept and
 *   the person goes to the front door; the root layout opens the link once they have signed in.
 * - The checkout return link (`…/events/{slug}?checkout=return&order={id}`, M7.2f) opens the event
 *   screen with its two markers (it opens the confirmation, M7.3c), and counts as the first-purchase
 *   moment for the notification prompt.
 */
import { PLATFORM_HOSTS, ROUTES, routeForLink } from '@yayatoh/mobile-core';
import { hrefFor } from './hrefs';
import { rememberPendingHref } from './pending';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Routes a person must be signed in to see. `claim` is not here: its screen explains the claim first. */
const NEEDS_SIGN_IN: readonly string[] = [ROUTES.ticket, ROUTES.ticketLink, ROUTES.order, ROUTES.orderLink];

export const needsSignIn = (pathname: string): boolean => NEEDS_SIGN_IN.includes(pathname);

export interface IncomingDeps {
  readonly tenantDomain?: string;
  readonly schemes?: readonly string[];
  /** Resolves once the session is known (restored from secure storage). */
  readonly isSignedIn: () => Promise<boolean>;
  /** The first-purchase moment (checkout return link). */
  readonly onPurchase: () => void;
}

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

function isOurs(url: string, deps: IncomingDeps): boolean {
  const scheme = SCHEME.exec(url)?.[1]?.toLowerCase();
  if (!scheme) return true; // a bare path
  if (scheme === 'https') {
    const host = /^https:\/\/([^/?#]*)/i.exec(url)?.[1]?.toLowerCase() ?? '';
    const tenant = (deps.tenantDomain ?? 'yayatoh.events').toLowerCase();
    return (PLATFORM_HOSTS as readonly string[]).includes(host) || host.endsWith(`.${tenant}`);
  }
  // `yayatoh://…`, `yayatoh-dev://…`; not `exp+yayatoh://expo-development-client/…`.
  return /^yayatoh(?:-dev|-preview)?$/.test(scheme);
}

function queryOf(url: string): URLSearchParams {
  const q = /\?([^#]*)/.exec(url)?.[1] ?? '';
  return new URLSearchParams(q);
}

/** The href Expo Router should open for `url`, or `url` itself when it is not one of ours. */
export async function resolveIncomingUrl(url: string | null, deps: IncomingDeps): Promise<string> {
  if (!url) return '/';
  if (!isOurs(url, deps)) return url;
  // Expo Router may hand over a bare path; give it a host to be judged by.
  const full = url.startsWith('/') ? `https://app.yayatoh.com${url}` : url;
  const options = {
    app: 'mobile',
    ...(deps.tenantDomain ? { tenantDomain: deps.tenantDomain } : {}),
    ...(deps.schemes ? { schemes: deps.schemes } : {}),
  } as const;

  let route = routeForLink(full, options);
  if (!route) return '/';

  // The checkout's return and cancel links (M7.2f) land on the event screen with two markers it reads
  // (M7.3c). They are kept here, validated, whatever `routeForLink` keeps, so the screen gets them
  // either way; a return also counts as the first-purchase moment for the notification prompt.
  if (route.pathname === ROUTES.event) {
    const checkout = queryOf(full).get('checkout');
    const order = queryOf(full).get('order');
    if ((checkout === 'return' || checkout === 'cancelled') && order && UUID.test(order)) {
      route = { ...route, params: { ...route.params, checkout, order } };
      if (checkout === 'return') deps.onPurchase();
    }
  }

  const href = hrefFor(route);
  if (needsSignIn(route.pathname) && !(await deps.isSignedIn())) {
    rememberPendingHref(href);
    return '/';
  }
  return href;
}
