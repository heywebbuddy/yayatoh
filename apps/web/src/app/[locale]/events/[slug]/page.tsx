import { currentSlugFor, pageTarget } from '@yayatoh/events';
import type { Metadata } from 'next';
import { permanentRedirect } from 'next/navigation';
import { PublicEventView } from '@/components/public-event-view.tsx';
import { getPathname } from '@/i18n/navigation.ts';
import { eventMetadata } from '@/server/event-metadata.ts';
import { pageLocale } from '@/server/locale.ts';

type Params = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ date?: string; channel?: string }>;
};

export async function generateMetadata({ params }: Pick<Params, 'params'>): Promise<Metadata> {
  const { locale, slug } = await params;
  return eventMetadata(locale, slug);
}

export default async function PublicEventPage({ params, searchParams }: Params) {
  const { locale, slug } = await params;
  const { date, channel } = await searchParams;
  pageLocale(locale);
  // An event whose address changed: the old address redirects (permanently) to the new one.
  if (!(await pageTarget(slug))) {
    const moved = await currentSlugFor(slug);
    if (moved && moved !== slug) permanentRedirect(getPathname({ href: `/events/${moved}`, locale }));
  }
  return (
    <PublicEventView
      locale={locale}
      slug={slug}
      date={date ?? null}
      channelCode={channel?.slice(0, 40) ?? null}
    />
  );
}
