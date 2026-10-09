import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AccountSecurityView } from '@/components/account-security-view.tsx';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'security' });
  return { title: t('metaTitle') };
}
export default function SecurityPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ social?: string; provider?: string }>;
}) {
  return <AccountSecurityView {...props} />;
}
