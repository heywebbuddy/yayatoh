import { consumePortalLink } from '@yayatoh/events';
import { Card, EmptyState, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { portalLinkCodeAction, portalOpenLinkAction } from '@/app/[locale]/event-portal/actions.ts';
import { GoToPortal, PortalLinkCodeForm, PortalOpenLinkForm } from '@/components/portal-forms.tsx';
import { PortalAuthFrame } from '@/components/portal-shell.tsx';
import { browserState } from '@/server/guest.ts';
import { currentPortalPrincipal } from '@/server/portal.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'portalSignIn' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * A portal sign-in magic link (M1.5f rules). Opening the page spends nothing (mail scanners): in
 * the browser that asked, Continue signs in; anywhere else the code from the same email does.
 */
export default async function PortalVerifyPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('portalSignIn');
  const tr = await getTranslations('speakerPortal');
  const raw = decodeURIComponent(token);
  // Signed in on this host (for instance this page re-rendering right after Continue set the
  // cookie): go on to the portal.
  if (await currentPortalPrincipal())
    return (
      <PortalAuthFrame>
        <GoToPortal href={`${locale === 'en' ? '' : `/${locale}`}/event-portal`} label={t('continue')} />
      </PortalAuthFrame>
    );
  const r = await consumePortalLink({ token: raw, browserState: await browserState(false), spend: false });
  return (
    <PortalAuthFrame>
      <PageHeader eyebrow={<Label>{tr('title')}</Label>} title={t('title')} />
      {r.status === 'invalid' ? (
        <EmptyState title={t('linkInvalidTitle')} description={t('linkInvalidDescription')} />
      ) : r.status === 'ok' ? (
        <Card size="panel" className="flex flex-col gap-4">
          <p className="text-body">{t('linkReady')}</p>
          <PortalOpenLinkForm action={portalOpenLinkAction.bind(null, raw)} />
        </Card>
      ) : (
        <Card size="panel" className="flex flex-col gap-4">
          <p className="text-body">{t('otherBrowser')}</p>
          <PortalLinkCodeForm action={portalLinkCodeAction.bind(null, raw)} />
        </Card>
      )}
    </PortalAuthFrame>
  );
}
