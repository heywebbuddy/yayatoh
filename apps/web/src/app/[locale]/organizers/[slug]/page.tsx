import { parseSearchParams, publicOrganizer } from '@yayatoh/marketplace';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ShowcaseFooter } from '@/components/showcase/footer.tsx';
import { OrgShowcase } from '@/components/showcase/org-showcase.tsx';
import { ShowcaseTopBar } from '@/components/showcase/top-bar.tsx';
import { Link } from '@/i18n/navigation.ts';
import { originFor } from '@/lib/hosts.ts';
import { cachedContactPage, cachedEntries } from '@/server/cms.ts';
import { pageLocale } from '@/server/locale.ts';
import { cachedListingTags, cachedOrganizerListings, cachedTenantListings } from '@/server/public-data.ts';
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
  const raw = await searchParams;
  const sp = parseSearchParams(raw);
  // U8: the tag filter (a known tag key only; anything else shows every event).
  const tags = await cachedListingTags(o.orgId);
  const wanted = typeof raw.tag === 'string' ? raw.tag.trim().toLowerCase() : '';
  const tag = tags.find((x) => x.key === wanted)?.key ?? null;
  const listings = tag
    ? await cachedTenantListings(o.orgId, sp.page, tag)
    : await cachedOrganizerListings(o.orgId, o.slug, { page: sp.page });
  const t = await getTranslations('market');
  const req = await requestHost();
  const site = o.tenantSite && o.primaryHost ? originFor(req, o.primaryHost) : null;
  const path = req.kind === 'marketplace' ? `/o/${o.slug}` : `/organizers/${o.slug}`;
  // M1.4g: the organizer's blog, when it has published posts.
  const posts = await cachedEntries(o.orgId, 'post', 1);
  // U10: the contact page, while the organizer has it on.
  const contact = await cachedContactPage(o.orgId);
  const tc = await getTranslations('cmsPublic');
  const links = (
    <>
      {site ? (
        <a href={site} className="text-body font-bold underline underline-offset-4">
          {t('organizer.site')}
        </a>
      ) : null}
      {posts.items.length > 0 ? (
        <Link href={`${path}/blogs`} className="text-body font-bold underline underline-offset-4">
          {tc('blog')}
        </Link>
      ) : null}
      {contact ? (
        <Link href={`${path}/contact`} className="text-body font-bold underline underline-offset-4">
          {tc('contact')}
        </Link>
      ) : null}
    </>
  );
  return (
    <OrgShowcase
      orgId={o.orgId}
      name={o.name}
      brandColor={o.brandColor}
      eyebrow={t('organizer.eyebrow')}
      lede={t('organizer.description', { org: o.name })}
      listings={listings.items}
      locale={locale}
      tags={tags}
      tag={tag}
      path={path}
      page={listings.page}
      pageCount={listings.pageCount}
      posts={posts.items}
      postsHref={`${path}/blogs`}
      links={links}
      emptyTitle={t('organizer.emptyTitle')}
      emptyDescription={t('organizer.emptyDescription', { org: o.name })}
      header={<ShowcaseTopBar />}
      footer={<ShowcaseFooter />}
    />
  );
}
