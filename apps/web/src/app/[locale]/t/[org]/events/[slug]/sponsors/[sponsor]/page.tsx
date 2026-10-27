import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PublicSponsorView } from '@/components/public-sponsor-view.tsx';
import { pageLocale } from '@/server/locale.ts';
import { tenantOrgParam } from '@/server/tenant-site.ts';

type Params = { params: Promise<{ locale: string; org: string; slug: string; sponsor: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'publicEvent' });
  return { title: t('sponsorPageTitle') };
}

/** A sponsor page on its org's tenant site (the proxy rewrites `{host}/events/{slug}/sponsors/{id}`). */
export default async function TenantSponsorPage({ params }: Params) {
  const { locale, org, slug, sponsor } = await params;
  pageLocale(locale);
  const orgId = tenantOrgParam(org);
  if (!orgId) notFound();
  return <PublicSponsorView slug={slug} sponsorId={sponsor} orgId={orgId} />;
}
