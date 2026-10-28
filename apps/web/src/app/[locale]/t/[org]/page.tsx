import { publicOrganizerById } from '@yayatoh/marketplace';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { TenantHeader } from '@/components/cms/tenant-header.tsx';
import { SiteFooter } from '@/components/marketplace/site-chrome.tsx';
import { OrgShowcase } from '@/components/showcase/org-showcase.tsx';
import { cachedEntries } from '@/server/cms.ts';
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
  const posts = await cachedEntries(orgId, 'post', 1);
  return (
    <OrgShowcase
      orgId={orgId}
      name={o.name}
      brandColor={o.brandColor}
      eyebrow={t('tenant.eyebrow')}
      lede={t('tenant.description', { org: o.name })}
      listings={listings.items}
      locale={locale}
      tags={tags}
      tag={tag}
      path="/"
      page={page}
      pageCount={listings.pageCount}
      posts={posts.items}
      postsHref="/blogs"
      emptyTitle={t('tenant.emptyTitle')}
      emptyDescription={t('tenant.emptyDescription', { org: o.name })}
      header={<TenantHeader org={o} current="/" />}
      footer={
        <SiteFooter>
          {o.poweredByVisible ? (
            <a href="https://yayatoh.com" className="self-start text-caption text-ink-2 underline">
              {t('poweredBy')}
            </a>
          ) : null}
        </SiteFooter>
      }
    />
  );
}
