import type { PublicEntrySummaryDto } from '@yayatoh/cms';
import { publicCovers } from '@yayatoh/media';
import { brandPalette } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { BrandSection } from '@/components/brand-styled.tsx';
import type { ContentSite } from '@/components/cms/public-views.tsx';
import { TenantHeader } from '@/components/cms/tenant-header.tsx';
import { SiteFooter } from '@/components/marketplace/site-chrome.tsx';
import { ShowcaseFooter } from '@/components/showcase/footer.tsx';
import { PosterCard } from '@/components/showcase/poster-card.tsx';
import { ShowcaseTopBar } from '@/components/showcase/top-bar.tsx';
import { Link } from '@/i18n/navigation.ts';
import { cachedPosts, entryPath } from '@/server/cms.ts';
import { cachedTenantListings } from '@/server/public-data.ts';
import { BlogIndex } from './blog-index.tsx';
import { BlogPostPage, relatedOf } from './blog-post.tsx';
import { type BlogCard, excerptOf, readingMinutes, wordCount } from './model.ts';

/** The cover of an organization's post is its own upload (`/api/blog-cover/{org}/{id}`). */
export function orgCard(
  site: { readonly org: { readonly orgId: string }; readonly base: string },
  p: PublicEntrySummaryDto,
): BlogCard {
  return {
    slug: p.slug,
    href: `${site.base}${entryPath('post', p.slug)}`,
    title: p.title,
    excerpt: excerptOf(p.excerpt, p.body),
    coverUrl: p.coverAssetId ? `/api/blog-cover/${site.org.orgId}/${p.coverAssetId}` : null,
    coverAlt: p.coverAlt ?? p.title,
    category: p.category,
    tags: p.tags,
    date: p.publishedAt,
    minutes: readingMinutes(wordCount(p.body)),
    author: p.authorName,
  };
}

function headerOf(site: ContentSite) {
  return site.variant === 'tenant' ? <TenantHeader org={site.org} current="/blogs" /> : <ShowcaseTopBar />;
}

function footerOf(site: ContentSite, poweredBy: string) {
  if (site.variant !== 'tenant') return <ShowcaseFooter />;
  return (
    <SiteFooter>
      {site.org.poweredByVisible ? (
        <a href="https://yayatoh.com" className="self-start text-caption text-ink-2 underline">
          {poweredBy}
        </a>
      ) : null}
    </SiteFooter>
  );
}

/** An organization's blog index in the showcase look (tenant site, organizer page, content org). */
export async function OrgBlogIndex({
  site,
  locale,
  q,
  category,
  page,
}: {
  site: ContentSite;
  locale: string;
  q: string;
  category: string;
  page: number;
}) {
  const t = await getTranslations('blogUi');
  const tm = await getTranslations('market');
  const cards = (await cachedPosts(site.org.orgId)).map((p) => orgCard(site, p));
  const brand = site.org.brandColor ? brandPalette(site.org.brandColor) : null;
  return (
    <BlogIndex
      title={site.org.name}
      lede={t('orgLede', { org: site.org.name })}
      cards={cards}
      path={`${site.base}/blogs`}
      q={q}
      category={category}
      page={page}
      locale={locale}
      header={headerOf(site)}
      footer={footerOf(site, tm('poweredBy'))}
      glow={
        <BrandSection
          aria-hidden="true"
          brand={brand ? { background: brand.background, text: brand.text } : null}
          className="pointer-events-none absolute -end-24 -top-24 -z-10 size-96 rounded-full bg-ember opacity-40 blur-3xl animate-breathe motion-reduce:animate-none"
        />
      }
    />
  );
}

/** One organization post: the typeset article, plus the org's upcoming events beside the related posts. */
export async function OrgPostView({
  site,
  locale,
  entry,
}: {
  site: ContentSite;
  locale: string;
  entry: PublicEntrySummaryDto & { body: string };
}) {
  const t = await getTranslations('blogUi');
  const tm = await getTranslations('market');
  const all = (await cachedPosts(site.org.orgId)).map((p) => orgCard(site, p));
  const card = orgCard(site, entry);
  const listings =
    site.variant === 'marketplace'
      ? []
      : (await cachedTenantListings(site.org.orgId, 1, null)).items.slice(0, 3);
  const covers = await publicCovers(listings.map((l) => l.slug));
  return (
    <BlogPostPage
      post={{ ...card, body: entry.body }}
      related={relatedOf(all, card)}
      locale={locale}
      blogHref={`${site.base}/blogs`}
      header={headerOf(site)}
      footer={footerOf(site, tm('poweredBy'))}
      aside={
        listings.length > 0 ? (
          <section
            aria-labelledby="org-events-h"
            className="flex flex-col gap-6 rounded-[40px] border border-line bg-surface p-6 md:p-10"
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2
                id="org-events-h"
                className="m-0 font-display text-[clamp(1.5rem,3.4vw,2.4rem)] leading-none font-black tracking-[-0.03em] text-ink uppercase"
              >
                {t('orgEventsTitle', { org: site.org.name })}
              </h2>
              <Link
                href={site.variant === 'tenant' ? '/' : site.base || '/events'}
                className="text-body font-bold underline underline-offset-4"
              >
                {t('orgEventsAll')}
              </Link>
            </div>
            <ul className="no-scrollbar m-0 flex list-none gap-4 overflow-x-auto p-0 pb-2">
              {listings.map((l) => (
                <li key={l.slug} className="shrink-0">
                  <PosterCard listing={l} cover={covers.get(l.slug) ?? null} locale={locale} />
                </li>
              ))}
            </ul>
          </section>
        ) : null
      }
    />
  );
}
