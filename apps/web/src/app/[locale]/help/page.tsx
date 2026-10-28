import { HELP_AUDIENCES } from '@yayatoh/cms';
import { EmptyState } from '@yayatoh/ui';
import { LifeBuoy } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CategoryGrid, HelpShell } from '@/components/help/help-views.tsx';
import { HomeFaq } from '@/components/showcase/home-sections.tsx';
import { PageCta, PageHero } from '@/components/showcase/page-hero.tsx';
import { cachedHelpCenter, platformContentOrg } from '@/server/help.ts';
import { pageLocale } from '@/server/locale.ts';
import { requestHost } from '@/server/request-origin.ts';
import { apexOrigin, publicMetadata } from '@/server/seo.ts';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const req = await requestHost();
  const t = await getTranslations({ locale, namespace: 'help' });
  return publicMetadata({
    req,
    locale,
    canonicalOrigin: apexOrigin(req),
    path: '/help',
    title: t('meta.title'),
    description: t('meta.description'),
    image: `${req.origin}/api/og/home`,
  });
}

/** The help center (M3.11b): categories for organizers and for buyers, and search. */
export default async function HelpCenter({ params }: Props) {
  const { locale } = await params;
  pageLocale(locale);
  const org = await platformContentOrg(await requestHost());
  const t = await getTranslations('help');
  const tp = await getTranslations('pages');
  const center = org ? await cachedHelpCenter(org.orgId, locale) : { categories: [] };
  return (
    <HelpShell locale={locale} crumbs={[]}>
      <PageHero eyebrow={tp('eyebrow.help')} title={t('title')} lede={t('lede')} icon={LifeBuoy} />
      {center.categories.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        HELP_AUDIENCES.map((audience) => {
          const categories = center.categories.filter((c) => c.audience === audience);
          if (categories.length === 0) return null;
          return (
            <section key={audience} aria-labelledby={`help-${audience}`} className="flex flex-col gap-4">
              <h2 id={`help-${audience}`} className="text-[24px] font-extrabold tracking-[-0.02em]">
                {t(`audience.${audience}`)}
              </h2>
              <CategoryGrid categories={categories} headingId={`help-${audience}`} locale={locale} />
            </section>
          );
        })
      )}
      <HomeFaq />
      <PageCta />
    </HelpShell>
  );
}
