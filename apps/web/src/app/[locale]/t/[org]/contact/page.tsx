import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ContactView, contactMetadata } from '@/components/cms/contact-view.tsx';
import { tenantContentSite } from '@/server/cms.ts';
import { pageLocale } from '@/server/locale.ts';
import { tenantOrgParam } from '@/server/tenant-site.ts';

type Props = { params: Promise<{ locale: string; org: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, org } = await params;
  return contactMetadata(await tenantContentSite(tenantOrgParam(org)), locale);
}

/** U10: the contact page on its org's tenant site (`/contact`, rewritten here by the proxy). */
export default async function TenantContact({ params }: Props) {
  const { locale, org } = await params;
  pageLocale(locale);
  const site = await tenantContentSite(tenantOrgParam(org));
  if (!site) notFound();
  return <ContactView site={site} />;
}
