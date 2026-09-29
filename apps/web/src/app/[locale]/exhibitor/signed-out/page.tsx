import { Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { rememberedPortalSite } from '@/server/portal.ts';
import { PortalSignInForm } from '../sign-in-form.tsx';

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'exhibitorPortal' });
  return { title: t('signedOutTitle'), robots: { index: false, follow: false } };
}

/** Signed out of the exhibitor portal: ask for a new link when this browser knows the event. */
export default async function SignedOutPage({ params }: Params) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('exhibitorPortal');
  const site = await rememberedPortalSite();
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-12 md:px-6">
      <PageHeader
        eyebrow={<Label>{t('eyebrow')}</Label>}
        title={t('signedOutTitle')}
        description={site ? t('signedOutIntro') : t('signedOutNoSite')}
      />
      {site ? <PortalSignInForm locale={locale} site={site} /> : null}
    </main>
  );
}
