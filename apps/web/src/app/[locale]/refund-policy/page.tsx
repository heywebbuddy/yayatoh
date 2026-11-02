import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import {
  loadPlatformPage,
  PlatformPageView,
  platformPageMetadata,
} from '@/components/site/platform-page.tsx';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const page = await loadPlatformPage('refund-policy', locale);
  return page ? platformPageMetadata(page) : {};
}

/** Edited in the admin console ("Site content" → Pages). */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const page = await loadPlatformPage('refund-policy', locale);
  if (!page) notFound();
  return <PlatformPageView page={page} locale={locale} />;
}
