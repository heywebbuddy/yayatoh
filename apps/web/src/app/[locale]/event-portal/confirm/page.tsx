import { portalStepUpInviteToken } from '@yayatoh/events';
import { Card, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PortalSignInForm } from '@/components/portal-forms.tsx';
import { PortalAuthFrame, PortalSignedOut } from '@/components/portal-shell.tsx';
import { currentPortalPrincipal } from '@/server/portal.ts';
import { confirmForExportAction } from '../leads-actions.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'leads' });
  return { title: t('confirm.title'), robots: { index: false, follow: false } };
}

/**
 * Step-up before the lead export (M5.6b): the signed-in exhibitor admin confirms with a fresh
 * emailed code (the one portal sign-in flow, P5-7); the export works for 10 minutes after.
 */
export default async function ConfirmExportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const principal = await currentPortalPrincipal();
  const token = principal ? await portalStepUpInviteToken(principal.orgId, principal.accountId) : null;
  if (!principal || !token) return <PortalSignedOut signedOut={false} />;
  const t = await getTranslations('leads');
  return (
    <PortalAuthFrame>
      <PageHeader eyebrow={<Label>{t('portal.heading')}</Label>} title={t('confirm.title')} />
      <Card size="panel" className="flex flex-col gap-4">
        <p className="text-body">{t('confirm.intro', { email: principal.email })}</p>
        <PortalSignInForm action={confirmForExportAction.bind(null, token)} email={principal.email} />
      </Card>
    </PortalAuthFrame>
  );
}
