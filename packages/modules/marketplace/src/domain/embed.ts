export const MAX_EMBED_ORIGINS = 10;

/**
 * Normalize an origin an organizer allows to embed the ticket widget: `https://` only (plus
 * `http://localhost` for testing), scheme + host (+ port), no path. Null when unusable.
 */
export function normalizeOrigin(input: string): string | null {
  const raw = input.trim();
  if (!raw || raw.length > 300) return null;
  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname.endsWith('.localhost');
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
  if (url.username || url.password) return null;
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return null;
  if (!local && !/^([a-z0-9-]+\.)+[a-z]{2,63}$/.test(url.hostname)) return null;
  return url.origin;
}

/**
 * The CSP `frame-ancestors` value for the widget: this platform itself plus the origins the org
 * allowed. Every other site gets a blank frame.
 */
export function frameAncestors(origins: readonly string[]): string {
  return ["frame-ancestors 'self'", ...origins].join(' ');
}
