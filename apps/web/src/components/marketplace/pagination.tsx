import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';

/** Previous / next links that keep the other search parameters. */
export async function Pagination({
  path,
  params,
  page,
  pageCount,
}: {
  path: string;
  params: Record<string, string | undefined>;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;
  const t = await getTranslations('market.pagination');
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== 'page') q.set(k, v);
    if (p > 1) q.set('page', String(p));
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  const link = 'inline-flex min-h-10 items-center rounded-pill border border-line bg-surface px-4 text-body';
  return (
    <nav aria-label={t('label')} className="flex flex-wrap items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" className={link}>
          {t('previous')}
        </Link>
      ) : (
        <span />
      )}
      <p className="text-caption text-ink-2" aria-current="page">
        {t('status', { page, count: pageCount })}
      </p>
      {page < pageCount ? (
        <Link href={href(page + 1)} rel="next" className={link}>
          {t('next')}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
