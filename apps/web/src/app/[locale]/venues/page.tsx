import { publicMedia } from '@yayatoh/media';
import { buttonClass, cx } from '@yayatoh/ui';
import { quoteTarget, venueDirectory } from '@yayatoh/venues';
import { Building2, MapPin, UsersRound } from 'lucide-react';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MediaPicture } from '@/components/media-picture.tsx';
import { artGlow, GLOW } from '@/components/showcase/categories.ts';
import { PageHero } from '@/components/showcase/page-hero.tsx';
import { Reveal } from '@/components/showcase/reveal.tsx';
import { ShowcaseShell } from '@/components/showcase/shell.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { localizedPath } from '@/lib/seo/urls.ts';
import { venueDisplayName } from '@/lib/venue-display.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'directory' });
  return { title: t('title'), description: t('subtitle') };
}

/** What a venue is, from its capacity: there is no stored type, and a size is what people filter by. */
type Size = 'small' | 'medium' | 'large';
const sizeOf = (capacity: number | null): Size | null =>
  capacity === null ? null : capacity <= 100 ? 'small' : capacity <= 500 ? 'medium' : 'large';
const SIZES: readonly Size[] = ['small', 'medium', 'large'];

type Sp = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** The venue directory: photo cards with filters (search, city, size). */
export default async function VenueDirectoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Sp>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Live data: render per request, never at build time.
  await connection();
  const sp = await searchParams;
  const t = await getTranslations('directory');
  const all = await venueDirectory();
  const region = new Intl.DisplayNames([locale], { type: 'region' });
  const cities = [...new Set(all.map((v) => v.city).filter((c): c is string => Boolean(c)))].sort((a, b) =>
    a.localeCompare(b, locale),
  );
  const q = one(sp.q).trim().toLowerCase();
  const city = cities.includes(one(sp.city)) ? one(sp.city) : '';
  const size = (SIZES as readonly string[]).includes(one(sp.size)) ? (one(sp.size) as Size) : null;
  const venues = all.filter(
    (v) =>
      (!q ||
        venueDisplayName(v.name).toLowerCase().includes(q) ||
        (v.city ?? '').toLowerCase().includes(q)) &&
      (!city || v.city === city) &&
      (!size || sizeOf(v.capacity) === size),
  );
  // The first photo of each venue (the cards' thumbnail); a designed tile where there is none.
  const photos = new Map(
    await Promise.all(
      venues.slice(0, 60).map(async (v) => {
        const target = await quoteTarget(v.slug).catch(() => null);
        const media = target ? await publicMedia('venue', target.venueId).catch(() => []) : [];
        return [v.slug, media[0] ?? null] as const;
      }),
    ),
  );
  const filtered = Boolean(q || city || size);
  return (
    <ShowcaseShell>
      <PageHero eyebrow={t('eyebrow')} title={t('title')} lede={t('subtitle')} icon={Building2} />
      <search aria-label={t('filters.label')}>
        <form
          action={localizedPath(locale, '/venues')}
          method="get"
          className="grid grid-cols-1 gap-3 rounded-card border border-line bg-surface p-4 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end"
        >
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="v-q" className="text-[13px] font-bold text-ink">
              {t('filters.query')}
            </label>
            <input
              id="v-q"
              name="q"
              type="search"
              defaultValue={one(sp.q)}
              maxLength={80}
              className="field w-full"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="v-city" className="text-[13px] font-bold text-ink">
              {t('filters.city')}
            </label>
            <select id="v-city" name="city" defaultValue={city} className="field w-full">
              <option value="">{t('filters.anyCity')}</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="v-size" className="text-[13px] font-bold text-ink">
              {t('filters.size')}
            </label>
            <select id="v-size" name="size" defaultValue={size ?? ''} className="field w-full">
              <option value="">{t('filters.anySize')}</option>
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {t(`sizes.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className={buttonClass('ember', 'md')}>
              {t('filters.apply')}
            </button>
            {filtered ? (
              <Link href="/venues" className={buttonClass('secondary', 'md')}>
                {t('filters.clear')}
              </Link>
            ) : null}
          </div>
        </form>
      </search>
      {venues.length === 0 ? (
        <section className="flex flex-col items-center gap-2 rounded-card border border-line bg-surface p-10 text-center">
          <h2 className="m-0 font-display text-[22px] font-black uppercase">
            {filtered ? t('noMatchTitle') : t('emptyTitle')}
          </h2>
          <p className="m-0 max-w-md text-ink-2">
            {filtered ? t('noMatchDescription') : t('emptyDescription')}
          </p>
        </section>
      ) : (
        <section aria-label={t('title')} className="flex flex-col gap-4">
          <p className="m-0 text-caption text-ink-2" role="status">
            {t('count', { count: venues.length })}
          </p>
          <ul className="m-0 grid list-none grid-cols-1 gap-5 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {venues.map((v, i) => {
              const place = [v.city, v.region, region.of(v.country) ?? v.country].filter(Boolean).join(', ');
              const photo = photos.get(v.slug) ?? null;
              const kind = sizeOf(v.capacity);
              return (
                <Reveal as="li" key={v.slug} delay={i % 3}>
                  <article className="group relative flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface elevation-card transition duration-300 hover:-translate-y-1 hover:border-ember motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                    <div
                      className={cx(
                        'relative aspect-[4/3] w-full overflow-hidden bg-linear-to-br',
                        photo ? 'bg-surface-2' : GLOW[artGlow(v.slug)].art,
                      )}
                    >
                      {photo ? (
                        <MediaPicture
                          image={{ ...photo, decorative: true }}
                          sizes="(min-width: 1280px) 400px, (min-width: 640px) 50vw, 100vw"
                          className="size-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none"
                          eager={i < 3}
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="absolute inset-0 flex items-center justify-center text-white/45"
                        >
                          <Building2 className="size-20" strokeWidth={1.25} />
                        </span>
                      )}
                      <span className="absolute start-3 top-3 rounded-pill bg-black/65 px-2.5 py-1 text-caption font-bold text-white">
                        {kind ? t(`types.${kind}`) : t('types.venue')}
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-5">
                      <h2 className="m-0 text-[19px] leading-snug font-extrabold tracking-[-0.02em] [overflow-wrap:anywhere]">
                        <Link
                          href={`/venues/${v.slug}`}
                          className="rounded-control after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
                        >
                          {venueDisplayName(v.name)}
                        </Link>
                      </h2>
                      {place ? (
                        <p className="m-0 flex items-start gap-2 text-body text-ink-2">
                          <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                          <span>{place}</span>
                        </p>
                      ) : null}
                      {v.capacity ? (
                        <p className="m-0 mt-auto inline-flex items-center gap-1.5 pt-2 text-caption font-semibold text-ink-2">
                          <UsersRound aria-hidden="true" className="size-3.5" />
                          {t('capacity', {
                            count: v.capacity,
                            formatted: formatNumber(v.capacity, locale),
                          })}
                        </p>
                      ) : null}
                    </div>
                  </article>
                </Reveal>
              );
            })}
          </ul>
        </section>
      )}
    </ShowcaseShell>
  );
}
