import { portalInviteByToken } from '@yayatoh/events';
import { Card, EmptyState, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { portalSignInAction } from '@/app/[locale]/event-portal/actions.ts';
import { GoToPortal, PortalSignInForm } from '@/components/portal-forms.tsx';
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
 * A portal invitation (M5.3a, P5-7). The signed token names the org and the account; opening it
 * spends nothing. A live invitation offers to email a sign-in code (and a magic link for this
 * browser); revoked, reissued, expired and forged links explain themselves.
 */
export default async function PortalInvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('portalSignIn');
  const tr = await getTranslations('speakerPortal');
  const raw = decodeURIComponent(token);
  const invite = await portalInviteByToken(raw);
  const signedIn = await currentPortalPrincipal();
  const mine = invite && signedIn?.accountId === invite.accountId && signedIn.orgId === invite.orgId;
  const problem = !invite ? 'invalid' : invite.status === 'ok' ? null : invite.status;
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-12 md:px-6">
      <PageHeader
        eyebrow={<Label>{invite?.eventName ?? tr('title')}</Label>}
        title={t('title')}
        description={invite && !problem ? t('intro', { role: tr(`roles.${invite.role}`) }) : undefined}
      />
      {problem ? (
        <EmptyState title={t(`${problem}Title`)} description={t(`${problem}Description`)} />
      ) : mine ? (
        <Card className="flex flex-col gap-3">
          <p className="text-body">{t('alreadySignedIn')}</p>
          <GoToPortal href={`${locale === 'en' ? '' : `/${locale}`}/event-portal`} label={t('continue')} />
        </Card>
      ) : invite ? (
        <Card className="flex flex-col gap-4">
          <p className="text-body">{t('willEmail', { email: invite.maskedEmail })}</p>
          <PortalSignInForm action={portalSignInAction.bind(null, raw)} email={invite.maskedEmail} />
        </Card>
      ) : null}
    </main>
  );
}
