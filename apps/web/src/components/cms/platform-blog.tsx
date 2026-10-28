import { type PlatformPostSummary, platformPost, platformPosts } from '@yayatoh/cms';
import { markdownToPlainText } from '@yayatoh/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { BlogIndex } from '@/components/blog/blog-index.tsx';
import { BlogPostPage, relatedOf } from '@/components/blog/blog-post.tsx';
import { type BlogCard, readingMinutes } from '@/components/blog/model.ts';
import { ShowcaseFooter } from '@/components/showcase/footer.tsx';
import { ShowcaseTopBar } from '@/components/showcase/top-bar.tsx';
import { requestHost } from '@/server/request-origin.ts';
import { apexOrigin, publicMetadata } from '@/server/seo.ts';

export const PLATFORM_BLOG_PAGE_SIZE = 12;

const toCard = (p: PlatformPostSummary): BlogCard => ({
  slug: p.slug,
  href: `/blogs/${p.slug}`,
  title: p.title,
  excerpt: p.excerpt,
  coverUrl: p.coverUrl,
  coverAlt: p.coverAlt ?? p.title,
  category: p.category,
  tags: p.tags,
  date: p.publishedAt,
  minutes: readingMinutes(p.words),
  author: p.authorName,
});

/** True when staff have published at least one platform post (the blog then comes from them). */
export async function hasPlatformPosts(): Promise<boolean> {
  return (await platformPosts(1)).total > 0;
}

/** The platform blog index (`/blogs`): posts staff write in the admin console. */
export async function PlatformBlogIndex({
  locale,
  page,
  q = '',
  category = '',
}: {
  locale: string;
  page: number;
  q?: string;
  category?: string;
}) {
  const t = await getTranslations('blogUi');
  const list = await platformPosts(200, 0);
  return (
    <BlogIndex
      lines={[t('platformLine1'), t('platformLine2')]}
      lede={t('platformLede')}
      cards={list.items.map(toCard)}
      path="/blogs"
      q={q}
      category={category}
      page={page}
      locale={locale}
      header={<ShowcaseTopBar />}
      footer={<ShowcaseFooter />}
    />
  );
}

/** One platform post; unknown or unpublished slugs return `null` so the caller can fall back. */
export async function PlatformPostView({ locale, slug }: { locale: string; slug: string }) {
  const post = await platformPost(slug);
  if (!post) notFound();
  const all = (await platformPosts(200, 0)).items.map(toCard);
  const card = toCard(post);
  return (
    <BlogPostPage
      post={{ ...card, excerpt: post.excerpt, body: post.body }}
      related={relatedOf(all, card)}
      locale={locale}
      blogHref="/blogs"
      header={<ShowcaseTopBar />}
      footer={<ShowcaseFooter />}
    />
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
