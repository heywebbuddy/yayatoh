import { plainExcerpt, rankArticles, searchTerms } from '@yayatoh/cms';
import { EmptyState } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { HelpShell, helpArticlePath } from '@/components/help/help-views.tsx';
import { Link } from '@/i18n/navigation.ts';
import { cachedHelpDocs, platformContentOrg } from '@/server/help.ts';
import { pageLocale } from '@/server/locale.ts';
import { requestHost } from '@/server/request-origin.ts';
import { apexOrigin, publicMetadata } from '@/server/seo.ts';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string | string[] }> };

/** Results shown per search (the help center is small: no paging). */
const MAX_RESULTS = 20;
const queryOf = (raw: string | string[] | undefined) =>
  (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 120).trim() ?? '';

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  const req = await requestHost();
  if (!(await platformContentOrg(req))) return {};
  const t = await getTranslations({ locale, namespace: 'help' });
  const q = queryOf((await searchParams).q);
  return publicMetadata({
    req,
    locale,
    canonicalOrigin: apexOrigin(req),
    path: '/help/search',
    title: q ? t('meta.search', { query: q }) : t('search.title'),
    image: `${req.origin}/api/og/home`,
    // Search results are for people, not for the index.
    index: false,
  });
}

/** Help center search: the published articles ranked by `rankArticles` (title first). */
export default async function HelpSearch({ params, searchParams }: Props) {
  const { locale } = await params;
  pageLocale(locale);
  const org = await platformContentOrg(await requestHost());
  if (!org) notFound();
  const t = await getTranslations('help');
  const q = queryOf((await searchParams).q);
  const ranked = searchTerms(q).length > 0 ? rankArticles(q, await cachedHelpDocs(org.orgId, locale)) : [];
  const results = ranked.slice(0, MAX_RESULTS);
  return (
    <HelpShell
      locale={locale}
      query={q}
      crumbs={[{ label: t('title'), href: '/help' }, { label: t('search.title') }]}
    >
      <h1 className="text-[32px] leading-tight font-extrabold tracking-[-0.03em] break-words">
        {q ? t('search.resultsFor', { query: q }) : t('search.title')}
      </h1>
      <p role="status" className="text-body text-ink-2">
        {q ? t('search.count', { count: ranked.length }) : t('search.prompt')}
      </p>
      {q && results.length === 0 ? (
        <EmptyState title={t('search.emptyTitle')} description={t('search.emptyDescription')} />
      ) : null}
      {results.length > 0 ? (
        <ol aria-label={t('search.results')} className="flex list-none flex-col gap-5 p-0">
          {results.map(({ doc }) => (
            <li
              key={doc.slug}
              lang={doc.locale === locale ? undefined : doc.locale}
              className="flex flex-col gap-1"
            >
              <Link
                href={helpArticlePath(doc.categorySlug, doc.slug)}
                className="inline-flex min-h-6 items-center text-[17px] break-words underline-offset-4 hover:underline"
              >
                {doc.title}
              </Link>
              <p className="text-body break-words text-ink-2">{doc.summary ?? plainExcerpt(doc.body)}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </HelpShell>
  );
}
