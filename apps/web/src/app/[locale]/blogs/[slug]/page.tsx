import { platformPost } from '@yayatoh/cms';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PlatformPostView, platformPostMetadata } from '@/components/cms/platform-blog.tsx';
import { EntryView, entryMetadata } from '@/components/cms/public-views.tsx';
import { marketplaceContentSite } from '@/server/cms.ts';
import { pageLocale } from '@/server/locale.ts';

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (await platformPost(slug)) return platformPostMetadata(locale, slug);
  return entryMetadata(await marketplaceContentSite(), locale, 'post', slug);
}

/** A marketplace blog post (legacy Voyager path on yayatoh.com): the content org's. */
export default async function MarketplaceEntry({ params }: Props) {
  const { locale, slug } = await params;
  pageLocale(locale);
  if (await platformPost(slug)) return <PlatformPostView locale={locale} slug={slug} />;
  const site = await marketplaceContentSite();
  if (!site) notFound();
  return <EntryView site={site} locale={locale} kind="post" slug={slug} />;
}
