import { Alert, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { verifySite } from '@/server/portal.ts';
import { PortalSignInForm } from '../../sign-in-form.tsx';

type Params = { params: Promise<{ locale: string; site: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'exhibitorPortal' });
  return { title: t('signInTitle'), robots: { index: false, follow: false } };
}

/** One event's exhibitor portal sign-in page (the organizer shares its link). */
export default async function PortalSignInPage({ params }: Params) {
  const { locale, site } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('exhibitorPortal');
  const ok = verifySite(site) !== null;
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-12 md:px-6">
      <PageHeader
        eyebrow={<Label>{t('eyebrow')}</Label>}
        title={t('signInTitle')}
        description={t('signInIntro')}
      />
      {ok ? <PortalSignInForm locale={locale} site={site} /> : <Alert title={t('errors.link_invalid')} />}
    </main>
  );
}
