import { UTM_KEYS, type Utm } from './utm.ts';

/**
 * Open-redirect guard (M3.8a). A tracked link's destination is a **path** on the host that served
 * the redirect, never a URL: the Location is built from the request's own origin and checked to
 * still be on it. Stored paths are validated when the link is created and again on every redirect.
 */

export type DestinationProblem = 'not_a_path' | 'too_long' | 'invalid_characters';

export const MAX_DESTINATION_LENGTH = 300;
// Unreserved characters, sub-delims that are harmless in a path, and "/" and "%".
const PATH_CHARS = /^[A-Za-z0-9\-._~/%!$&'()*+,;=@]*$/;
// Encoded slash, backslash, dot and control characters would let a normalizing hop rewrite it.
const BAD_ESCAPE = /%(?:2f|5c|2e|0[0-9a-f]|1[0-9a-f]|7f)/i;

/** Why a destination path is refused, or null when it is a safe same-site path. */
export function destinationProblem(raw: string): DestinationProblem | null {
  const path = raw.trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return 'not_a_path';
  if (path.length > MAX_DESTINATION_LENGTH) return 'too_long';
  if (!PATH_CHARS.test(path)) return 'invalid_characters';
  if (BAD_ESCAPE.test(path) || /%(?![0-9a-f]{2})/i.test(path)) return 'invalid_characters';
  if (path.split('/').some((seg) => seg === '..' || seg === '.')) return 'invalid_characters';
  return null;
}

/**
 * The redirect target as a same-origin path + query: the destination (default: the event page),
 * locale-prefixed, with the link's UTM values, any other `utm_*` values the click carried (the
 * link's own win), and the signed click id. Throws if the result would leave `origin` (it cannot,
 * for a path that passed `destinationProblem`; the check is the last line of defence).
 */
export function redirectTarget(args: {
  origin: string;
  localePrefix: string;
  path: string;
  utm: Utm;
  incoming: URLSearchParams;
  clickToken: string | null;
}): string {
  if (destinationProblem(args.path)) throw new Error('unsafe destination');
  if (args.localePrefix && !/^\/[a-z]{2}(-[A-Z]{2})?$/.test(args.localePrefix))
    throw new Error('bad locale prefix');
  const url = new URL(
    `${args.localePrefix}${args.path === '/' && args.localePrefix ? '' : args.path}`,
    args.origin,
  );
  const own: Record<(typeof UTM_KEYS)[number], string | null> = {
    utm_source: args.utm.source,
    utm_medium: args.utm.medium,
    utm_campaign: args.utm.campaign,
    utm_content: args.utm.content ?? null,
    utm_term: args.utm.term ?? null,
  };
  for (const key of UTM_KEYS) {
    const value = own[key] ?? args.incoming.get(key)?.slice(0, 100);
    if (value) url.searchParams.set(key, value);
  }
  if (args.clickToken) url.searchParams.set('yyc', args.clickToken);
  const origin = new URL(args.origin);
  const location = `${url.pathname}${url.search}`;
  if (url.origin !== origin.origin || location.startsWith('//') || location.startsWith('/\\'))
    throw new Error('redirect left the origin');
  return location;
}
