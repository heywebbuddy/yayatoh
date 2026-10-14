/** Small text helpers for content that comes from the API (M7.3c): organizer text is untrusted. */

/**
 * The words of a Markdown block without its markup: headings, emphasis, list markers, code ticks and
 * `[text](url)` links reduced to their text, images dropped. The app shows plain text, never renders
 * organizer-written Markdown or HTML.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '• ')
    .replace(/(\*\*|__|\*|_|`)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** An https URL from the API, or null: a link that is anything else is not opened. */
export function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

interface MapVenue {
  readonly mapUrl: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly name: string;
  readonly addressLine1: string | null;
  readonly city: string | null;
}

/** Where "Open in Maps" goes: the venue's own link, else its coordinates, else its address. */
export function mapLinkFor(venue: MapVenue): string | null {
  const own = safeHttpsUrl(venue.mapUrl);
  if (own) return own;
  if (venue.latitude !== null && venue.longitude !== null)
    return `https://www.google.com/maps/search/?api=1&query=${venue.latitude},${venue.longitude}`;
  const address = [venue.name, venue.addressLine1, venue.city].filter(Boolean).join(', ');
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;
}

/** A tenant brand colour from the API if it is an opaque hex colour; the theme checks its contrast. */
export function brandColorOf(event: unknown): string | null {
  const value = (event as { brandColor?: unknown } | null)?.brandColor;
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : null;
}
