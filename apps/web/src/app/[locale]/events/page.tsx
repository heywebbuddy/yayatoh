import { parseSearchParams } from '@yayatoh/marketplace';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MarketplaceResults } from '@/components/marketplace/results.tsx';
import { CategoryRail } from '@/components/showcase/category-rail.tsx';
import { PILL_CATEGORIES } from '@/components/showcase/home-data.ts';
import { ShowcaseShell } from '@/components/showcase/shell.tsx';
import { Link } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { requestHost } from '@/server/request-origin.ts';
import { searchConfigured } from '@/server/search.ts';
import { apexOrigin, publicMetadata } from '@/server/seo.ts';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** A platform category key from `?topic=`, or undefined (anything else is dropped). */
const topicOf = (sp: Record<string, string | string[] | undefined>): string | undefined => {
  const v = Array.isArray(sp.topic) ? sp.topic[0] : sp.topic;
  return v && (PILL_CATEGORIES as readonly string[]).includes(v) ? v : undefined;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  const raw = await searchParams;
  const sp = parseSearchParams(raw);
  const t = await getTranslations({ locale, namespace: 'market' });
  const req = await requestHost();
  const filtered = Boolean(
    sp.q || sp.city || sp.category || sp.price || sp.from || sp.to || sp.page > 1 || topicOf(raw),
  );
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

/** All upcoming marketplace events with search, filters and pagination, as poster cards. */
export default async function EventsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  pageLocale(locale);
  const t = await getTranslations('market');
  const raw = await searchParams;
  const sp = parseSearchParams(raw);
  const topic = topicOf(raw);
  return (
    <ShowcaseShell>
      <h1 className="pt-10 font-display text-[clamp(34px,6vw,72px)] leading-none font-black tracking-[-0.04em] uppercase">
        {t('events.title')}
      </h1>
      <CategoryRail keys={PILL_CATEGORIES} active={topic} />
      {/* M6.14a: search v2 (facets, geo, recommendations) when an index is configured. */}
      {searchConfigured() && (await requestHost()).kind === 'marketplace' ? (
        <Link
          href="/search"
          className="-mt-8 inline-flex min-h-6 items-center self-start text-body underline"
        >
          {t('search.openSearch')}
        </Link>
      ) : null}
      <MarketplaceResults locale={locale} params={sp} path="/events" topic={topic} />
    </ShowcaseShell>
  );
}
