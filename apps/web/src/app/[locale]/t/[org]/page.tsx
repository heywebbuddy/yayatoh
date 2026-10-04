import { publicOrganizerById } from '@yayatoh/marketplace';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { TenantHeader } from '@/components/cms/tenant-header.tsx';
import { ListingGrid } from '@/components/marketplace/listing-grid.tsx';
import { OrgHero } from '@/components/marketplace/org-hero.tsx';
import { Pagination } from '@/components/marketplace/pagination.tsx';
import { SiteFooter } from '@/components/marketplace/site-chrome.tsx';
import { TagFilter } from '@/components/marketplace/tag-filter.tsx';
import { pageLocale } from '@/server/locale.ts';
import { cachedListingTags, cachedTenantListings } from '@/server/public-data.ts';
import { requestHost } from '@/server/request-origin.ts';
import { publicMetadata } from '@/server/seo.ts';
import { tenantOrgParam } from '@/server/tenant-site.ts';

type Props = {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ page?: string; tag?: string }>;
};
const pageOf = (raw?: string) => Math.min(500, Math.max(1, Number.parseInt(raw ?? '1', 10) || 1));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, org } = await params;
  const orgId = tenantOrgParam(org);
  const o = orgId ? await publicOrganizerById(orgId) : null;
  if (!o) return {};
  const t = await getTranslations({ locale, namespace: 'market' });
  const req = await requestHost();
  return publicMetadata({
    req,
    locale,
    canonicalOrigin: req.origin,
    path: '/',
    title: o.name,
    description: t('tenant.description', { org: o.name }),
    image: `${req.origin}/api/og/org/${o.slug}`,
  });
}

/** A tenant site's home (`{org host}/`, rewritten here by the proxy): the org's upcoming events. */
export default async function TenantHome({ params, searchParams }: Props) {
  const { locale, org } = await params;
  pageLocale(locale);
  const orgId = tenantOrgParam(org);
  const o = orgId ? await publicOrganizerById(orgId) : null;
  if (!orgId || !o) notFound();
  const sp = await searchParams;
  const page = pageOf(sp.page);
  // U8: the tag filter (a known tag key only; anything else shows every event).
  const tags = await cachedListingTags(orgId);
  const tag = tags.find((x) => x.key === sp.tag?.trim().toLowerCase())?.key ?? null;
  const listings = await cachedTenantListings(orgId, page, tag);
  const t = await getTranslations('market');
  return (
    <div className="min-h-dvh bg-surface">
      <TenantHeader org={o} current="/" />
      <main id="main" className="flex flex-col gap-8">
        <OrgHero orgId={orgId} eyebrow={t('tenant.eyebrow')} name={o.name} brandColor={o.brandColor} />
        <section
          aria-labelledby="upcoming-heading"
          className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 md:px-6"
        >
          <h2 id="upcoming-heading" className="text-[28px] font-extrabold tracking-[-0.03em]">
            {t('upcoming')}
          </h2>
          <TagFilter tags={tags} current={tag} path="/" />
          <ListingGrid
            items={listings.items}
            locale={locale}
            label={t('upcoming')}
            organizerHref={null}
            empty={{
              title: t('tenant.emptyTitle'),
              description: t('tenant.emptyDescription', { org: o.name }),
            }}
          />
          <Pagination
            path="/"
            params={{ tag: tag ?? undefined }}
            page={page}
            pageCount={listings.pageCount}
          />
        </section>
      </main>
      <SiteFooter>
        {o.poweredByVisible ? (
          <a href="https://yayatoh.com" className="self-start text-caption text-ink-2 underline">
            {t('poweredBy')}
          </a>
        ) : null}
      </SiteFooter>
    </div>
  );
}
