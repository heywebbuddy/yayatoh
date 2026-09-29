import { parsePortalLinkToken } from '@yayatoh/program';
import { Alert, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProgramForm } from '@/components/program-form.tsx';
import { openLinkAction } from '../../actions.ts';

type Params = { params: Promise<{ locale: string; token: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'exhibitorPortal' });
  return { title: t('joinTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/**
 * An invitation or sign-in link (M5.4a). Opening the page spends nothing (mail scanners follow
 * links); "Continue" spends the link and signs this browser in.
 */
export default async function JoinPage({ params }: Params) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('exhibitorPortal');
  const valid = parsePortalLinkToken(token) !== null;
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-12 md:px-6">
      <PageHeader
        eyebrow={<Label>{t('eyebrow')}</Label>}
        title={t('joinTitle')}
        description={t('joinIntro')}
      />
      {valid ? (
        <ProgramForm
          action={openLinkAction.bind(null, locale, token)}
          fields={[]}
          idPrefix="join"
          submitLabel={t('continue')}
          successLabel={t('signedIn')}
          errors={{ link_invalid: t('errors.link_invalid') }}
        />
      ) : (
        <Alert title={t('errors.link_invalid')} />
      )}
    </main>
  );
}
