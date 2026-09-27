import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { listingBySlug } from '@yayatoh/marketplace';
import { publicOrgProfile } from '@yayatoh/tenancy';
import { getTranslations } from 'next-intl/server';
import { formatEventDateRange } from '@/lib/format.ts';
import { ogImage } from '@/server/og.tsx';

/** The event's share image (absolute og:image on every host), in the org's brand colour. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ev = await publicEventBySlug(slug);
  if (!ev) return new Response('Not found', { status: 404 });
  const target = await checkoutTarget(slug);
  const profile = target ? await publicOrgProfile(target.orgId) : null;
  const listing = await listingBySlug(slug);
  const t = await getTranslations({ locale: 'en', namespace: 'market' });
  const when = formatEventDateRange(ev.startsAt.toISOString(), ev.endsAt.toISOString(), {
    locale: 'en',
    currency: ev.currency,
    timeZone: ev.timezone,
  });
  return ogImage({
    eyebrow: ev.organizerName,
    title: ev.name,
    lines: [[when, listing?.venueName ?? ev.venueName, ev.city].filter(Boolean).join(' · ')],
    footer: t('wordmark'),
    brandColor: profile?.brandColor ?? null,
  });
}
