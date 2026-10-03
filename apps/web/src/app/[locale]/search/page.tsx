import { hasFilters, parseSearchV2Params } from '@yayatoh/marketplace';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Pagination } from '@/components/marketplace/pagination.tsx';
import { SearchGrid, SearchV2Form, searchQueryOf } from '@/components/marketplace/search-v2.tsx';
import { SiteFooter, SiteHeader } from '@/components/marketplace/site-chrome.tsx';
import { Link, redirect } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import {
  cachedCityCenters,
  cachedPopular,
  cachedPromoted,
  cachedSearch,
  cachedSimilar,
} from '@/server/public-data.ts';
import { requestHost } from '@/server/request-origin.ts';
import { searchEnabled } from '@/server/search.ts';
import { apexOrigin, publicMetadata } from '@/server/seo.ts';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'market.search' });
  const req = await requestHost();
  return publicMetadata({
    req,
    locale,
    canonicalOrigin: apexOrigin(req),
    path: '/search',
    title: t('title'),
    description: t('lede'),
    image: `${req.origin}/api/og/home`,
    // Search pages are for people; /events is the indexable list.
    index: false,
  });
}

/**
 * Marketplace search v2 (M6.14a): full-text search with facets (category, price band, date, city)
 * and geo search (near a city or the visitor, within a radius), plus recommendations: popular
 * events, and similar and nearby events around one listing (`?like={slug}`). Every result comes
 * from the public read model. Marketplace host only; off (back to /events) without an index.
 */
export default async function SearchPage({ params, searchParams }: Props) {
  const { locale } = await params;
  pageLocale(locale);
  const req = await requestHost();
  if (req.kind !== 'marketplace') notFound();
  const p = parseSearchV2Params(await searchParams);
  if (!(await searchEnabled()))
    redirect({ href: p.q ? `/events?q=${encodeURIComponent(p.q)}` : '/events', locale });
  const t = await getTranslations('market.search');
  const tm = await getTranslations('market');
  const [result, centers, popular, similar, promoted] = await Promise.all([
    cachedSearch(p),
    cachedCityCenters(),
    hasFilters(p) || p.like ? Promise.resolve([]) : cachedPopular(),
    p.like ? cachedSimilar(p.like) : Promise.resolve(null),
    p.like ? Promise.resolve([]) : cachedPromoted(p),
  ]);
  const near = result.near
    ? t('nearHeading', {
        km: result.near.radiusKm,
        place: result.near.label === 'me' ? t('nearYou') : result.near.label,
      })
    : null;
  return (
    <div className="min-h-dvh bg-surface">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pb-8 md:px-6">
        <div className="flex flex-col gap-2 pt-6">
          <h1 className="text-[40px] leading-none font-extrabold tracking-[-0.045em]">{t('title')}</h1>
          <p className="text-body text-ink-2">{t('lede')}</p>
        </div>
        <SearchV2Form locale={locale} params={p} result={result} centers={centers.map((c) => c.city)} />
        {p.near === 'me' && !result.near ? (
          <p role="status" className="text-body text-ink-2">
            {t('locationMissing')}
          </p>
        ) : null}
        {p.like ? (
          similar ? (
            <>
              <section aria-labelledby="similar-heading" className="flex flex-col gap-4">
                <h2 id="similar-heading" className="text-[28px] font-extrabold tracking-[-0.03em]">
                  {t('similarHeading', { name: similar.anchor.name })}
                </h2>
                <SearchGrid
                  items={similar.similar}
                  locale={locale}
                  label={t('similarLabel')}
                  empty={{ title: t('similarEmpty'), description: t('similarEmptyDescription') }}
                />
              </section>
              {similar.nearby.length > 0 ? (
                <section aria-labelledby="nearby-heading" className="flex flex-col gap-4">
                  <h2 id="nearby-heading" className="text-[28px] font-extrabold tracking-[-0.03em]">
                    {t('nearbyHeading')}
                  </h2>
                  <SearchGrid items={similar.nearby} locale={locale} label={t('nearbyHeading')} />
                </section>
              ) : null}
            </>
          ) : (
            <p role="status" className="text-body text-ink-2">
              {t('likeMissing')}
            </p>
          )
        ) : null}
        {popular.length > 0 ? (
          <section aria-labelledby="popular-heading" className="flex flex-col gap-4">
            <h2 id="popular-heading" className="text-[28px] font-extrabold tracking-[-0.03em]">
              {t('popularHeading')}
            </h2>
            <SearchGrid items={popular} locale={locale} label={t('popularHeading')} />
          </section>
        ) : null}
        {promoted.length > 0 ? (
          <section aria-labelledby="promoted-heading" className="flex flex-col gap-4">
            <h2 id="promoted-heading" className="text-[28px] font-extrabold tracking-[-0.03em]">
              {t('promotedHeading')}
            </h2>
            <p className="text-caption text-ink-2">{t('promotedNote')}</p>
            <SearchGrid items={promoted} locale={locale} label={t('promotedHeading')} badge={t('promoted')} />
          </section>
        ) : null}
        <section aria-labelledby="results-heading" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="results-heading" className="text-[28px] font-extrabold tracking-[-0.03em]">
              {near ?? (hasFilters(p) ? tm('results') : tm('upcoming'))}
            </h2>
            <p className="text-caption text-ink-2" role="status">
              {tm('count', { count: result.total })}
            </p>
          </div>
          <SearchGrid
            items={result.items}
            locale={locale}
            label={tm('results')}
            empty={{
              title: hasFilters(p) ? tm('empty.filteredTitle') : tm('empty.title'),
              description: hasFilters(p) ? t('emptyDescription') : tm('empty.description'),
              action: hasFilters(p) ? (
                <Link href="/search" className="text-body underline">
                  {tm('filters.clear')}
                </Link>
              ) : undefined,
            }}
          />
          <Pagination
            path="/search"
            params={searchQueryOf(p)}
            page={result.page}
            pageCount={result.pageCount}
          />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
