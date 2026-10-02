import type { PublicHelpArticleSummaryDto, PublicHelpCategoryDto } from '@yayatoh/cms';
import { buttonClass } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SiteFooter, SiteHeader } from '@/components/marketplace/site-chrome.tsx';
import { Link } from '@/i18n/navigation.ts';
import { localizedPath } from '@/lib/seo/urls.ts';

/** Path of a help category and article (M3.11b). */
export const helpCategoryPath = (category: string) => `/help/${category}`;
export const helpArticlePath = (category: string, article: string) => `/help/${category}/${article}`;

export interface Crumb {
  readonly label: string;
  readonly href?: string;
}

/** The help center's frame: site header, breadcrumbs, the search box and the footer. */
export async function HelpShell({
  locale,
  crumbs,
  query,
  children,
}: {
  locale: string;
  crumbs: readonly Crumb[];
  query?: string;
  children: ReactNode;
}) {
  const t = await getTranslations('help');
  return (
    <div className="min-h-dvh bg-surface">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8 md:px-6">
        {crumbs.length > 0 ? (
          <nav aria-label={t('breadcrumbs')}>
            <ol className="flex list-none flex-wrap items-center gap-x-2 gap-y-1 p-0 text-caption text-ink-2">
              {crumbs.map((c, i) => (
                <li key={c.label} className="flex min-w-0 items-center gap-2">
                  {i > 0 ? <span aria-hidden="true">/</span> : null}
                  {c.href ? (
                    <Link href={c.href} className="inline-flex min-h-6 items-center break-words underline">
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="break-words">
                      {c.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <HelpSearchForm locale={locale} query={query} />
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

/** Search the help center: a plain GET form, so it works without JavaScript. */
export async function HelpSearchForm({ locale, query }: { locale: string; query?: string }) {
  const t = await getTranslations('help');
  return (
    <search aria-label={t('search.label')}>
      <form
        action={localizedPath(locale, '/help/search')}
        method="get"
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="help-q" className="text-[13px] font-bold text-ink">
            {t('search.field')}
          </label>
          <input
            id="help-q"
            name="q"
            type="search"
            maxLength={120}
            defaultValue={query}
            placeholder={t('search.placeholder')}
            className="field w-full"
          />
        </div>
        <button type="submit" className={buttonClass('primary')}>
          {t('search.submit')}
        </button>
      </form>
    </search>
  );
}

/** A list of article links with their summaries. */
export function ArticleList({
  articles,
  label,
  locale,
}: {
  articles: readonly Pick<
    PublicHelpArticleSummaryDto,
    'slug' | 'categorySlug' | 'title' | 'summary' | 'locale'
  >[];
  label: string;
  locale: string;
}) {
  return (
    <ul aria-label={label} className="flex list-none flex-col gap-4 p-0">
      {articles.map((a) => (
        <li key={a.slug} lang={a.locale === locale ? undefined : a.locale} className="flex flex-col gap-1">
          <Link
            href={helpArticlePath(a.categorySlug, a.slug)}
            className="inline-flex min-h-6 items-center text-[17px] break-words underline-offset-4 hover:underline"
          >
            {a.title}
          </Link>
          {a.summary ? <p className="text-body break-words text-ink-2">{a.summary}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/** One audience's categories as cards. */
export async function CategoryGrid({
  categories,
  headingId,
  locale,
}: {
  categories: readonly PublicHelpCategoryDto[];
  headingId: string;
  locale: string;
}) {
  const t = await getTranslations('help');
  return (
    <ul aria-labelledby={headingId} className="grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2">
      {categories.map((c) => (
        <li
          key={c.slug}
          lang={c.locale === locale ? undefined : c.locale}
          className="flex flex-col gap-2 rounded-card border border-line p-4"
        >
          <h3 className="text-[19px] font-extrabold tracking-[-0.02em] break-words">
            <Link href={helpCategoryPath(c.slug)} className="underline-offset-4 hover:underline">
              {c.title}
            </Link>
          </h3>
          {c.description ? <p className="text-body break-words text-ink-2">{c.description}</p> : null}
          <p className="text-caption text-ink-2">{t('articleCount', { count: c.articleCount })}</p>
        </li>
      ))}
    </ul>
  );
}
