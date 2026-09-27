import { PAGE_SIZE, type SearchParams } from '@yayatoh/marketplace';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { cachedCities, cachedMarketplace } from '@/server/public-data.ts';
import { requestHost } from '@/server/request-origin.ts';
import { ListingGrid } from './listing-grid.tsx';
import { Pagination } from './pagination.tsx';
import { SearchForm } from './search-form.tsx';

/** Search form + results + pagination for the marketplace (home and /events). */
export async function MarketplaceResults({
  locale,
  params,
  path,
  limit,
}: {
  locale: string;
  params: SearchParams;
  /** Where the form submits and pagination links point. */
  path: string;
  /** Show only the first N (the home page's teaser) and a "see all" link. */
  limit?: number;
}) {
  const t = await getTranslations('market');
  const [results, cities, req] = await Promise.all([
    cachedMarketplace(params),
    cachedCities(),
    requestHost(),
  ]);
  const organizerHref = (slug: string) => (req.kind === 'marketplace' ? `/o/${slug}` : `/organizers/${slug}`);
  const filtered = Boolean(
    params.q || params.city || params.category || params.price || params.from || params.to,
  );
  const items = limit ? results.items.slice(0, limit) : results.items;
  const raw: Record<string, string | undefined> = {
    q: params.q,
    city: params.city,
    category: params.category,
    price: params.price,
    from: params.from,
    to: params.to,
  };
  return (
    <div className="flex flex-col gap-6">
      <SearchForm action={path} locale={locale} params={params} cities={cities} />
      <section aria-labelledby="results-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="results-heading" className="text-[28px] font-normal tracking-[-0.03em]">
            {filtered ? t('results') : t('upcoming')}
          </h2>
          <p className="text-caption text-zinc-600" role="status">
            {t('count', { count: results.total })}
          </p>
        </div>
        <ListingGrid
          items={items}
          locale={locale}
          label={filtered ? t('results') : t('upcoming')}
          organizerHref={organizerHref}
          empty={
            filtered
              ? {
                  title: t('empty.filteredTitle'),
                  description: t('empty.filteredDescription'),
                  action: (
                    <Link href={path} className="text-body underline">
                      {t('filters.clear')}
                    </Link>
                  ),
                }
              : { title: t('empty.title'), description: t('empty.description') }
          }
        />
        {limit ? (
          results.total > limit || results.total > PAGE_SIZE ? (
            <Link href="/events" className="self-start text-body underline">
              {t('seeAll')}
            </Link>
          ) : null
        ) : (
          <Pagination path={path} params={raw} page={results.page} pageCount={results.pageCount} />
        )}
      </section>
    </div>
  );
}
