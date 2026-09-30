import { parseSearchParams, publicOrganizer } from '@yayatoh/marketplace';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ListingGrid } from '@/components/marketplace/listing-grid.tsx';
import { OrgHero } from '@/components/marketplace/org-hero.tsx';
import { Pagination } from '@/components/marketplace/pagination.tsx';
import { SiteFooter, SiteHeader } from '@/components/marketplace/site-chrome.tsx';
import { Link } from '@/i18n/navigation.ts';
import { originFor } from '@/lib/hosts.ts';
import { cachedEntries } from '@/server/cms.ts';
import { pageLocale } from '@/server/locale.ts';
import { cachedOrganizerListings } from '@/server/public-data.ts';
import { requestHost } from '@/server/request-origin.ts';
import { apexOrigin, publicMetadata } from '@/server/seo.ts';

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const o = await publicOrganizer(slug);
  if (!o) return {};
  const t = await getTranslations({ locale, namespace: 'market' });
  const req = await requestHost();
  return publicMetadata({
    req,
    locale,
    canonicalOrigin: apexOrigin(req),
    path: `/o/${o.slug}`,
    title: o.name,
    description: t('organizer.description', { org: o.name }),
    image: `${req.origin}/api/og/org/${o.slug}`,
  });
}

/**
 * An organizer's public page on the marketplace (`yayatoh.com/o/{slug}`, which the proxy
 * rewrites here; legacy root organizer URLs 308 to it). Lists all its public events.
 */
export default async function OrganizerPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  pageLocale(locale);
  const o = await publicOrganizer(slug);
  if (!o) notFound();
  const sp = parseSearchParams(await searchParams);
  const listings = await cachedOrganizerListings(o.orgId, o.slug, { page: sp.page });
  const t = await getTranslations('market');
  const req = await requestHost();
  const site = o.tenantSite && o.primaryHost ? originFor(req, o.primaryHost) : null;
  const path = req.kind === 'marketplace' ? `/o/${o.slug}` : `/organizers/${o.slug}`;
  // M1.4g: the organizer's blog, when it has published posts.
  const posts = await cachedEntries(o.orgId, 'post', 1);
  const tc = await getTranslations('cmsPublic');
  return (
    <div className="min-h-dvh bg-white">
      <SiteHeader />
      <main id="main" className="flex flex-col gap-8">
        <OrgHero orgId={o.orgId} eyebrow={t('organizer.eyebrow')} name={o.name} brandColor={o.brandColor}>
          {site ? (
            <a href={site} className="self-start text-body underline">
              {t('organizer.site')}
            </a>
          ) : null}
          {posts.items.length > 0 ? (
            <Link href={`${path}/blogs`} className="self-start text-body underline">
              {tc('blog')}
            </Link>
          ) : null}
        </OrgHero>
        <section
          aria-labelledby="upcoming-heading"
          className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 md:px-6"
        >
          <h2 id="upcoming-heading" className="text-[28px] font-normal tracking-[-0.03em]">
            {t('upcoming')}
          </h2>
          <ListingGrid
            items={listings.items}
            locale={locale}
            label={t('organizer.events', { org: o.name })}
            organizerHref={null}
            empty={{
              title: t('organizer.emptyTitle'),
              description: t('organizer.emptyDescription', { org: o.name }),
            }}
          />
          <Pagination path={path} params={{}} page={listings.page} pageCount={listings.pageCount} />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
