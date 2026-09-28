import 'server-only';
import type { Metadata } from 'next';
import { apexHost, indexable, originFor } from '@/lib/hosts.ts';
import { pageAlternates } from '@/lib/seo/urls.ts';
import type { RequestHost } from './request-origin.ts';

/** The marketplace origin as seen from this request (yayatoh.com in production). */
export function apexOrigin(req: RequestHost): string {
  return req.kind === 'marketplace' || req.kind === 'dev' ? req.origin : originFor(req, apexHost());
}

/**
 * The canonical origin of an event (roadmap §4.2): its org's custom domain or tenant subdomain
 * when the projection says so, else the marketplace apex.
 */
export function eventOrigin(req: RequestHost, canonicalHost: string | null): string {
  if (!canonicalHost) return apexOrigin(req);
  return canonicalHost === req.host ? req.origin : originFor(req, canonicalHost);
}

/**
 * Metadata for a public page: canonical + hreflang (13 locales and x-default) on the canonical
 * origin, an absolute og:image, and `noindex` on hosts that are never indexed (dashboard, dev,
 * previews) or for pages that should not be (unlisted events).
 */
export function publicMetadata(o: {
  req: RequestHost;
  locale: string;
  canonicalOrigin: string;
  path: string;
  title: string;
  description?: string | null;
  /** Absolute URL of a generated 1200×630 card, or an uploaded image with its own size (M1.4e). */
  image: string | { url: string; width: number; height: number; alt: string };
  index?: boolean;
}): Metadata {
  const image = typeof o.image === 'string' ? { url: o.image, width: 1200, height: 630 } : o.image;
  const alternates = pageAlternates(o.canonicalOrigin, o.locale, o.path);
  const index = (o.index ?? true) && indexable(o.req.kind);
  return {
    title: o.title,
    ...(o.description ? { description: o.description } : {}),
    alternates,
    openGraph: {
      title: o.title,
      ...(o.description ? { description: o.description } : {}),
      url: alternates.canonical,
      type: 'website',
      locale: o.locale,
      images: [image],
    },
    twitter: { card: 'summary_large_image', images: [image.url] },
    robots: index ? { index: true, follow: true } : { index: false, follow: true },
  };
}
