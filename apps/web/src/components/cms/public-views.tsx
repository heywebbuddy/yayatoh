import { markdownToPlainText } from '@yayatoh/contracts';
import type { PublicOrganizer } from '@yayatoh/marketplace';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { OrgBlogIndex, OrgPostView } from '@/components/blog/org-blog.tsx';
import { Markdown } from '@/components/markdown.tsx';
import { SiteFooter } from '@/components/marketplace/site-chrome.tsx';
import { ShowcaseTopBar } from '@/components/showcase/top-bar.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatDate } from '@/lib/format.ts';
import { blogPostingJsonLd, jsonLdScript } from '@/lib/seo/jsonld.ts';
import { cachedContactPage, cachedEntry, contentHome, entryPath } from '@/server/cms.ts';
import { requestHost } from '@/server/request-origin.ts';
import { publicMetadata } from '@/server/seo.ts';
import { TenantHeader } from './tenant-header.tsx';

/**
 * Where CMS content is being shown: on the org's tenant site (root paths), on its marketplace
 * organizer page (`base` = `/o/{slug}` or `/organizers/{slug}`), or as the marketplace's own
 * pages (`/blogs`, `/pages`: the configured content org).
 */
export interface ContentSite {
  readonly org: PublicOrganizer;
  readonly variant: 'tenant' | 'organizer' | 'marketplace';
  readonly base: string;
}

export async function Chrome({
  site,
  current,
  children,
}: {
  site: ContentSite;
  current?: string;
  children: ReactNode;
}) {
  const t = await getTranslations('cmsPublic');
  // U10: the organizer's contact page, while it is on.
  const contact = site.variant === 'organizer' ? await cachedContactPage(site.org.orgId) : null;
  return (
    <div data-surface="showcase" className="min-h-dvh bg-page">
      {site.variant === 'tenant' ? <TenantHeader org={site.org} current={current} /> : <ShowcaseTopBar />}
      {site.variant === 'organizer' ? (
        <nav
          aria-label={t('organizerNav', { org: site.org.name })}
          className="mx-auto w-full max-w-6xl px-4 md:px-6"
        >
          <ul className="flex list-none flex-wrap gap-4 p-0 text-body">
            <li>
              <Link href={site.base} className="inline-flex min-h-10 items-center underline">
                {site.org.name}
              </Link>
            </li>
            <li>
              <Link
                href={`${site.base}/blogs`}
                aria-current={current === '/blogs' ? 'page' : undefined}
                className="inline-flex min-h-10 items-center underline"
              >
                {t('blog')}
              </Link>
            </li>
            {contact ? (
              <li>
                <Link
                  href={`${site.base}/contact`}
                  aria-current={current === '/contact' ? 'page' : undefined}
                  className="inline-flex min-h-10 items-center underline"
                >
                  {t('contact')}
                </Link>
              </li>
            ) : null}
          </ul>
        </nav>
      ) : null}
      <main id="main" className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-6 md:px-6">
        {children}
      </main>
      <SiteFooter>
        {site.org.poweredByVisible && site.variant === 'tenant' ? (
          <a href="https://yayatoh.com" className="self-start text-caption text-ink-2 underline">
            {t('poweredBy')}
          </a>
        ) : null}
      </SiteFooter>
    </div>
  );
}

/** Post dates in the org's timezone (a post belongs to no event). */
const _fmt = (d: Date, locale: string, timeZone: string) =>
  formatDate(
    d.toISOString(),
    { locale, currency: 'USD', timeZone },
    { year: 'numeric', month: 'long', day: 'numeric' },
  );

/** The blog index: published posts, newest first, paginated. */
export async function BlogIndexView({
  site,
  locale,
  page,
  q = '',
  category = '',
}: {
  site: ContentSite;
  locale: string;
  page: number;
  q?: string;
  category?: string;
}) {
  return <OrgBlogIndex site={site} locale={locale} page={page} q={q} category={category} />;
}

/** One published page or post (drafts, archived and unknown slugs are a 404). */
export async function EntryView({
  site,
  locale,
  kind,
  slug,
}: {
  site: ContentSite;
  locale: string;
  kind: 'page' | 'post';
  slug: string;
}) {
  const entry = await cachedEntry(site.org.orgId, kind, slug);
  if (!entry) notFound();
  const _t = await getTranslations('cmsPublic');
  const req = await requestHost();
  const home = contentHome(req, site.org);
  const url = `${home.origin}${home.base}${entryPath(kind, slug)}`;
  const ld =
    kind === 'post'
      ? blogPostingJsonLd({
          title: entry.title,
          description: entry.seoDescription ?? entry.excerpt,
          url,
          image: `${req.origin}/api/og/org/${site.org.slug}`,
          publishedAt: entry.publishedAt,
          updatedAt: entry.updatedAt,
          authorName: entry.authorName,
          publisher: { name: site.org.name, url: `${home.origin}${home.base || '/'}` },
        })
      : null;
  if (kind === 'post')
    return (
      <>
        {ld ? (
          <script
            type="application/ld+json"
            // JSON-LD must be inline; jsonLdScript escapes `<` so the text cannot close the script.
            dangerouslySetInnerHTML={{ __html: jsonLdScript(ld) }}
          />
        ) : null}
        <OrgPostView site={site} locale={locale} entry={entry} />
      </>
    );
  return (
    <Chrome site={site} current={entryPath(kind, slug)}>
      <article className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="break-words text-[40px] leading-tight font-extrabold tracking-[-0.03em]">
            {entry.title}
          </h1>
          {entry.excerpt ? <p className="text-[17px] leading-7 text-ink-2">{entry.excerpt}</p> : null}
        </header>
        <Markdown source={entry.body} />
      </article>
    </Chrome>
  );
}

/** Metadata for a CMS page: canonical on the content's home, hreflang, og:image. */
export async function entryMetadata(
  site: ContentSite | null,
  locale: string,
  kind: 'page' | 'post',
  slug: string,
): Promise<Metadata> {
  if (!site) return {};
  const entry = await cachedEntry(site.org.orgId, kind, slug);
  if (!entry) return {};
  const req = await requestHost();
  const home = contentHome(req, site.org);
  const description =
    entry.seoDescription ?? entry.excerpt ?? (markdownToPlainText(entry.body).slice(0, 160) || null);
  const meta = publicMetadata({
    req,
    locale,
    canonicalOrigin: home.origin,
    path: `${home.base}${entryPath(kind, slug)}`,
    title: entry.seoTitle ?? entry.title,
    description,
    image: `${req.origin}/api/og/org/${site.org.slug}`,
  });
  return kind === 'post' ? { ...meta, openGraph: { ...meta.openGraph, type: 'article' } } : meta;
}

export async function blogMetadata(
  site: ContentSite | null,
  locale: string,
  page: number,
): Promise<Metadata> {
  if (!site) return {};
  const t = await getTranslations({ locale, namespace: 'cmsPublic' });
  const req = await requestHost();
  const home = contentHome(req, site.org);
  return publicMetadata({
    req,
    locale,
    canonicalOrigin: home.origin,
    path: `${home.base}/blogs`,
    title: t('blogTitle', { org: site.org.name }),
    description: t('blogDescription', { org: site.org.name }),
    image: `${req.origin}/api/og/org/${site.org.slug}`,
    // Later pages of the index are reachable, not indexed (as filtered /events views).
    index: page === 1,
  });
}
