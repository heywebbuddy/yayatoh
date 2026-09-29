import { getTranslations } from 'next-intl/server';
import { ProgramForm } from '@/components/program-form.tsx';
import { requestLinkAction } from './actions.ts';

/** "Email me a sign-in link" for one event's exhibitor portal (a signed site token). */
export async function PortalSignInForm({ locale, site }: { locale: string; site: string }) {
  const t = await getTranslations('exhibitorPortal');
  return (
    <ProgramForm
      action={requestLinkAction.bind(null, locale, site)}
      fields={[{ kind: 'text', name: 'email', label: t('email'), required: true, maxLength: 254 }]}
      idPrefix="portal-sign-in"
      submitLabel={t('sendLink')}
      successLabel={t('linkSent')}
      errors={{
        email: t('errors.email'),
        link_invalid: t('errors.link_invalid'),
        rate_limited: t('errors.rate_limited'),
      }}
    />
  );
}
