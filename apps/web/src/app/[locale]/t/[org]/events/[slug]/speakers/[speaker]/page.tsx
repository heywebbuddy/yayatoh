import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PublicSpeakerView } from '@/components/public-speaker-view.tsx';
import { pageLocale } from '@/server/locale.ts';
import { tenantOrgParam } from '@/server/tenant-site.ts';

type Params = { params: Promise<{ locale: string; org: string; slug: string; speaker: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'publicEvent' });
  return { title: t('speakerPageTitle') };
}

/** A speaker page on its org's tenant site (the proxy rewrites `{host}/events/{slug}/speakers/{id}`). */
export default async function TenantSpeakerPage({ params }: Params) {
  const { locale, org, slug, speaker } = await params;
  pageLocale(locale);
  const orgId = tenantOrgParam(org);
  if (!orgId) notFound();
  return <PublicSpeakerView locale={locale} slug={slug} speakerId={speaker} orgId={orgId} />;
}
