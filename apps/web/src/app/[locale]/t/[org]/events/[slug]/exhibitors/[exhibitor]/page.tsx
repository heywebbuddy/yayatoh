import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PublicExhibitorView } from '@/components/public-exhibitor-view.tsx';
import { pageLocale } from '@/server/locale.ts';
import { tenantOrgParam } from '@/server/tenant-site.ts';

type Params = { params: Promise<{ locale: string; org: string; slug: string; exhibitor: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'publicEvent' });
  return { title: t('exhibitorPageTitle') };
}

/** A exhibitor page on its org's tenant site (the proxy rewrites `{host}/events/{slug}/exhibitors/{id}`). */
export default async function TenantExhibitorPage({ params }: Params) {
  const { locale, org, slug, exhibitor } = await params;
  pageLocale(locale);
  const orgId = tenantOrgParam(org);
  if (!orgId) notFound();
  return <PublicExhibitorView slug={slug} exhibitorId={exhibitor} orgId={orgId} />;
}
