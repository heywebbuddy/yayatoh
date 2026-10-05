import { buttonClass, EmptyState } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SiteSections } from '@/components/marketing/site-sections.tsx';
import { SiteFooter, SiteHeader } from '@/components/marketplace/site-chrome.tsx';
import { Link } from '@/i18n/navigation.ts';
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
  const sections = await cachedSections(org.orgId, 'features', locale);
  return (
    <div className="min-h-dvh bg-surface">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-8 md:px-6 md:py-16">
        <header className="flex flex-col gap-3">
          <h1 className="text-[40px] leading-tight font-extrabold tracking-[-0.045em]">
            {t('features.title')}
          </h1>
          <p className="max-w-2xl text-[17px] text-ink-2">{t('features.lede')}</p>
        </header>
        {sections.length === 0 ? (
          <EmptyState title={t('features.emptyTitle')} description={t('features.emptyDescription')} />
        ) : (
          <SiteSections sections={sections} layout="stack" locale={locale} />
        )}
        <div className="flex flex-wrap gap-3 border-t border-line pt-8">
          <Link href="/contact" className={buttonClass('primary')}>
            {t('features.contactCta')}
          </Link>
          <Link href="/help" className={buttonClass('secondary')}>
            {t('features.helpCta')}
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
