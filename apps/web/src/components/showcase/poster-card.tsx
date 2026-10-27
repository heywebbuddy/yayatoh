import { formatMoney, money } from '@yayatoh/kernel';
import type { ListingDto } from '@yayatoh/marketplace';
import type { PublicMediaDto } from '@yayatoh/media';
import { cx } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { MediaPicture } from '../media-picture.tsx';
import { artGlow, GLOW } from './categories.ts';

type PriceT = (key: 'free' | 'soon' | 'fromTo' | 'fromOnly', values?: Record<string, string>) => string;

/** "From £x – £y", "Free" or "Price soon", the way the poster says it. */
export function priceLine(
  l: Pick<ListingDto, 'minPriceMinor' | 'maxPriceMinor' | 'currency'>,
  locale: string,
  t: PriceT,
): string {
  const fmt = (minor: number) => formatMoney(money(minor, l.currency), locale).replace(/\.00$/, '');
  if (l.minPriceMinor === null || l.maxPriceMinor === null) return t('soon');
  if (l.maxPriceMinor === 0) return t('free');
  if (l.minPriceMinor === l.maxPriceMinor) return t('fromOnly', { min: fmt(l.minPriceMinor) });
  return t('fromTo', { min: fmt(l.minPriceMinor), max: fmt(l.maxPriceMinor) });
}

/**
 * A poster-style event card: a square picture (the cover, or generated art without one), then
 * "date • venue", the title and the price range. The whole card is one link.
 */
export async function PosterCard({
  listing: l,
  cover = null,
  locale,
  className,
  eager = false,
}: {
  listing: ListingDto;
  cover?: PublicMediaDto | null;
  locale: string;
  className?: string;
  /** Load the picture at once: the first cards of a row, which lazy loading may leave blank in a scroller. */
  eager?: boolean;
}) {
  const t = await getTranslations('showcase.price');
  const date = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: l.timezone,
  }).format(l.startsAt);
  const place = l.venueName ?? l.city;
  const art = GLOW[artGlow(l.slug)];
  return (
    <article className={cx('group relative flex w-[240px] shrink-0 flex-col gap-3 md:w-[270px]', className)}>
      <div className="relative aspect-square overflow-hidden rounded-card bg-surface-2 transition-transform duration-300 group-focus-within:-translate-y-1 group-hover:-translate-y-1 motion-reduce:transition-none">
        {cover ? (
          <MediaPicture
            image={cover}
            sizes="270px"
            eager={eager}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none"
          />
        ) : (
          <div className={cx('flex size-full items-end bg-linear-to-br p-5', art.art)}>
            <span
              aria-hidden="true"
              className="font-display text-[44px] leading-none font-black tracking-[-0.04em] text-white/90 uppercase"
            >
              {l.name.slice(0, 2)}
            </span>
          </div>
        )}
        {l.status === 'postponed' ? (
          <span className="absolute start-3 top-3 rounded-pill bg-black/70 px-2.5 py-1 text-caption font-bold text-white">
            {t('postponed')}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-caption font-bold text-ink-2">
          <time dateTime={l.startsAt.toISOString()}>{date}</time>
          {place ? <span aria-hidden="true"> • </span> : null}
          {place}
        </p>
        <h3 className="text-[17px] leading-snug font-extrabold tracking-[-0.01em]">
          <Link
            href={`/events/${l.slug}`}
            className="line-clamp-2 outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline"
          >
            {l.name}
          </Link>
        </h3>
        <p className="text-body font-bold text-ink-2">{priceLine(l, locale, t)}</p>
      </div>
    </article>
  );
}
