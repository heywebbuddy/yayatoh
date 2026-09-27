import type { Metadata } from 'next';
import { PublicEventView } from '@/components/public-event-view.tsx';
import { eventMetadata } from '@/server/event-metadata.ts';
import { pageLocale } from '@/server/locale.ts';

type Params = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ date?: string }>;
};

export async function generateMetadata({ params }: Pick<Params, 'params'>): Promise<Metadata> {
  const { locale, slug } = await params;
  return eventMetadata(locale, slug);
}

export default async function PublicEventPage({ params, searchParams }: Params) {
  const { locale, slug } = await params;
  const { date } = await searchParams;
  pageLocale(locale);
  return <PublicEventView locale={locale} slug={slug} date={date ?? null} />;
}
