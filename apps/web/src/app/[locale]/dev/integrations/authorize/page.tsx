import { connectorByKey, fakeIntegrations, safeReturnPath } from '@yayatoh/integrations';
import { Button, Card, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { integrationAuth } from '@/server/integrations.ts';
import { devAuthEnabled } from '@/server/session.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('integrations.fakeConsent');
  return { title: t('title'), robots: { index: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Dev/CI only (M6.4a): the fake provider's consent screen, standing in for a real provider's OAuth
 * page behind the `IntegrationAuth` port. Allow creates the provider-side account (its tokens are
 * canaries that stay in the fake); both answers return to our callback with the state. 404 unless
 * dev auth is on and the port is the fake.
 */
export default async function FakeConsentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    connection?: string;
    org?: string;
    provider?: string;
    state?: string;
    return?: string;
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!devAuthEnabled() || integrationAuth()?.provider !== 'fake') notFound();
  const sp = await searchParams;
  const connector = sp.provider ? connectorByKey(sp.provider) : null;
  const connectionId = sp.connection ?? '';
  const orgId = sp.org ?? '';
  const state = sp.state ?? '';
  const back = sp.return ?? '';
  if (!connector?.fake || !UUID.test(connectionId) || !UUID.test(orgId) || !state || !safeReturnPath(back))
    notFound();
  const t = await getTranslations('integrations.fakeConsent');
  const answer = async (allow: boolean) => {
    'use server';
    if (!devAuthEnabled() || !connector.fake) notFound();
    if (allow)
      fakeIntegrations.approve(
        { orgId, connectionId, providerConfigKey: connector.providerConfigKey },
        connector.fake,
      );
    const q = new URLSearchParams({ state, ...(allow ? {} : { error: 'access_denied' }) });
    redirect(`${back}?${q.toString()}`);
  };
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 px-4 py-12">
      <PageHeader eyebrow={<Label>{t('eyebrow')}</Label>} title={t('heading', { name: connector.name })} />
      <Card className="flex flex-col gap-4">
        <p className="m-0 text-body">{t('body', { name: connector.name })}</p>
        <ul className="m-0 flex flex-col gap-1 ps-5 text-body">
          {connector.scopes.map((s) => (
            <li key={s}>
              <code className="font-mono text-caption">{s}</code>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <form action={answer.bind(null, true)}>
            <Button type="submit" size="lg">
              {t('allow')}
            </Button>
          </form>
          <form action={answer.bind(null, false)}>
            <Button type="submit" variant="secondary" size="lg">
              {t('deny')}
            </Button>
          </form>
        </div>
      </Card>
    </main>
  );
}
