import { formatMoney, money } from '@yayatoh/kernel';
import type { ListingDto } from '@yayatoh/marketplace';
import type { PublicMediaDto } from '@yayatoh/media';
import { Calendar, MapPin } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { formatEventDateRange } from '@/lib/format.ts';
import { MediaPicture } from '../media-picture.tsx';

/** One event in a list: name (the link), dates in the event's time zone, place, price, organizer. */
export async function ListingCard({
  listing: l,
  cover = null,
  locale,
  organizerHref,
}: {
  listing: ListingDto;
  /** The event's cover image, when it has one (M1.4e). */
  cover?: PublicMediaDto | null;
  locale: string;
  /** Where the organizer name links (the marketplace's /o/{slug}); none on a tenant site. */
  organizerHref: string | null;
}) {
  const t = await getTranslations('market');
  const range = formatEventDateRange(l.startsAt.toISOString(), l.endsAt.toISOString(), {
    locale,
    currency: l.currency,
    timeZone: l.timezone,
  });
  const fmt = (minor: number) => formatMoney(money(minor, l.currency), locale).replace(/\.00$/, '');
  const price =
    l.minPriceMinor === null || l.maxPriceMinor === null
      ? t('price.soon')
      : l.maxPriceMinor === 0
        ? t('price.free')
        : l.minPriceMinor === l.maxPriceMinor
          ? fmt(l.minPriceMinor)
          : t('price.from', { price: fmt(l.minPriceMinor) });
  const place = [l.venueName, l.city].filter(Boolean).join(' · ');
  return (
    <article className="relative flex h-full flex-col gap-3 rounded-card border border-zinc-200 bg-white p-5 focus-within:border-zinc-900">
      {cover ? (
        <div data-testid="listing-cover" className="-mx-5 -mt-5 overflow-hidden rounded-t-card">
          <MediaPicture
            image={cover}
            sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
            className="aspect-video w-full bg-zinc-50 object-cover"
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-label text-zinc-500 uppercase">{t(`category.${l.profile}`)}</span>
        {l.status === 'postponed' ? (
          <span className="rounded-pill bg-accent-50 px-2 py-0.5 text-caption text-accent-text">
            {t('postponed')}
          </span>
        ) : null}
      </div>
      <h3 className="text-[20px] leading-6 font-normal tracking-[-0.02em]">
        <Link
          href={`/events/${l.slug}`}
          className="outline-none after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:underline"
        >
          {l.name}
        </Link>
      </h3>
      {l.tagline ? <p className="line-clamp-2 text-body text-zinc-600">{l.tagline}</p> : null}
      <dl className="mt-auto flex flex-col gap-1.5 text-caption text-zinc-600">
        <div className="flex items-center gap-2">
          <dt className="sr-only">{t('when')}</dt>
          <Calendar aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.75} />
          <dd className="m-0">{range}</dd>
        </div>
        {place ? (
          <div className="flex items-center gap-2">
            <dt className="sr-only">{t('where')}</dt>
            <MapPin aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.75} />
            <dd className="m-0">{place}</dd>
          </div>
        ) : null}
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3">
        <p className="text-body font-medium">
          <span className="sr-only">{t('priceLabel')} </span>
          {price}
        </p>
        {organizerHref ? (
          <Link
            href={organizerHref}
            className="relative z-10 inline-flex min-h-6 items-center text-caption text-zinc-600 underline"
          >
            {t('by', { org: l.orgName })}
          </Link>
        ) : null}
      </div>
    </article>
  );
}
