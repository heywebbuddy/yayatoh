import { CARD_SOURCES } from '@yayatoh/donations';
import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { pageLocale } from '@/server/locale.ts';
import { CardPage } from './card-page.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('savedCard');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

type Params = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ src?: string; saved?: string; removed?: string }>;
};

/**
 * The event's card page (M4.8e): the QR code at check-in (`?src=checkin`), on the table
 * (`?src=table`, the default) and the checkout box (`?src=checkout`) open it.
 */
export default async function EventCardPage({ params, searchParams }: Params) {
  const { locale, slug } = await params;
  pageLocale(locale);
  const target = await checkoutTarget(slug);
  const ev = target ? await publicEventBySlug(slug) : null;
  if (!target || !ev) notFound();
  const sp = await searchParams;
  const source = (CARD_SOURCES as readonly string[]).includes(sp.src ?? '')
    ? (sp.src as (typeof CARD_SOURCES)[number])
    : 'table';
  return (
    <CardPage
      orgId={target.orgId}
      eventId={target.eventId}
      eventName={ev.name}
      organizer={ev.organizerName}
      slug={slug}
      target={{ slug, rsvpToken: null, source: source === 'party' ? 'table' : source }}
      saved={sp.saved === '1'}
      removed={sp.removed === '1'}
    />
  );
}
