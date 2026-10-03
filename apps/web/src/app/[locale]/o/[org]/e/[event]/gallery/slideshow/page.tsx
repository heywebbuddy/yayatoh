import { GALLERY_CHANNEL, hostSlidesQuery } from '@yayatoh/gallery';
import { executeQuery, requireOrg } from '@yayatoh/kernel';
import { isProfileKey, navIncludes, realtimeChannelName } from '@yayatoh/platform';
import { PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GallerySlideshow } from '@/components/gallery/slideshow.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { hostSlidesAction } from '../actions.ts';

/**
 * The live slideshow for the hosts (M4.5b): for a screen at the venue. Published photos, newest
 * first; new ones arrive over the event's `gallery` realtime channel (members with `guests:read`).
 */
export default async function GallerySlideshowPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'gallery');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (!navIncludes(profile, data.modules, 'gallery') || !can('guests:read')) notFound();
  const t = await getTranslations('gallery.slideshow');
  const { photos } = await executeQuery(hostSlidesQuery, { eventId: ev.id }, data.ctx, ports);
  const channel = realtimeChannelName(GALLERY_CHANNEL, requireOrg(data.ctx), ev.id);
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('hostIntro')}
        actions={
          <Link
            href={`/o/${org}/e/${event}/gallery`}
            className="inline-flex min-h-11 items-center rounded-pill border border-line bg-surface px-4 text-body font-bold text-ink"
          >
            {t('backToGallery')}
          </Link>
        }
      />
      <GallerySlideshow
        initial={photos}
        stream={`/api/realtime/${encodeURIComponent(channel)}`}
        reload={hostSlidesAction.bind(null, org, event)}
        title={t('title')}
      />
    </>
  );
}
