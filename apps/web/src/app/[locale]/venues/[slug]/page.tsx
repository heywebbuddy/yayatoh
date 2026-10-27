import { publicEventsAtVenue } from '@yayatoh/events';
import { publicMedia } from '@yayatoh/media';
import { buttonClass, Card, EmptyState } from '@yayatoh/ui';
import { publicVenue, quoteTarget } from '@yayatoh/venues';
import {
  Accessibility,
  ArrowUpRight,
  CalendarDays,
  Clock3,
  Globe,
  Mail,
  MapPin,
  Phone,
  UsersRound,
} from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Markdown } from '@/components/markdown.tsx';
import { SiteFooter, SiteHeader } from '@/components/marketplace/site-chrome.tsx';
import { MediaPicture } from '@/components/media-picture.tsx';
import { QuoteForm } from '@/components/quote-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatEventDateRange, formatNumber } from '@/lib/format.ts';
import { venueDisplayName } from '@/lib/venue-display.ts';
import { humanCheckWidget } from '@/server/human-check.ts';
import { requestQuoteAction } from './actions.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const v = await publicVenue(slug);
  if (!v) return {};
  const where = [v.city, v.region].filter(Boolean).join(', ');
  return {
    title: venueDisplayName(v.name),
    description: where || undefined,
    openGraph: { title: venueDisplayName(v.name), description: where || undefined },
  };
}

