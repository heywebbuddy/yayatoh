import { publicSlidesQuery } from '@yayatoh/gallery';
import { guestSiteTarget } from '@yayatoh/guests';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { buttonClass, EmptyState, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GallerySlideshow } from '@/components/gallery/slideshow.tsx';
import { Link } from '@/i18n/navigation.ts';
import { humanCheckWidget } from '@/server/human-check.ts';
import { ports } from '@/server/ports.ts';
import { siteAccess } from '../access.ts';
import { unlockSiteThenAction } from '../actions.ts';
import { guestSlidesAction } from '../gallery/actions.ts';
import { SiteGateForm } from '../gate-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('gallery.slideshow');
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * The guests' live slideshow (M4.5b): `/w/{code}/slideshow`, behind the guest website's password,
 * while the gallery is on. New photos arrive over `/api/gallery/stream/{code}` (ids only).
 */
export default async function GuestSlideshowPage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code: raw } = await params;
  setRequestLocale(locale);
  const code = decodeURIComponent(raw).toUpperCase();
  const target = await guestSiteTarget(code);
  if (!target) notFound();
  const ctx = createCtx({ orgId: target.orgId, locale });
  const t = await getTranslations('gallery.slideshow');
  const tg = await getTranslations('gallery.guest');
  const slides = await executeQuery(
    publicSlidesQuery,
    { eventId: target.eventId, access: await siteAccess(code) },
    ctx,
    ports,
  ).catch((err) => {
    if (!isDomainError(err)) throw err;
    if (err.code === 'not_found' || err.code === 'module_not_enabled') notFound();
    return err.code === 'forbidden' ? ('locked' as const) : ('closed' as const);
  });
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      {slides === 'locked' ? (
        <>
          <PageHeader
            eyebrow={<Label>{tg('title')}</Label>}
            title={t('title')}
            description={tg('gateIntro')}
          />
          <SiteGateForm
            action={unlockSiteThenAction.bind(null, code, 'slideshow')}
            challenge={humanCheckWidget()}
          />
        </>
      ) : slides === 'closed' ? (
        <>
          <PageHeader title={t('title')} />
          <EmptyState title={tg('closedTitle')} description={tg('closedDescription')} />
        </>
      ) : (
        <>
          <PageHeader title={t('title')} description={t('guestIntro')} />
          <GallerySlideshow
            initial={slides.photos}
            stream={`/api/gallery/stream/${code}`}
            reload={guestSlidesAction.bind(null, code)}
            title={t('title')}
            emptyAction={
              <Link href={`/w/${code}/gallery`} className={buttonClass('primary', 'md')}>
                {t('backToGuestGallery')}
              </Link>
            }
          />
        </>
      )}
      <p className="m-0 flex flex-wrap gap-x-6 border-t border-line pt-6">
        <Link
          href={`/w/${code}/gallery`}
          className="inline-flex min-h-11 items-center font-bold text-primary-ink underline underline-offset-2"
        >
          {t('backToGuestGallery')}
        </Link>
      </p>
    </main>
  );
}
