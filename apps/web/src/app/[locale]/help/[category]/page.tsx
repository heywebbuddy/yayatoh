import { slugProblem } from '@yayatoh/cms';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArticleList, HelpShell, helpCategoryPath } from '@/components/help/help-views.tsx';
import { cachedHelpCenter, platformContentOrg } from '@/server/help.ts';
import { pageLocale } from '@/server/locale.ts';
import { requestHost } from '@/server/request-origin.ts';
import { apexOrigin, publicMetadata } from '@/server/seo.ts';

type Props = { params: Promise<{ locale: string; category: string }> };

async function load(locale: string, slug: string) {
  if (slugProblem(slug)) return null;
  const req = await requestHost();
  const org = await platformContentOrg(req);
  if (!org) return null;
  const center = await cachedHelpCenter(org.orgId, locale);
  const category = center.categories.find((c) => c.slug === slug);
  if (!category) return null;
  return { req, category, articles: center.articles.filter((a) => a.categorySlug === slug) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, category } = await params;
  const found = await load(locale, category);
  if (!found) return {};
  const t = await getTranslations({ locale, namespace: 'help' });
  return publicMetadata({
    req: found.req,
    locale,
    canonicalOrigin: apexOrigin(found.req),
    path: helpCategoryPath(category),
    title: t('meta.category', { category: found.category.title }),
    description: found.category.description ?? t('meta.description'),
    image: `${found.req.origin}/api/og/home`,
  });
}

/** One help category: its published articles in the editor's order. */
export default async function HelpCategory({ params }: Props) {
  const { locale, category } = await params;
  pageLocale(locale);
  const found = await load(locale, category);
  if (!found) notFound();
  const t = await getTranslations('help');
  const c = found.category;
  return (
    <HelpShell
      locale={locale}
      crumbs={[{ label: t('title'), href: '/help' }, { label: c.title }]}
    >
      <header className="flex flex-col gap-2" lang={c.locale === locale ? undefined : c.locale}>
        <p className="text-caption text-zinc-500">{t(`audience.${c.audience}`)}</p>
        <h1 className="text-[40px] leading-tight font-light tracking-[-0.04em] break-words">{c.title}</h1>
        {c.description ? <p className="text-[17px] text-zinc-600">{c.description}</p> : null}
      </header>
      <ArticleList articles={found.articles} label={t('articlesIn', { category: c.title })} locale={locale} />
    </HelpShell>
  );
}
