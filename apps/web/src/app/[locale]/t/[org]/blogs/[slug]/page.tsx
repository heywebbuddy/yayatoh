import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EntryView, entryMetadata } from '@/components/cms/public-views.tsx';
import { tenantContentSite } from '@/server/cms.ts';
import { pageLocale } from '@/server/locale.ts';
import { tenantOrgParam } from '@/server/tenant-site.ts';

type Props = { params: Promise<{ locale: string; org: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, org, slug } = await params;
  return entryMetadata(await tenantContentSite(tenantOrgParam(org)), locale, 'post', slug);
}

/** A blog post on its org's tenant site (rewritten here by the proxy). */
export default async function TenantEntry({ params }: Props) {
  const { locale, org, slug } = await params;
  pageLocale(locale);
  const site = await tenantContentSite(tenantOrgParam(org));
  if (!site) notFound();
  return <EntryView site={site} locale={locale} kind="post" slug={slug} />;
}
