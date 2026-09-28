import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EntryView, entryMetadata } from '@/components/cms/public-views.tsx';
import { organizerContentSite } from '@/server/cms.ts';
import { pageLocale } from '@/server/locale.ts';
import { requestHost } from '@/server/request-origin.ts';

type Props = { params: Promise<{ locale: string; slug: string; page: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug, page } = await params;
  return entryMetadata(await organizerContentSite(await requestHost(), slug), locale, 'page', page);
}

/** An organizer's page on the marketplace (`/o/{slug}/…`, rewritten here). */
export default async function OrganizerEntry({ params }: Props) {
  const { locale, slug, page } = await params;
  pageLocale(locale);
  const site = await organizerContentSite(await requestHost(), slug);
  if (!site) notFound();
  return <EntryView site={site} locale={locale} kind="page" slug={page} />;
}
