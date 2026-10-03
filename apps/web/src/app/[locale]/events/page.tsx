import { parseSearchParams } from '@yayatoh/marketplace';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MarketplaceResults } from '@/components/marketplace/results.tsx';
import { SiteFooter, SiteHeader } from '@/components/marketplace/site-chrome.tsx';
import { pageLocale } from '@/server/locale.ts';
import { requestHost } from '@/server/request-origin.ts';
import { apexOrigin, publicMetadata } from '@/server/seo.ts';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  const sp = parseSearchParams(await searchParams);
  const t = await getTranslations({ locale, namespace: 'market' });
  const req = await requestHost();
  const filtered = Boolean(sp.q || sp.city || sp.category || sp.price || sp.from || sp.to || sp.page > 1);
  return publicMetadata({
    req,
    locale,
    canonicalOrigin: apexOrigin(req),
    path: '/events',
    title: t('events.title'),
    description: t('home.lede'),
    image: `${req.origin}/api/og/home`,
    // Filtered and paged views are for people, not the index (the unfiltered list is canonical).
    index: !filtered,
  });
}

/** All upcoming marketplace events with search, filters and pagination (legacy `/events`). */
export default async function EventsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  pageLocale(locale);
  const t = await getTranslations('market');
  const sp = parseSearchParams(await searchParams);
  return (
    <div className="min-h-dvh bg-surface">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pb-8 md:px-6">
        <h1 className="pt-6 text-[40px] leading-none font-extrabold tracking-[-0.045em]">
          {t('events.title')}
        </h1>
        <MarketplaceResults locale={locale} params={sp} path="/events" />
      </main>
      <SiteFooter />
    </div>
  );
}
