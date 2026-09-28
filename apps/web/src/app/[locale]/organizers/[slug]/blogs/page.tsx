import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BlogIndexView, blogMetadata } from '@/components/cms/public-views.tsx';
import { organizerContentSite } from '@/server/cms.ts';
import { pageLocale } from '@/server/locale.ts';
import { requestHost } from '@/server/request-origin.ts';

type Props = { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<{ page?: string }> };
const pageOf = (raw?: string) => Math.min(500, Math.max(1, Number.parseInt(raw ?? '1', 10) || 1));

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const site = await organizerContentSite(await requestHost(), slug);
  return blogMetadata(site, locale, pageOf((await searchParams).page));
}

/** An organizer's blog on the marketplace (`yayatoh.com/o/{slug}/blogs`, rewritten here). */
export default async function OrganizerBlog({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  pageLocale(locale);
  const site = await organizerContentSite(await requestHost(), slug);
  if (!site) notFound();
  return <BlogIndexView site={site} locale={locale} page={pageOf((await searchParams).page)} />;
}
