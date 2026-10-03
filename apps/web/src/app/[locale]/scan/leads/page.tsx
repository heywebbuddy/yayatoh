import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LeadApp } from '@/components/lead-app.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t('leads.app.pageTitle'), manifest: '/scan.webmanifest', robots: { index: false } };
}

/**
 * Lead mode of the Scan PWA (M5.6b). The page itself holds no one's data (it is cached for
 * offline use); the person and their leads come from `/api/scan/leads` with the portal session.
 */
export default async function LeadModePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-8">
      <LeadApp />
    </main>
  );
}
