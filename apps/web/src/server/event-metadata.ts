import 'server-only';
import { pageTarget, publicEventBySlug, publicEventSeo } from '@yayatoh/events';
import { listingBySlug } from '@yayatoh/marketplace';
import { publicMedia } from '@yayatoh/media';
import type { Metadata } from 'next';
import { requestHost } from './request-origin.ts';
import { eventOrigin, publicMetadata } from './seo.ts';

/** Metadata of a public event page on any host: canonical home URL, hreflang, absolute og:image. */
export async function eventMetadata(locale: string, slug: string): Promise<Metadata> {
  const pub = await publicEventBySlug(slug);
  // A private event (M1.4d) has no public payload, even once a code opened it: no metadata, no index.
  if (!pub) return { robots: { index: false, follow: false } };
  const listing = await listingBySlug(slug);
  const req = await requestHost();
  // The organizer's cover (its PNG/JPEG fallback, absolute) when there is one, else the generated card.
  const target = await pageTarget(slug);
  const images = target ? await publicMedia('event', target.eventId) : [];
  // The organizer's SEO settings win: a dedicated social image, then the cover, then the generated card.
  const seo = target ? await publicEventSeo(target) : { seoTitle: null, seoDescription: null };
  const cover = images.find((m) => m.slot === 'social') ?? images.find((m) => m.slot === 'cover');
  const fallback = cover?.variants.find((v) => v.fallback);
  return publicMetadata({
    req,
    locale,
    canonicalOrigin: eventOrigin(req, listing?.canonicalHost ?? null),
    path: `/events/${slug}`,
    title: seo.seoTitle ?? `${pub.name} · ${pub.organizerName}`,
    description: seo.seoDescription ?? pub.tagline,
    image:
      cover && fallback
        ? {
            url: `${req.origin}${fallback.url}`,
            width: fallback.width,
            height: fallback.height,
            alt: cover.alt,
          }
        : `${req.origin}/api/og/event/${slug}`,
    // Unlisted, finished and cancelled events have no listing: reachable, not indexed.
    index: listing !== null,
  });
}
