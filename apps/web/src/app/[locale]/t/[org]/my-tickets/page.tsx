import { publicOrganizerById } from '@yayatoh/marketplace';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MyTicketsView } from '@/components/my-tickets-view.tsx';
import { tenantOrgParam } from '@/server/tenant-site.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'attendeeSignIn' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/** "My tickets" on an org's site (`{org host}/my-tickets`, rewritten here): that org's orders. */
export default async function TenantMyTicketsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ signedOut?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const orgId = tenantOrgParam(org);
  const o = orgId ? await publicOrganizerById(orgId) : null;
  if (!orgId || !o) notFound();
  const { signedOut } = await searchParams;
  return <MyTicketsView orgId={orgId} siteName={o.name} locale={locale} signedOut={signedOut} />;
}
