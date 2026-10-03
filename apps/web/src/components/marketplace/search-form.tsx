import { CATEGORIES, PRICE_FILTERS, type SearchParams } from '@yayatoh/marketplace';
import { buttonClass } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { localizedPath } from '@/lib/seo/urls.ts';

const field = 'field w-full';

/**
 * Search and filters as a plain GET form: works without JavaScript, shareable URLs, and every
 * control is a native, labelled, keyboard-operable input.
 */
export async function SearchForm({
  action,
  locale,
  params,
  cities,
}: {
  action: string;
  locale: string;
  params: SearchParams;
  cities: readonly string[];
}) {
  const t = await getTranslations('market.filters');
  const tc = await getTranslations('market.category');
  const active = Boolean(
    params.q || params.city || params.category || params.price || params.from || params.to,
  );
  const labelled = (id: string, label: string, control: React.ReactNode) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-bold text-ink">
        {label}
      </label>
      {control}
    </div>
  );
  return (
    <search aria-label={t('label')}>
      <form
        action={localizedPath(locale, action)}
        method="get"
        className="grid grid-cols-1 gap-3 rounded-card border border-line bg-surface p-4 md:grid-cols-6"
      >
        <div className="md:col-span-6">
          {labelled(
            'q',
            t('query'),
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={params.q ?? ''}
              maxLength={100}
              className={field}
            />,
          )}
        </div>
        <div className="md:col-span-2">
          {labelled(
            'city',
            t('city'),
            <select id="city" name="city" defaultValue={params.city ?? ''} className={field}>
              <option value="">{t('anyCity')}</option>
              {[...new Set([...(params.city ? [params.city] : []), ...cities])].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>,
          )}
        </div>
        <div className="md:col-span-2">
          {labelled(
            'category',
            t('category'),
            <select id="category" name="category" defaultValue={params.category ?? ''} className={field}>
              <option value="">{t('anyCategory')}</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {tc(c)}
                </option>
              ))}
            </select>,
          )}
        </div>
        <div className="md:col-span-2">
          {labelled(
            'price',
            t('price'),
            <select id="price" name="price" defaultValue={params.price ?? ''} className={field}>
              <option value="">{t('anyPrice')}</option>
              {PRICE_FILTERS.map((p) => (
                <option key={p} value={p}>
                  {t(`priceOption.${p}`)}
                </option>
              ))}
            </select>,
          )}
        </div>
        <div className="md:col-span-3">
          {labelled(
            'from',
            t('from'),
            <input id="from" name="from" type="date" defaultValue={params.from ?? ''} className={field} />,
          )}
        </div>
        <div className="md:col-span-3">
          {labelled(
            'to',
            t('to'),
            <input id="to" name="to" type="date" defaultValue={params.to ?? ''} className={field} />,
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 md:col-span-6">
          <button type="submit" className={buttonClass('primary')}>
            {t('submit')}
          </button>
          {active ? (
            <Link href={action} className="inline-flex min-h-10 items-center text-body underline">
              {t('clear')}
            </Link>
          ) : null}
        </div>
      </form>
    </search>
  );
}
