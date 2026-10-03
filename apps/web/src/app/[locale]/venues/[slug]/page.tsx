import { publicEventsAtVenue } from '@yayatoh/events';
import { publicMedia } from '@yayatoh/media';
import { Card, EmptyState } from '@yayatoh/ui';
import { publicVenue, quoteTarget } from '@yayatoh/venues';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MediaPicture } from '@/components/media-picture.tsx';
import { QuoteForm } from '@/components/quote-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatEventDateRange, formatNumber } from '@/lib/format.ts';
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
    title: v.name,
    description: where || undefined,
    openGraph: { title: v.name, description: where || undefined },
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
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-10 px-4 py-12 md:px-8">
      <header className="flex flex-col gap-3">
        <Link href="/venues" className="self-start text-caption text-ink-2 underline underline-offset-2">
          {t('directory')}
        </Link>
        <h1 className="text-[36px] leading-tight font-extrabold tracking-[-0.04em] md:text-title">
          {venue.name}
        </h1>
        <p className="text-[15px] text-ink-2">{t('managedBy', { org: venue.organizerName })}</p>
      </header>
      <section aria-labelledby="venue-about" className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <h2 id="venue-about" className="sr-only">
          {t('about')}
        </h2>
        <Card className="flex flex-col gap-2">
          <h3 className="text-caption text-ink-2">{t('address')}</h3>
          <address className="not-italic text-body">
            {address.map((l) => (
              <span key={l} className="block">
                {l}
              </span>
            ))}
          </address>
          {venue.mapUrl ? (
            <a
              href={venue.mapUrl}
              rel="noopener noreferrer nofollow"
              className="self-start text-body underline underline-offset-2"
            >
              {t('openMap')}
            </a>
          ) : null}
        </Card>
        <Card className="flex flex-col gap-2">
          {venue.capacity ? (
            <p className="text-body">
              {t('capacity', { count: venue.capacity, formatted: formatNumber(venue.capacity, locale) })}
            </p>
          ) : null}
          <p className="text-caption text-ink-2">
            {t('timezone', { zone: venue.timezone.replace(/_/g, ' ') })}
          </p>
          {venue.accessibilityNotes ? (
            <>
              <h3 className="text-caption text-ink-2">{t('accessibility')}</h3>
              <p className="whitespace-pre-line text-body">{venue.accessibilityNotes}</p>
            </>
          ) : null}
        </Card>
      </section>
      {photos.length > 0 ? (
        <section aria-labelledby="venue-photos" className="flex flex-col gap-3">
          <h2 id="venue-photos" className="text-section">
            {t('photos')}
          </h2>
          <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {photos.map((p) => (
              <li key={p.id}>
                <MediaPicture
                  image={p}
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  className="aspect-[4/3] w-full rounded-card bg-surface-2 object-cover"
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="venue-events" className="flex flex-col gap-3">
        <h2 id="venue-events" className="text-section">
          {t('upcoming')}
        </h2>
        {events.length === 0 ? (
          <EmptyState title={t('noEventsTitle')} description={t('noEventsDescription')} />
        ) : (
          <ul className="flex list-none flex-col gap-2 p-0">
            {events.map((e) => (
              <li key={e.slug}>
                <Card className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/events/${e.slug}`} className="text-body underline underline-offset-2">
                    {e.name}
                  </Link>
                  <span className="text-caption text-ink-2">
                    {formatEventDateRange(e.startsAt.toISOString(), e.endsAt.toISOString(), {
                      locale,
                      currency: 'USD',
                      timeZone: e.timezone,
                    })}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="venue-quote" className="flex flex-col gap-3">
        <h2 id="venue-quote" className="text-section">
          {t('quoteTitle')}
        </h2>
        <p className="text-body text-ink-2">{t('quoteDescription', { org: venue.organizerName })}</p>
        <Card size="panel">
          <QuoteForm
            action={requestQuoteAction.bind(null, slug)}
            humanCheck={humanCheckWidget()}
            locale={locale}
          />
        </Card>
      </section>
    </main>
  );
}
