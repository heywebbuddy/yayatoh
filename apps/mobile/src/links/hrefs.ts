/**
 * Turns the route `routeForLink` / `routeForPush` returns (a pathname with `[segments]` and
 * params) into the href Expo Router opens. Values are percent-encoded, so a link can only fill the
 * segments the screen declares; params the pathname has no segment for become query parameters.
 */
import type { AppRoute } from '@yayatoh/mobile-core';

export function hrefFor(route: AppRoute): string {
  let path = route.pathname;
  const query: string[] = [];
  for (const [key, value] of Object.entries(route.params)) {
    const segment = `[${key}]`;
    if (path.includes(segment)) path = path.replace(segment, encodeURIComponent(value));
    else query.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return query.length > 0 ? `${path}?${query.join('&')}` : path;
}
