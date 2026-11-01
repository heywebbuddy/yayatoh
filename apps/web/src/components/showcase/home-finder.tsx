import type { ListingDto } from '@yayatoh/marketplace';
import type { PublicMediaDto } from '@yayatoh/media';
import { getTranslations } from 'next-intl/server';
import { localizedPath } from '@/lib/seo/urls.ts';
import { cachedCities, cachedCityCenters } from '@/server/public-data.ts';
import { MediaPicture } from '../media-picture.tsx';
import { HeroSearch } from './hero-search.tsx';
import { type HeroSlide, HeroSlider } from './hero-slider.tsx';

/**
 * The top of the home page: a rotating slider of featured events (real pictures; designed art for
 * an event without one) with the finder card laid over its foot: search, city and date.
 */
export async function HomeFinder({
  locale,
  featured,
  covers,
}: {
  locale: string;
  featured: readonly ListingDto[];
  covers: ReadonlyMap<string, PublicMediaDto>;
}) {
  const t = await getTranslations('homeFinder');
  const [cities, centers] = await Promise.all([cachedCities(), cachedCityCenters()]);
  const slides: HeroSlide[] = featured
    .filter((l) => covers.has(l.slug))
    .slice(0, 5)
    .map((l, i) => {
      const cover = covers.get(l.slug) as PublicMediaDto;
      const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: l.timezone }).format(
        l.startsAt,
      );
      return {
        key: l.slug,
        name: l.name,
        meta: [when, l.venueName ?? l.city].filter(Boolean).join(' · '),
        href: `/events/${l.slug}`,
        picture: (
          <MediaPicture
            image={{ ...cover, decorative: true }}
            sizes="(min-width: 1280px) 1200px, 100vw"
            className="size-full object-cover"
            eager={i === 0}
          />
        ),
      };
    });
  if (slides.length === 0)
    slides.push({
      key: 'default',
      name: t('defaultName'),
      meta: t('defaultMeta'),
      href: '/events',
      picture: <div className="size-full bg-ember-soft" />,
    });
  return (
    <div className="flex flex-col gap-0 pt-4 pb-2 md:pt-6">
      <HeroSlider slides={slides} />
      <HeroSearch action={localizedPath(locale, '/events')} cities={cities} centers={centers} />
    </div>
  );
}
