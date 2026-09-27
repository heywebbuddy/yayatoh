import { parseSearchParams } from '@yayatoh/marketplace';
import { buttonClass, CardLabel } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MarketplaceResults } from '@/components/marketplace/results.tsx';
import { SiteFooter, SiteHeader } from '@/components/marketplace/site-chrome.tsx';
import { Link } from '@/i18n/navigation.ts';
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
  setRequestLocale(locale);
  const t = await getTranslations('market');
  const sp = parseSearchParams(await searchParams);
  return (
    <div className="min-h-dvh bg-white">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 pb-8 md:px-6">
        <section className="flex flex-col gap-4 pt-8 md:pt-16">
          <CardLabel>{t('home.eyebrow')}</CardLabel>
          <h1 className="text-[40px] leading-none font-light tracking-[-0.045em] md:text-display">
            {t('home.title')}
          </h1>
          <p className="max-w-xl text-[15px] text-zinc-600">{t('home.lede')}</p>
          {devAuthEnabled() ? (
            <div className="flex flex-wrap gap-3">
              <Link className={buttonClass('secondary')} href="/dev/login">
                {t('home.demoCta')}
              </Link>
            </div>
          ) : null}
        </section>
        <MarketplaceResults locale={locale} params={{ ...sp, page: 1 }} path="/events" limit={6} />
      </main>
      <SiteFooter />
    </div>
  );
}
