import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EntryView, entryMetadata } from '@/components/cms/public-views.tsx';
import {
  loadPlatformPage,
  PlatformPageView,
  platformPageMetadata,
} from '@/components/site/platform-page.tsx';
import { marketplaceContentSite } from '@/server/cms.ts';
import { pageLocale } from '@/server/locale.ts';

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const own = await loadPlatformPage(slug, locale);
  if (own) return platformPageMetadata(own);
  return entryMetadata(await marketplaceContentSite(), locale, 'page', slug);
}

/** A marketplace page (legacy Voyager path on yayatoh.com): the content org's. */
export default async function MarketplaceEntry({ params }: Props) {
  const { locale, slug } = await params;
  pageLocale(locale);
  // A page staff edit under Site content comes first; then the content organization's own pages.
  const own = await loadPlatformPage(slug, locale);
  if (own) return <PlatformPageView page={own} locale={locale} />;
  const site = await marketplaceContentSite();
  if (!site) notFound();
  return <EntryView site={site} locale={locale} kind="page" slug={slug} />;
}
