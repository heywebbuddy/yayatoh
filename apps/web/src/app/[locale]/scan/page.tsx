import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ScanApp } from '@/components/scan-app.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t('scan.title'), manifest: '/scan.webmanifest', robots: { index: false } };
}

/** The Scan PWA (device-key auth, works offline). No session: devices are not people. */
export default async function ScanPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-8">
      <ScanApp />
    </main>
  );
}
