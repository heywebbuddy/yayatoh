import { EmptyState } from '@yayatoh/ui';
import { Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SiteSections } from '@/components/marketing/site-sections.tsx';
import { SiteFooter, SiteHeader } from '@/components/marketplace/site-chrome.tsx';
import { PageCta, PageHero } from '@/components/showcase/page-hero.tsx';
import { cachedSections, platformContentOrg } from '@/server/help.ts';
import { pageLocale } from '@/server/locale.ts';
import { requestHost } from '@/server/request-origin.ts';
import { apexOrigin, publicMetadata } from '@/server/seo.ts';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const req = await requestHost();
  if (!(await platformContentOrg(req))) return {};
  const t = await getTranslations({ locale, namespace: 'marketing' });
  return publicMetadata({
    req,
    locale,
    canonicalOrigin: apexOrigin(req),
    path: '/features',
    title: t('features.metaTitle'),
    description: t('features.lede'),
    image: `${req.origin}/api/og/home`,
  });
}

/** Features for organizers (M3.11b): the platform CMS's `features` sections under a fixed frame. */
export default async function Features({ params }: Props) {
  const { locale } = await params;
  pageLocale(locale);
  const org = await platformContentOrg(await requestHost());
  if (!org) notFound();
  const t = await getTranslations('marketing');
  const tp = await getTranslations('pages');
  const sections = await cachedSections(org.orgId, 'features', locale);
  return (
    <div className="min-h-dvh bg-surface">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-6 md:px-6">
        <PageHero
          eyebrow={tp('eyebrow.features')}
          title={t('features.title')}
          lede={t('features.lede')}
          icon={Sparkles}
        />
        {sections.length === 0 ? (
          <EmptyState title={t('features.emptyTitle')} description={t('features.emptyDescription')} />
        ) : (
          <SiteSections sections={sections} layout="stack" locale={locale} />
        )}
        <PageCta title={t('features.contactCta')} href="/contact" label={t('features.contactCta')} />
      </main>
      <SiteFooter />
    </div>
  );
}
