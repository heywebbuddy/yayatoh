/**
 * A tapped push opens its screen (M7.3d). The server puts the route in `data.path`
 * (`/tickets/{id}`, `/orders/{id}`, `/events/{slug}`); `routeForPush` accepts only those three, so a
 * tampered payload opens nothing. A ticket or an order needs sign-in: signed out, the tap is kept
 * and the person goes to the front door, then lands on the ticket once they have signed in.
 */
import { routeForPush } from '@yayatoh/mobile-core';
import { hrefFor } from '../links/hrefs';
import { needsSignIn } from '../links/incoming';
import { rememberPendingHref } from '../links/pending';
import type { IncomingPush } from './port';

/** The href to open for a tapped push, or null when its payload names no screen of ours. */
export function hrefForPush(push: IncomingPush, signedIn: boolean): { href: string; resume: boolean } | null {
  const route = routeForPush(push.data);
  if (!route) return null;
  const href = hrefFor(route);
  if (needsSignIn(route.pathname) && !signedIn) {
    rememberPendingHref(href);
    return { href: '/', resume: true };
  }
  return { href, resume: false };
}

/** Remembers which taps were handled, so a notification is never opened twice (cold start + listener). */
export function createTapLedger(limit = 50) {
  const seen: string[] = [];
  return {
    /** True the first time `id` is seen. */
    first(id: string): boolean {
      if (seen.includes(id)) return false;
      seen.push(id);
      if (seen.length > limit) seen.shift();
      return true;
    },
  };
}
