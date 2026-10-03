import { Card, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DocsSearch } from '@/components/developers/docs-search.tsx';
import { Link } from '@/i18n/navigation.ts';
import { GUIDES } from '@/lib/developer-guides.ts';
import { matchDocs } from '@/lib/docs-search.ts';
import { localizedPath } from '@/lib/seo/urls.ts';
import { searchIndex } from '@/server/developer-docs.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'developers' });
  return { title: t('title'), description: t('subtitle') };
}

/** Developer docs home: search, the guides, and the way to the reference and the event catalog. */
export default async function DevelopersHome({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const { q } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('developers');
  const index = searchIndex();
  const query = typeof q === 'string' ? q.slice(0, 100) : '';
  const results = query ? matchDocs(index, query) : [];
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <DocsSearch index={index} action={localizedPath(locale, '/developers')} initial={query} />
      {query ? (
        <section aria-labelledby="search-results" className="flex flex-col gap-2">
          <h2 id="search-results" className="text-section">
            {t('search.resultsFor', { query })}
          </h2>
          {results.length === 0 ? (
            <p className="text-body text-ink-2">{t('search.none')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {results.map((r) => (
                <li key={`${r.kind}:${r.href}`}>
                  <Link
                    href={r.href}
                    className="inline-flex min-h-11 flex-col justify-center underline-offset-2 hover:underline"
                  >
                    <span dir="ltr" lang="en" className="font-mono text-caption">
                      {r.title}
                    </span>
                    <span lang="en" className="text-caption text-ink-2">
                      {r.detail}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      <p className="text-body text-ink-2">{t('englishNotice')}</p>
      <section aria-labelledby="start" className="grid gap-4 md:grid-cols-3">
        <h2 id="start" className="sr-only">
          {t('startTitle')}
        </h2>
        {[
          { href: '/developers/guides', title: t('nav.guides'), body: t('cards.guides') },
          { href: '/developers/reference', title: t('nav.reference'), body: t('cards.reference') },
          { href: '/developers/events', title: t('nav.events'), body: t('cards.events') },
        ].map((c) => (
          <Card key={c.href} className="flex flex-col gap-2">
            <h3 className="text-section">
              <Link href={c.href} className="underline underline-offset-2">
                {c.title}
              </Link>
            </h3>
            <p className="text-body text-ink-2">{c.body}</p>
          </Card>
        ))}
      </section>
      <section aria-labelledby="guides" className="flex flex-col gap-3">
        <h2 id="guides" className="text-section">
          {t('nav.guides')}
        </h2>
        <ul className="grid gap-2 md:grid-cols-2">
          {GUIDES.map((g) => (
            <li key={g.slug}>
              <Link
                href={`/developers/guides/${g.slug}`}
                className="flex min-h-11 flex-col rounded-card border border-line bg-surface-solid px-4 py-3 hover:bg-surface-2"
              >
                <span lang="en" className="text-body font-medium">
                  {g.title}
                </span>
                <span lang="en" className="text-caption text-ink-2">
                  {g.summary.replaceAll('`', '')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
