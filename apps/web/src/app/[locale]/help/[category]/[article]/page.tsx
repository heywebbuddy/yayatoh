import { relatedArticles, slugProblem } from '@yayatoh/cms';
import { markdownToPlainText } from '@yayatoh/contracts';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { HelpFeedbackForm } from '@/components/help/feedback-form.tsx';
import { ArticleList, HelpShell, helpArticlePath, helpCategoryPath } from '@/components/help/help-views.tsx';
import { Markdown } from '@/components/markdown.tsx';
import { formatDate } from '@/lib/format.ts';
import { jsonLdScript } from '@/lib/seo/jsonld.ts';
import { localizedPath } from '@/lib/seo/urls.ts';
import { cachedHelpArticle, cachedHelpCenter, platformContentOrg } from '@/server/help.ts';
import { pageLocale } from '@/server/locale.ts';
import { requestHost } from '@/server/request-origin.ts';
import { apexOrigin, publicMetadata } from '@/server/seo.ts';
import { helpFeedbackAction } from '../../actions.ts';

type Props = { params: Promise<{ locale: string; category: string; article: string }> };

async function load(locale: string, slug: string) {
  if (slugProblem(slug)) return null;
  const req = await requestHost();
  const org = await platformContentOrg(req);
  if (!org) return null;
  const found = await cachedHelpArticle(org.orgId, locale, slug);
  return found ? { req, org, article: found.article } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, article: slug } = await params;
  const found = await load(locale, slug);
  if (!found) return {};
  const a = found.article;
  const meta = publicMetadata({
    req: found.req,
    locale,
    canonicalOrigin: apexOrigin(found.req),
    path: helpArticlePath(a.categorySlug, a.slug),
    title: a.seoTitle ?? a.title,
    description: a.seoDescription ?? a.summary ?? (markdownToPlainText(a.body).slice(0, 160) || null),
    image: `${found.req.origin}/api/og/home`,
  });
  return { ...meta, openGraph: { ...meta.openGraph, type: 'article' } };
}

/** A help article (M3.11b): the text, related articles and "was this helpful?". */
export default async function HelpArticle({ params }: Props) {
  const { locale, category, article: slug } = await params;
  pageLocale(locale);
  const found = await load(locale, slug);
  if (!found) notFound();
  const a = found.article;
  // The address carries the category: a moved article's old category path forwards.
  if (a.categorySlug !== category)
    permanentRedirect(localizedPath(locale, helpArticlePath(a.categorySlug, a.slug)));
  const t = await getTranslations('help');
  const center = await cachedHelpCenter(found.org.orgId, locale);
  const cat = center.categories.find((c) => c.slug === a.categorySlug);
  const related = relatedArticles(a, center.articles);
  const origin = apexOrigin(found.req);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: t('title'),
        item: `${origin}${localizedPath(locale, '/help')}`,
      },
      ...(cat
        ? [
            {
              '@type': 'ListItem',
              position: 2,
              name: cat.title,
              item: `${origin}${localizedPath(locale, helpCategoryPath(cat.slug))}`,
            },
          ]
        : []),
      {
        '@type': 'ListItem',
        position: cat ? 3 : 2,
        name: a.title,
        item: `${origin}${localizedPath(locale, helpArticlePath(a.categorySlug, a.slug))}`,
      },
    ],
  };
  return (
    <HelpShell
      locale={locale}
      crumbs={[
        { label: t('title'), href: '/help' },
        ...(cat ? [{ label: cat.title, href: helpCategoryPath(cat.slug) }] : []),
        { label: a.title },
      ]}
    >
      <script
        type="application/ld+json"
        // JSON-LD must be inline; jsonLdScript escapes `<` so the text cannot close the script.
        dangerouslySetInnerHTML={{ __html: jsonLdScript(ld) }}
      />
      <article className="flex flex-col gap-6" lang={a.locale === locale ? undefined : a.locale}>
        <header className="flex flex-col gap-2">
          <h1 className="text-[36px] leading-tight font-extrabold tracking-[-0.03em] break-words">
            {a.title}
          </h1>
          {a.summary ? <p className="text-[17px] leading-7 text-ink-2">{a.summary}</p> : null}
          <p className="text-caption text-ink-2">
            {t('updated', {
              date: formatDate(
                a.updatedAt.toISOString(),
                { locale, currency: 'USD', timeZone: 'UTC' },
                { year: 'numeric', month: 'long', day: 'numeric' },
              ),
            })}
          </p>
        </header>
        {a.locale !== locale ? (
          <p
            role="note"
            lang={locale}
            className="rounded-card border border-line px-4 py-3 text-body text-ink-2"
          >
            {t('notTranslated')}
          </p>
        ) : null}
        <Markdown source={a.body} />
      </article>
      <HelpFeedbackForm action={helpFeedbackAction.bind(null, a.slug, a.locale)} />
      {related.length > 0 ? (
        <section aria-labelledby="help-related" className="flex flex-col gap-4">
          <h2 id="help-related" className="text-[22px] font-extrabold tracking-[-0.02em]">
            {t('related')}
          </h2>
          <ArticleList articles={related} label={t('related')} locale={locale} />
        </section>
      ) : null}
    </HelpShell>
  );
}
