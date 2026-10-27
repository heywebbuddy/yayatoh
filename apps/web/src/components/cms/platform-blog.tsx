import { platformPost, platformPosts } from '@yayatoh/cms';
import { markdownToPlainText } from '@yayatoh/contracts';
import { EmptyState } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Markdown } from '@/components/markdown.tsx';
import { Pagination } from '@/components/marketplace/pagination.tsx';
import { SiteFooter, SiteHeader } from '@/components/marketplace/site-chrome.tsx';
import { PageHero } from '@/components/showcase/page-hero.tsx';
import { Link } from '@/i18n/navigation.ts';
import { requestHost } from '@/server/request-origin.ts';
import { apexOrigin, publicMetadata } from '@/server/seo.ts';

export const PLATFORM_BLOG_PAGE_SIZE = 12;

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-6 md:px-6">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

const day = (d: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(d);

/** True when staff have published at least one platform post (the blog then comes from them). */
export async function hasPlatformPosts(): Promise<boolean> {
  return (await platformPosts(1)).total > 0;
}

/** The platform blog index (`/blogs`): posts staff write in the admin console. */
export async function PlatformBlogIndex({ locale, page }: { locale: string; page: number }) {
  const t = await getTranslations('platformBlog');
  const tp = await getTranslations('pages');
  const list = await platformPosts(PLATFORM_BLOG_PAGE_SIZE, (page - 1) * PLATFORM_BLOG_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(list.total / PLATFORM_BLOG_PAGE_SIZE));
  return (
    <Frame>
      <PageHero eyebrow={tp('eyebrow.blog')} title={t('title')} />
      {list.items.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <ul
          aria-label={t('posts')}
          className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2 lg:grid-cols-3"
        >
          {list.items.map((p) => (
            <li key={p.slug}>
              <article className="flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface transition duration-300 hover:-translate-y-1 hover:border-ember motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                {p.coverUrl ? (
                  <img src={p.coverUrl} alt="" loading="lazy" className="aspect-[16/9] w-full object-cover" />
                ) : null}
                <div className="flex flex-col gap-2 p-5">
                  <h2 className="break-words text-[24px] font-extrabold tracking-[-0.02em]">
                    <Link href={`/blogs/${p.slug}`} className="underline-offset-4 hover:underline">
                      {p.title}
                    </Link>
                  </h2>
                  <p className="text-caption text-ink-2">
                    <time dateTime={p.publishedAt.toISOString()}>{day(p.publishedAt, locale)}</time>
                  </p>
                  {p.excerpt ? <p className="text-body text-ink-2">{p.excerpt}</p> : null}
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
      <Pagination path="/blogs" params={{}} page={page} pageCount={pageCount} />
    </Frame>
  );
}

/** One platform post; unknown or unpublished slugs return `null` so the caller can fall back. */
export async function PlatformPostView({ locale, slug }: { locale: string; slug: string }) {
  const post = await platformPost(slug);
  if (!post) notFound();
  const t = await getTranslations('platformBlog');
  return (
    <Frame>
      <article className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <Link href="/blogs" className="self-start text-caption text-ink-2 underline">
            {t('all')}
          </Link>
          <h1 className="break-words text-[40px] leading-tight font-extrabold tracking-[-0.03em]">
            {post.title}
          </h1>
          <p className="text-caption text-ink-2">
            <time dateTime={post.publishedAt.toISOString()}>{day(post.publishedAt, locale)}</time>
            {post.authorName ? ` · ${t('by', { name: post.authorName })}` : null}
          </p>
          {post.excerpt ? <p className="text-[17px] leading-7 text-ink-2">{post.excerpt}</p> : null}
        </header>
        {post.coverUrl ? (
          <img src={post.coverUrl} alt="" className="w-full rounded-card border border-line object-cover" />
        ) : null}
        <Markdown source={post.body} />
      </article>
    </Frame>
  );
}

export async function platformPostMetadata(locale: string, slug: string): Promise<Metadata> {
  const post = await platformPost(slug);
  if (!post) return {};
  const req = await requestHost();
  const meta = publicMetadata({
    req,
    locale,
    canonicalOrigin: apexOrigin(req),
    path: `/blogs/${slug}`,
    title: post.seoTitle ?? post.title,
    description:
      post.seoDescription ?? (post.excerpt || markdownToPlainText(post.body).slice(0, 160) || null),
    image: post.coverUrl ? `${req.origin}${post.coverUrl}` : `${req.origin}/api/og/home`,
  });
  return { ...meta, openGraph: { ...meta.openGraph, type: 'article' } };
}

export async function platformBlogMetadata(locale: string): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'platformBlog' });
  const req = await requestHost();
  return publicMetadata({
    req,
    locale,
    canonicalOrigin: apexOrigin(req),
    path: '/blogs',
    title: t('title'),
    description: t('description'),
    image: `${req.origin}/api/og/home`,
  });
}
