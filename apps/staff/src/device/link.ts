/**
 * Reading an enrolment link (M7.4a). An organizer's enrolment QR holds the same link the Scan PWA
 * opens: `…/scan#e=<event id>&k=<device token>`. The token (`yyd_…`) is in the URL fragment so it
 * never reaches a server log, and in this app it never reaches a request URL, a log line or a crash
 * report either: it is read here, stored in the keychain and sent only in an `Authorization` header.
 */
import { routeForLink } from '@yayatoh/mobile-core';

/** The device token the server issues: `yyd_` and 43 URL-safe characters. */
export const DEVICE_TOKEN = /^yyd_[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Enrolment {
  readonly eventId: string;
  readonly token: string;
}

/** The link's parts, or null when it is not an enrolment link. Never throws. */
export function enrolmentFrom(event: unknown, key: unknown): Enrolment | null {
  if (typeof event !== 'string' || typeof key !== 'string') return null;
  const eventId = event.trim().toLowerCase();
  const token = key.trim();
  return UUID.test(eventId) && DEVICE_TOKEN.test(token) ? { eventId, token } : null;
}

/** `https://abc.yayatoh.events/fr/scan#e=…&k=…` or `yayatoh-staff://scan#e=…&k=…`. */
const LINK =
  /^(?:https?|[a-z][a-z0-9+.-]*):\/\/[^/?#]*\/?(?:(?:[a-z]{2}(?:-[A-Za-z]{2,4})?)\/)?scan\/?(?:\?[^#]*)?#(.*)$/i;
const SCHEME_LINK = /^[a-z][a-z0-9+.-]*:\/\/scan\/?(?:\?[^#]*)?#(.*)$/i;

function fragmentFields(fragment: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of fragment.split('&')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    try {
      out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1));
    } catch {
      // A malformed escape drops that field.
    }
  }
  return out;
}

/**
 * The enrolment inside a scanned or opened link. The key must be in the fragment: a link that put it
 * in the query is not one of ours. Any host is accepted, because the app only ever sends the key to
 * its own configured API, so a link cannot send it anywhere else.
 */
export function enrolmentFromLink(link: string): Enrolment | null {
  const text = link.trim();
  if (text.length > 1000) return null;
  // Our own allowlist first (the apex, tenant hosts and the app schemes).
  const route = routeForLink(text, { app: 'staff' });
  if (route) return enrolmentFrom(route.params.event, route.params.key);
  const m = SCHEME_LINK.exec(text) ?? LINK.exec(text);
  if (!m) return null;
  const fields = fragmentFields(m[1] ?? '');
  return enrolmentFrom(fields.e, fields.k);
}

/** True when a system link is the enrolment kind, whether or not it is valid. */
export const looksLikeEnrolmentLink = (link: string): boolean => /\/scan\/?(?:[?#]|$)/i.test(link);

/**
 * Masks the key (and the event) of an enrolment link, and any device token, in text that might be
 * logged: `…/scan#e=<id>&k=<token>` becomes `…/scan#e=[event]&k=[key]`.
 */
export function redactEnrolment(text: string): string {
  return text
    .replace(/([#?&]k=)[^&\s]*/gi, '$1[key]')
    .replace(/([#?&]e=)[^&\s]*/gi, '$1[event]')
    .replace(/\byyd_[A-Za-z0-9_-]+/g, '[token]');
}
