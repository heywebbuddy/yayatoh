import { ssoRuntime } from '@yayatoh/sso';
import { Card, Label, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FakeIdpForm } from '@/components/sso/fake-idp-form.tsx';
import { fakeIdpAnswerAction } from './actions.ts';

export const dynamic = 'force-dynamic';

/**
 * The recorded fake identity provider (M6.5a; dev, preview and CI only, 404 elsewhere): where
 * single sign-on sends the browser instead of Okta or Entra ID. It signs whoever is typed in, for
 * the connection and request in the URL, exactly as the org's IdP would vouch for them.
 */
export default async function FakeIdpPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  const q = await searchParams;
  setRequestLocale(locale);
  if (ssoRuntime().idp?.kind !== 'fake') notFound();
  const t = await getTranslations('ssoFakeIdp');
  const hidden = {
    org: q.org ?? '',
    connection: q.connection ?? '',
    state: q.state ?? '',
    nonce: q.nonce ?? '',
  };
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <PageHeader
        eyebrow={<Label>{t('eyebrow')}</Label>}
        title={t('title')}
        description={t(q.protocol === 'oidc' ? 'descriptionOidc' : 'descriptionSaml')}
      />
      <Card size="panel">
        <FakeIdpForm
          action={fakeIdpAnswerAction}
          hidden={hidden}
          loginHint={(q.login_hint ?? '').slice(0, 320)}
        />
      </Card>
    </main>
  );
}
