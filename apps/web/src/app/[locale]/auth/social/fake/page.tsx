import { isSocialProvider } from '@yayatoh/auth';
import { Card, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FakeConsentForm } from '@/components/fake-consent-form.tsx';
import { socialMode, socialRedirectUri } from '@/server/social.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'fakeSocial' });
  return { title: t('metaTitle'), robots: { index: false } };
}

/** Stand-in for Google's and Apple's consent screens (dev, preview and CI only; M1.2f). */
export default async function FakeSocialConsent({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (socialMode() !== 'fake') notFound();
  const sp = await searchParams;
  const provider = sp.provider;
  if (
    !isSocialProvider(provider) ||
    !sp.state ||
    !sp.nonce ||
    sp.redirect_uri !== socialRedirectUri(provider)
  )
    notFound();
  const t = await getTranslations('fakeSocial');
  const name = t(`provider.${provider}`);
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <PageHeader
        eyebrow={<Label>{t('eyebrow')}</Label>}
        title={t('title', { provider: name })}
        description={t('description', { provider: name })}
      />
      <Card size="panel">
        <FakeConsentForm
          provider={provider}
          params={{ provider, state: sp.state, nonce: sp.nonce, redirectUri: sp.redirect_uri }}
        />
      </Card>
    </main>
  );
}
