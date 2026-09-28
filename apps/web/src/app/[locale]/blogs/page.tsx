import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BlogIndexView, blogMetadata } from '@/components/cms/public-views.tsx';
import { marketplaceContentSite } from '@/server/cms.ts';
import { pageLocale } from '@/server/locale.ts';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ page?: string }> };
const pageOf = (raw?: string) => Math.min(500, Math.max(1, Number.parseInt(raw ?? '1', 10) || 1));

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  return blogMetadata(await marketplaceContentSite(), locale, pageOf((await searchParams).page));
}

/** The marketplace blog (`yayatoh.com/blogs`, legacy Voyager path): the content org's posts. */
export default async function MarketplaceBlog({ params, searchParams }: Props) {
  const { locale } = await params;
  pageLocale(locale);
  const site = await marketplaceContentSite();
  if (!site) notFound();
  return <BlogIndexView site={site} locale={locale} page={pageOf((await searchParams).page)} />;
}
