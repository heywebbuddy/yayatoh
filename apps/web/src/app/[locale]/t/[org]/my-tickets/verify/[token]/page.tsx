import { publicOrganizerById } from '@yayatoh/marketplace';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MyTicketsVerifyView } from '@/components/my-tickets-verify.tsx';
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

/** An org site's "My tickets" sign-in link (M1.5f). */
export default async function TenantMyTicketsVerifyPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; token: string }>;
}) {
  const { locale, org, token } = await params;
  setRequestLocale(locale);
  const orgId = tenantOrgParam(org);
  const o = orgId ? await publicOrganizerById(orgId) : null;
  if (!orgId || !o) notFound();
  return <MyTicketsVerifyView orgId={orgId} siteName={o.name} token={decodeURIComponent(token)} />;
}
