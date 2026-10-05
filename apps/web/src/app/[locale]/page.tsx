import { parseSearchParams } from '@yayatoh/marketplace';
import { buttonClass, CardLabel } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SiteSections } from '@/components/marketing/site-sections.tsx';
import { MarketplaceResults } from '@/components/marketplace/results.tsx';
import { SiteFooter, SiteHeader } from '@/components/marketplace/site-chrome.tsx';
import { Link } from '@/i18n/navigation.ts';
import { cachedSections, platformContentOrg } from '@/server/help.ts';
import { pageLocale } from '@/server/locale.ts';
import { requestHost } from '@/server/request-origin.ts';
import { apexOrigin, publicMetadata } from '@/server/seo.ts';
import { devAuthEnabled } from '@/server/session.ts';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'market' });
  const req = await requestHost();
  return publicMetadata({
    req,
    locale,
    canonicalOrigin: apexOrigin(req),
    path: '/',
    title: t('home.metaTitle'),
    description: t('home.lede'),
    image: `${req.origin}/api/og/home`,
  });
}

/** The marketplace home (yayatoh.com; `/` locally): search and the next upcoming events. */
export default async function Home({ params, searchParams }: Props) {
  const { locale } = await params;
  pageLocale(locale);
  const t = await getTranslations('market');
  const sp = parseSearchParams(await searchParams);
  // M3.11b: the organizer sections ("Why Yayatoh") come from the platform CMS.
  const content = await platformContentOrg(await requestHost());
  const sections = content ? await cachedSections(content.orgId, 'home', locale) : [];
  return (
    <div className="min-h-dvh bg-surface">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 pb-8 md:px-6">
        <section className="flex flex-col gap-4 pt-8 md:pt-16">
          <CardLabel>{t('home.eyebrow')}</CardLabel>
          <h1 className="text-[40px] leading-none font-extrabold tracking-[-0.045em] md:text-display">
            {t('home.title')}
          </h1>
          <p className="max-w-xl text-[15px] text-ink-2">{t('home.lede')}</p>
          {devAuthEnabled() ? (
            <div className="flex flex-wrap gap-3">
              <Link className={buttonClass('secondary')} href="/dev/login">
                {t('home.demoCta')}
              </Link>
            </div>
          ) : null}
        </section>
        <MarketplaceResults locale={locale} params={{ ...sp, page: 1 }} path="/events" limit={6} />
        {sections.length > 0 ? (
          <section
            aria-labelledby="home-organizers"
            className="flex flex-col gap-6 border-t border-line pt-10"
          >
            <div className="flex flex-col gap-2">
              <h2
                id="home-organizers"
                className="text-[32px] leading-tight font-extrabold tracking-[-0.03em]"
              >
                {t('home.organizersTitle')}
              </h2>
              <Link href="/features" className="self-start text-body underline underline-offset-4">
                {t('home.organizersMore')}
              </Link>
            </div>
            <SiteSections sections={sections} layout="grid" locale={locale} headingLevel={3} />
          </section>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}
