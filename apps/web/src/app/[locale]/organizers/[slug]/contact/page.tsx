import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ContactView, contactMetadata } from '@/components/cms/contact-view.tsx';
import { organizerContentSite } from '@/server/cms.ts';
import { pageLocale } from '@/server/locale.ts';
import { requestHost } from '@/server/request-origin.ts';

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  return contactMetadata(await organizerContentSite(await requestHost(), slug), locale);
}

/** U10: an organizer's contact page on the marketplace (`yayatoh.com/o/{slug}/contact`, rewritten here). */
export default async function OrganizerContact({ params }: Props) {
  const { locale, slug } = await params;
  pageLocale(locale);
  const site = await organizerContentSite(await requestHost(), slug);
  if (!site) notFound();
  return <ContactView site={site} />;
}
