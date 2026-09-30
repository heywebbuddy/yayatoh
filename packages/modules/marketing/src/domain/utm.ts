/**
 * UTM values (M3.8a). Tracked links carry them; a landing page without a click id records the ones
 * it arrived with in the `yy_utm` cookie (first and last, with the time) for UTM-only attribution.
 */

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
export const UTM_COOKIE = 'yy_utm';
export const UTM_MAX = 100;

export interface Utm {
  readonly source: string;
  readonly medium: string | null;
  readonly campaign: string | null;
  readonly content?: string | null;
  readonly term?: string | null;
}

/** A UTM value as stored: trimmed, control characters removed, at most 100 characters; null if empty. */
export function cleanUtmValue(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const printable = [...v].filter((c) => {
    const code = c.charCodeAt(0);
    return code > 0x1f && code !== 0x7f && c !== '<' && c !== '>';
  });
  const s = printable.join('').trim().slice(0, UTM_MAX).trim();
  return s ? s : null;
}

/** The UTM values in a query string, or null without a `utm_source`. */
export function utmFromParams(params: URLSearchParams): Utm | null {
  const source = cleanUtmValue(params.get('utm_source'));
  if (!source) return null;
  return {
    source,
    medium: cleanUtmValue(params.get('utm_medium')),
    campaign: cleanUtmValue(params.get('utm_campaign')),
    content: cleanUtmValue(params.get('utm_content')),
    term: cleanUtmValue(params.get('utm_term')),
  };
}

export interface UtmTouch extends Utm {
  /** When the visitor landed with these values (ms since the epoch). */
  readonly at: number;
}

export interface UtmCookie {
  readonly first: UtmTouch;
  readonly last: UtmTouch;
}

const pack = (u: UtmTouch) => [u.source, u.medium, u.campaign, u.content ?? null, u.term ?? null, u.at];

function unpack(v: unknown): UtmTouch | null {
  if (!Array.isArray(v) || v.length !== 6) return null;
  const [s, m, c, n, t, at] = v;
  const source = cleanUtmValue(s);
  if (!source || typeof at !== 'number' || !Number.isFinite(at)) return null;
  const str = (x: unknown) => (x === null ? null : cleanUtmValue(x as string));
  return { source, medium: str(m), campaign: str(c), content: str(n), term: str(t), at };
}

export function encodeUtmCookie(c: UtmCookie): string {
  return Buffer.from(JSON.stringify([pack(c.first), pack(c.last)])).toString('base64url');
}

/** Parses the cookie; anything malformed or oversized is ignored (null). */
export function decodeUtmCookie(raw: string | null | undefined): UtmCookie | null {
  if (!raw || raw.length > 2000) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(v) || v.length !== 2) return null;
    const first = unpack(v[0]);
    const last = unpack(v[1]);
    return first && last ? { first, last } : null;
  } catch {
    return null;
  }
}

/** The cookie after landing with `utm` at `at`: first touch is kept, last touch replaced. */
export function nextUtmCookie(prev: UtmCookie | null, utm: Utm, at: number, windowMs: number): UtmCookie {
  const touch: UtmTouch = { ...utm, at };
  // An old first touch (outside the longest window) no longer counts: start again.
  if (!prev || prev.first.at < at - windowMs) return { first: touch, last: touch };
  return { first: prev.first, last: touch };
}
