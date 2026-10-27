import { PAGE_SIZE, type SearchParams } from '@yayatoh/marketplace';
import { getTranslations } from 'next-intl/server';
import { PosterGrid } from '@/components/showcase/poster-grid.tsx';
import { Link } from '@/i18n/navigation.ts';
import { cachedCities, cachedMarketplace, cachedShowcaseEvents } from '@/server/public-data.ts';
import { Pagination } from './pagination.tsx';
import { SearchForm } from './search-form.tsx';

/**
 * Search form + results + pagination for the marketplace (`/events`), as poster cards. `topic` is a
 * platform category key (the home's category pills): it lists that category's next events instead.
 */
export async function MarketplaceResults({
  locale,
  params,
  path,
  limit,
  topic,
  type,
}: {
  locale: string;
  params: SearchParams;
  /** Where the form submits and pagination links point. */
  path: string;
  /** Show only the first N and a "see all" link. */
  limit?: number;
  topic?: string | undefined;
  /** An event type (profile) key: lists that type's next events. */
  type?: string | undefined;
}) {
  const t = await getTranslations('market');
  const tc = await getTranslations('categories');
  const tt = await getTranslations('showcase.types');
  const [results, cities, topical] = await Promise.all([
    cachedMarketplace(params),
    cachedCities(),
    topic || type ? cachedShowcaseEvents(topic ? 60 : 100, topic) : Promise.resolve(null),
  ]);
  const filtered = Boolean(
    topic || type || params.q || params.city || params.category || params.price || params.from || params.to,
  );
  const q = params.q?.toLowerCase();
  const topicItems =
    topical?.filter((e) => (!type || e.profile === type) && (!q || e.name.toLowerCase().includes(q))) ?? null;
  const all = topicItems ?? results.items;
  const items = limit ? all.slice(0, limit) : all;
  const total = topicItems ? topicItems.length : results.total;
  const raw: Record<string, string | undefined> = {
    q: params.q,
    city: params.city,
    category: params.category,
    price: params.price,
    from: params.from,
    to: params.to,
  };
  const heading = topic
    ? tc(topic as never)
    : type
      ? tt(type as 'concert')
      : filtered
        ? t('results')
        : t('upcoming');
  return (
    <div className="flex flex-col gap-8">
      <SearchForm action={path} locale={locale} params={params} cities={cities} />
      <section aria-labelledby="results-heading" className="flex flex-col gap-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="results-heading"
            className="font-display text-[26px] leading-none font-black tracking-[-0.02em] uppercase md:text-[34px]"
          >
            {heading}
          </h2>
          <p className="text-caption text-ink-2" role="status">
            {t('count', { count: total })}
          </p>
        </div>
        <PosterGrid
          items={items}
          locale={locale}
          label={heading}
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
        {topicItems ? null : limit ? (
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
