import {
  PRICE_FILTER_BANDS,
  RADII_KM,
  SEARCH_SORTS,
  type SearchListingDto,
  type SearchResultDto,
  type SearchV2Params,
  WHEN_PRESETS,
} from '@yayatoh/marketplace';
import { publicCovers } from '@yayatoh/media';
import { buttonClass, EmptyState, Select } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation.ts';
import { localizedPath } from '@/lib/seo/urls.ts';
import { ListingCard } from './listing-card.tsx';
import { LocateButton } from './locate-button.tsx';

export const SEARCH_FORM_ID = 'search-v2';
const field = 'field w-full';

/** The URL parameters of a search, for links that keep it (pagination). */
export function searchQueryOf(p: SearchV2Params): Record<string, string | undefined> {
  const s = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
  return {
    q: p.q,
    category: p.category,
    price: p.price,
    when: p.when,
    from: p.from,
    to: p.to,
    city: p.city,
    near: p.near,
    lat: s(p.lat),
    lng: s(p.lng),
    radius: s(p.radius),
    sort: p.sort,
  };
}

/**
 * Search v2 filters (M6.14a) as a plain GET form: every facet is a labelled select whose options
 * carry their counts, the geo search is "near" a city (or the browser's location, with the button)
 * within a radius. Works without JavaScript except the location button.
 */
export async function SearchV2Form({
  locale,
  params: p,
  result,
  centers,
}: {
  locale: string;
  params: SearchV2Params;
  result: SearchResultDto;
  centers: readonly string[];
}) {
  const t = await getTranslations('market.search');
  const tf = await getTranslations('market.filters');
  const tc = await getTranslations('categories');
  const counted = (label: string, n: number | undefined) =>
    n === undefined ? label : t('optionCount', { label, count: n });
  const countOf = (list: readonly { value: string; count: number }[], v: string) =>
    list.find((c) => c.value === v)?.count ?? 0;
  const labelled = (id: string, label: string, control: ReactNode) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-bold text-ink">
        {label}
      </label>
      {control}
    </div>
  );
  const categories = [
    ...new Set([...result.facets.category.map((c) => c.value), ...(p.category ? [p.category] : [])]),
  ];
  const cities = [...new Set([...result.facets.city.map((c) => c.value), ...(p.city ? [p.city] : [])])];
  const nearOptions = [...new Set([...centers, ...(p.near && p.near !== 'me' ? [p.near] : [])])];
  return (
    <search aria-label={t('formLabel')}>
      <form
        id={SEARCH_FORM_ID}
        action={localizedPath(locale, '/search')}
        method="get"
        className="grid grid-cols-1 gap-3 rounded-card border border-line bg-surface p-4 md:grid-cols-6"
      >
        <div className="md:col-span-6">
          {labelled(
            'q',
            tf('query'),
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={p.q ?? ''}
              maxLength={100}
              className={field}
            />,
          )}
        </div>
        <div className="md:col-span-2">
          {labelled(
            'category',
            tf('category'),
            <Select id="category" name="category" defaultValue={p.category ?? ''} className={field}>
              <option value="">{tf('anyCategory')}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {counted(tc(c as 'other'), countOf(result.facets.category, c))}
                </option>
              ))}
            </Select>,
          )}
        </div>
        <div className="md:col-span-2">
          {labelled(
            'price',
            tf('price'),
            <Select id="price" name="price" defaultValue={p.price ?? ''} className={field}>
              <option value="">{tf('anyPrice')}</option>
              {PRICE_FILTER_BANDS.map((b) => (
                <option key={b} value={b}>
                  {counted(t(`priceBand.${b as 'free'}`), countOf(result.facets.price, b))}
                </option>
              ))}
            </Select>,
          )}
        </div>
        <div className="md:col-span-2">
          {labelled(
            'when',
            t('when'),
            <Select id="when" name="when" defaultValue={p.when ?? ''} className={field}>
              <option value="">{t('anyTime')}</option>
              {WHEN_PRESETS.map((w) => (
                <option key={w} value={w}>
                  {counted(t(`whenOption.${w}`), countOf(result.facets.when, w))}
                </option>
              ))}
            </Select>,
          )}
        </div>
        <div className="md:col-span-2">
          {labelled(
            'city',
            tf('city'),
            <Select id="city" name="city" defaultValue={p.city ?? ''} className={field}>
              <option value="">{tf('anyCity')}</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {counted(c, countOf(result.facets.city, c))}
                </option>
              ))}
            </Select>,
          )}
        </div>
        <div className="md:col-span-2">
          {labelled(
            'near',
            t('near'),
            <Select id="near" name="near" defaultValue={p.near ?? ''} className={field}>
              <option value="">{t('nearAnywhere')}</option>
              {p.near === 'me' ? <option value="me">{t('nearMe')}</option> : null}
              {nearOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>,
          )}
        </div>
        <div className="md:col-span-2">
          {labelled(
            'radius',
            t('radius'),
            <Select id="radius" name="radius" defaultValue={String(p.radius ?? 25)} className={field}>
              {RADII_KM.map((r) => (
                <option key={r} value={String(r)}>
                  {t('radiusOption', { km: r })}
                </option>
              ))}
            </Select>,
          )}
        </div>
        <div className="md:col-span-3">
          {labelled(
            'sort',
            t('sort'),
            <Select id="sort" name="sort" defaultValue={p.sort ?? ''} className={field}>
              <option value="">{t('sortOption.default')}</option>
              {SEARCH_SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`sortOption.${s}`)}
                </option>
              ))}
            </Select>,
          )}
        </div>
        {p.near === 'me' && p.lat !== undefined && p.lng !== undefined ? (
          <>
            <input type="hidden" name="lat" value={String(p.lat)} />
            <input type="hidden" name="lng" value={String(p.lng)} />
          </>
        ) : null}
        <div className="flex flex-wrap items-start gap-3 md:col-span-6">
          <button type="submit" className={buttonClass('primary')}>
            {tf('submit')}
          </button>
          <LocateButton formId={SEARCH_FORM_ID} />
          <Link href="/search" className="inline-flex min-h-10 items-center text-body underline">
            {tf('clear')}
          </Link>
        </div>
      </form>
    </search>
  );
}

/** A list of search results or recommendations: listing cards, with the distance when geo-sorted. */
export async function SearchGrid({
  items,
  locale,
  label,
  empty,
  badge,
}: {
  items: readonly SearchListingDto[];
  locale: string;
  label: string;
  empty?: { title: string; description: string; action?: ReactNode };
  /** M6.14b: a tag on every card (promoted placements are always labelled). */
  badge?: string;
}) {
  const t = await getTranslations('market.search');
  if (items.length === 0)
    return empty ? (
      <EmptyState title={empty.title} description={empty.description} action={empty.action} />
    ) : null;
  const covers = await publicCovers(items.map((l) => l.slug));
  return (
    <ul aria-label={label} className="grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2 xl:grid-cols-3">
      {items.map((l) => (
        <li key={l.slug} className="flex flex-col gap-1" data-promoted={badge ? 'true' : undefined}>
          {badge ? (
            <span className="self-start rounded-tag bg-tag px-2 py-0.5 text-label text-tag-ink">{badge}</span>
          ) : null}
          <ListingCard
            listing={l}
            cover={covers.get(l.slug) ?? null}
            locale={locale}
            organizerHref={`/o/${l.orgSlug}`}
          />
          {l.distanceKm !== null ? (
            <p className="text-caption text-ink-2">
              {t('distance', {
                km: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(l.distanceKm),
              })}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
