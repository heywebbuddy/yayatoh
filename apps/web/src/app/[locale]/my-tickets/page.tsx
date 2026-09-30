import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MyTicketsView } from '@/components/my-tickets-view.tsx';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'attendeeSignIn' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/** "My tickets" on the marketplace (M1.5f): a verified address's orders across every org. */
export default async function MyTicketsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ signedOut?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { signedOut } = await searchParams;
  return <MyTicketsView orgId={null} siteName="Yayatoh" locale={locale} signedOut={signedOut} />;
}
