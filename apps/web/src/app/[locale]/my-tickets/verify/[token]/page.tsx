import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MyTicketsVerifyView } from '@/components/my-tickets-verify.tsx';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'attendeeSignIn' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/** A marketplace "My tickets" sign-in link (M1.5f). */
export default async function MyTicketsVerifyPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  return <MyTicketsVerifyView orgId={null} siteName="Yayatoh" token={decodeURIComponent(token)} />;
}
