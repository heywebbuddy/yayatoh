import { DEFAULT_LOCALE } from '@yayatoh/contracts';
import { resolveShortLink } from '@yayatoh/events';

/**
 * Short links `/e/{code}` (M1.4d): a permanent redirect (308) to the canonical event page.
 * Codes are case-insensitive; unknown codes and events without a public page are a 404.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string; short: string }> },
): Promise<Response> {
  const { locale, short } = await params;
  const slug = await resolveShortLink(decodeURIComponent(short));
  if (!slug) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const prefix = locale === DEFAULT_LOCALE ? '' : `/${locale}`;
  const target = new URL(`${prefix}/events/${slug}`, request.url);
  return new Response(null, {
    status: 308,
    // Vanity codes can move to another event: never cache the answer.
    headers: { Location: target.pathname, 'Cache-Control': 'no-store' },
  });
}
