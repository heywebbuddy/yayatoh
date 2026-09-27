import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { publicSiteSettings } from '@yayatoh/marketplace';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmbedResizer } from '@/components/embed-resizer.tsx';
import { PublicEventView } from '@/components/public-event-view.tsx';

type Params = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, slug } = await params;
  const pub = await publicEventBySlug(slug);
  const t = await getTranslations({ locale, namespace: 'widget' });
  return { title: pub ? t('title', { event: pub.name }) : t('fallbackTitle'), robots: { index: false } };
}

/**
 * The embeddable ticket widget (M1.11c), loaded in an iframe by the organizer's snippet. Only
 * origins the organizer allowed may frame it (proxy.ts sends CSP frame-ancestors).
 */
export default async function EmbedPage({ params }: Params) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const target = await checkoutTarget(slug);
  if (!target) notFound();
  const settings = await publicSiteSettings(target.orgId);
  return (
    <>
      <PublicEventView locale={locale} slug={slug} embedded />
      <EmbedResizer slug={slug} allowedOrigins={settings.embedOrigins} />
    </>
  );
}
