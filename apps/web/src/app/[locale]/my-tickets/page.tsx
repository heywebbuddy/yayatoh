import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';

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
  await searchParams;
  return redirect({ href: '/attendee/tickets', locale });
}
