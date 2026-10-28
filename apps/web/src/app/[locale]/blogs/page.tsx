import type { Metadata } from 'next';
import {
  hasPlatformPosts,
  PlatformBlogIndex,
  platformBlogMetadata,
} from '@/components/cms/platform-blog.tsx';
import { BlogIndexView, blogMetadata } from '@/components/cms/public-views.tsx';
import { marketplaceContentSite } from '@/server/cms.ts';
import { pageLocale } from '@/server/locale.ts';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; q?: string; category?: string }>;
};
const pageOf = (raw?: string) => Math.min(500, Math.max(1, Number.parseInt(raw ?? '1', 10) || 1));

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  if ((await hasPlatformPosts()) || !(await marketplaceContentSite())) return platformBlogMetadata(locale);
  return blogMetadata(await marketplaceContentSite(), locale, pageOf((await searchParams).page));
}

/** The marketplace blog (`yayatoh.com/blogs`, legacy Voyager path): the content org's posts. */
export default async function MarketplaceBlog({ params, searchParams }: Props) {
  const { locale } = await params;
  pageLocale(locale);
  // Posts staff write in the admin console come first; the content org's blog is the fallback.
  if (await hasPlatformPosts())
    return (
      <PlatformBlogIndex
        locale={locale}
        page={pageOf((await searchParams).page)}
        q={((await searchParams).q ?? '').slice(0, 80)}
        category={((await searchParams).category ?? '').slice(0, 40)}
      />
    );
  const site = await marketplaceContentSite();
  // No posts yet and no content org: the (empty) platform blog, never a 404.
  if (!site) return <PlatformBlogIndex locale={locale} page={1} />;
  return (
    <BlogIndexView
      site={site}
      locale={locale}
      page={pageOf((await searchParams).page)}
      q={((await searchParams).q ?? '').slice(0, 80)}
      category={((await searchParams).category ?? '').slice(0, 40)}
    />
  );
}
