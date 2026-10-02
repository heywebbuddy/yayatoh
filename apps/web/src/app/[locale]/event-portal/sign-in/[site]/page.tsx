import { portalSiteByToken } from '@yayatoh/events';
import { Alert, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { resendInvitationAction } from '@/app/[locale]/event-portal/actions.ts';
import { ProgramForm } from '@/components/program-form.tsx';

type Params = { params: Promise<{ locale: string; site: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'portalSignIn' });
  return { title: t('requestTitle'), robots: { index: false, follow: false } };
}

/**
 * One event's portal sign-in page (the organizer shares its link; M5.4a): anyone invited to the
 * event's portal (speakers, exhibitor admins and staff, sponsor contacts) can have their invitation
 * emailed again, then signs in through it as usual.
 */
export default async function PortalSitePage({ params }: Params) {
  const { locale, site } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('portalSignIn');
  const raw = decodeURIComponent(site);
  const target = await portalSiteByToken(raw);
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-12 md:px-6">
      <PageHeader
        eyebrow={target ? <Label>{target.eventName}</Label> : undefined}
        title={t('requestTitle')}
        description={t('requestIntro')}
      />
      {target ? (
        <ProgramForm
          action={resendInvitationAction.bind(null, raw)}
          fields={[{ kind: 'text', name: 'email', label: t('email'), required: true, maxLength: 254 }]}
          idPrefix="portal-sign-in"
          submitLabel={t('sendLink')}
          successLabel={t('linkSent')}
          errors={{
            email: t('errors.email'),
            site_invalid: t('siteInvalid'),
            rate_limited: t('errors.rate_limited'),
          }}
        />
      ) : (
        <Alert title={t('siteInvalid')} />
      )}
    </main>
  );
}