/** A directory venue's public page (M1.4c): details, upcoming public events and a quote form. */
export default async function PublicVenuePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const venue = await publicVenue(slug);
  if (!venue) notFound();
  const events = await publicEventsAtVenue(slug);
  // Photos (M1.4e): the venue's id is resolved server-side, never taken from the request.
  const target = await quoteTarget(slug);
  const photos = target ? await publicMedia('venue', target.venueId) : [];
  const t = await getTranslations('venuePage');
  const region = new Intl.DisplayNames([locale], { type: 'region' });
  const address = [
    venue.addressLine1,
    venue.addressLine2,
    [venue.postalCode, venue.city].filter(Boolean).join(' '),
    venue.region,
    region.of(venue.country) ?? venue.country,
  ].filter(Boolean);
  const cover = photos[0] ?? null;
  const displayName = venueDisplayName(venue.name);
  return (
    <div className="min-h-dvh bg-page">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 md:px-6 md:py-8">
        <section className="relative isolate flex min-h-[340px] flex-col justify-end gap-4 overflow-hidden rounded-[32px] bg-hero px-6 py-8 text-white elevation-card md:min-h-[420px] md:px-10 md:py-10">
          {cover ? (
            <div className="absolute inset-0 -z-10">
              <MediaPicture image={cover} sizes="100vw" eager className="size-full object-cover" />
              <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/45 to-black/20" />
            </div>
          ) : (
            <>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -end-12 -top-24 -z-10 size-80 rounded-full bg-white/20 blur-3xl"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute end-24 -bottom-32 -z-10 h-64 w-80 rotate-12 rounded-[56px] border border-white/25 bg-white/10"
              />
            </>
          )}
          <Link
            href="/venues"
            className="relative inline-flex min-h-8 items-center self-start rounded-pill border border-white/35 bg-black/15 px-3 text-caption font-semibold text-white underline-offset-2 hover:underline"
          >
            {t('directory')}
          </Link>
          <div className="relative flex max-w-3xl flex-col gap-2">
            <p className="m-0 text-label font-bold uppercase tracking-[0.12em] text-white/75">
              {t('managedBy', { org: venue.organizerName })}
            </p>
            <h1 className="m-0 break-words text-[38px] leading-[1.04] font-extrabold tracking-[-0.045em] md:text-[56px]">
              {displayName}
            </h1>
            {address.length > 0 ? (
              <p className="m-0 flex items-center gap-2 text-body text-white/85">
                <MapPin aria-hidden="true" className="size-4 shrink-0" />
                <span>
                  {[venue.city, venue.region, region.of(venue.country) ?? venue.country]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              </p>
            ) : null}
          </div>
          <a href="#venue-quote" className={buttonClass('inverse', 'md', 'self-start')}>
            {t('quoteTitle')}
            <ArrowUpRight aria-hidden="true" className="size-4" />
          </a>
        </section>

        <section aria-labelledby="venue-about" className="flex flex-col gap-4">
          <h2 id="venue-about" className="text-section">
            {t('about')}
          </h2>
          {venue.description ? (
            <Card size="panel">
              <Markdown source={venue.description} />
            </Card>
          ) : null}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card size="panel" className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-caption font-bold uppercase tracking-wide text-ink-2">
                <MapPin aria-hidden="true" className="size-4 text-primary-ink" />
                <h3 className="m-0">{t('address')}</h3>
              </div>
              <address className="not-italic text-body leading-relaxed">
                {address.length > 0 ? (
                  address.map((line, index) => (
                    <span key={`${line}-${index}`} className="block">
                      {line}
                    </span>
                  ))
                ) : (
                  <span>
                    {[venue.city, venue.region, region.of(venue.country) ?? venue.country]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                )}
              </address>
              {venue.mapUrl ? (
                <a
                  href={venue.mapUrl}
                  rel="noopener noreferrer nofollow"
                  className={buttonClass('secondary', 'sm', 'self-start')}
                >
                  {t('openMap')}
                  <ArrowUpRight aria-hidden="true" className="size-4" />
                </a>
              ) : null}
              {venue.contactEmail || venue.contactPhone || venue.websiteUrl ? (
                <div className="flex flex-col gap-2 border-t border-line pt-4">
                  <h3 className="m-0 text-caption font-bold uppercase tracking-wide text-ink-2">
                    {t('contact')}
                  </h3>
                  <ul className="m-0 flex list-none flex-col gap-2 p-0 text-body">
                    {venue.contactEmail ? (
                      <li className="flex items-center gap-2">
                        <Mail aria-hidden="true" className="size-4 text-primary-ink" />
                        <a href={`mailto:${venue.contactEmail}`} className="underline underline-offset-2">
                          {venue.contactEmail}
                        </a>
                      </li>
                    ) : null}
                    {venue.contactPhone ? (
                      <li className="flex items-center gap-2">
                        <Phone aria-hidden="true" className="size-4 text-primary-ink" />
                        <a
                          href={`tel:${venue.contactPhone.replace(/[^+\d]/g, '')}`}
                          className="underline underline-offset-2"
                        >
                          {venue.contactPhone}
                        </a>
                      </li>
                    ) : null}
                    {venue.websiteUrl ? (
                      <li className="flex items-center gap-2">
                        <Globe aria-hidden="true" className="size-4 text-primary-ink" />
                        <a
                          href={venue.websiteUrl}
                          rel="noopener noreferrer nofollow"
                          className="break-all underline underline-offset-2"
                        >
                          {venue.websiteUrl}
                        </a>
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : null}
            </Card>
            <Card size="panel" className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {venue.capacity ? (
                  <div className="flex items-start gap-3 rounded-card border border-line bg-surface-2 p-4">
                    <UsersRound aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary-ink" />
                    <p className="m-0 text-body font-semibold">
                      {t('capacity', {
                        count: venue.capacity,
                        formatted: formatNumber(venue.capacity, locale),
                      })}
                    </p>
                  </div>
                ) : null}
                <div className="flex items-start gap-3 rounded-card border border-line bg-surface-2 p-4">
                  <Clock3 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary-ink" />
                  <p className="m-0 text-body">
                    {t('timezone', { zone: venue.timezone.replace(/_/g, ' ') })}
                  </p>
                </div>
              </div>
              {venue.accessibilityNotes ? (
                <div className="flex flex-col gap-2 border-t border-line pt-4">
                  <h3 className="m-0 flex items-center gap-2 text-caption font-bold uppercase tracking-wide text-ink-2">
                    <Accessibility aria-hidden="true" className="size-4 text-primary-ink" />
                    {t('accessibility')}
                  </h3>
                  <p className="m-0 whitespace-pre-line text-body leading-relaxed">
                    {venue.accessibilityNotes}
                  </p>
                </div>
              ) : null}
            </Card>
          </div>
        </section>

        {photos.length > 1 ? (
          <section aria-labelledby="venue-photos" className="flex flex-col gap-4">
            <h2 id="venue-photos" className="text-section">
              {t('photos')}
            </h2>
            <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {photos.slice(1).map((photo) => (
                <li
                  key={photo.id}
                  className="overflow-hidden rounded-panel border border-line bg-surface elevation-card"
                >
                  <MediaPicture
                    image={photo}
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="aspect-[4/3] w-full object-cover transition-transform duration-300 hover:scale-[1.02]"
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="venue-events" className="flex flex-col gap-4">
          <h2 id="venue-events" className="text-section">
            {t('upcoming')}
          </h2>
          {events.length === 0 ? (
            <EmptyState title={t('noEventsTitle')} description={t('noEventsDescription')} />
          ) : (
            <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 lg:grid-cols-2">
              {events.map((event) => (
                <li key={event.slug}>
                  <Card interactive className="flex h-full flex-col gap-4">
                    <p className="m-0 flex items-center gap-2 text-caption font-semibold text-primary-ink">
                      <CalendarDays aria-hidden="true" className="size-4" />
                      {formatEventDateRange(event.startsAt.toISOString(), event.endsAt.toISOString(), {
                        locale,
                        currency: 'USD',
                        timeZone: event.timezone,
                      })}
                    </p>
                    <h3 className="m-0 text-card font-extrabold tracking-[-0.02em]">
                      <Link
                        href={`/events/${event.slug}`}
                        className="rounded-control underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
                      >
                        {event.name}
                      </Link>
                    </h3>
                    <Link
                      href={`/events/${event.slug}`}
                      className="inline-flex min-h-10 items-center gap-2 self-start text-body font-bold text-primary-ink underline-offset-4 hover:underline"
                    >
                      {t('upcoming')}
                      <ArrowUpRight aria-hidden="true" className="size-4" />
                    </Link>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          id="venue-quote"
          aria-labelledby="venue-quote-heading"
          className="scroll-mt-6 rounded-[28px] border border-line bg-surface-2 p-5 md:p-8"
        >
          <div className="mb-4 flex flex-col gap-2">
            <h2 id="venue-quote-heading" className="m-0 text-section">
              {t('quoteTitle')}
            </h2>
            <p className="m-0 max-w-2xl text-body text-ink-2">
              {t('quoteDescription', { org: venue.organizerName })}
            </p>
          </div>
          <Card size="panel">
            <QuoteForm
              action={requestQuoteAction.bind(null, slug)}
              humanCheck={humanCheckWidget()}
              locale={locale}
            />
          </Card>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
