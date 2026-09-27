import type { Metadata } from 'next';
import { PublicEventView } from '@/components/public-event-view.tsx';
import { eventMetadata } from '@/server/event-metadata.ts';
import { pageLocale } from '@/server/locale.ts';

type Params = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, slug } = await params;
  return eventMetadata(locale, slug);
}

export default async function PublicEventPage({ params }: Params) {
  const { locale, slug } = await params;
  pageLocale(locale);
  return <PublicEventView locale={locale} slug={slug} />;
}
