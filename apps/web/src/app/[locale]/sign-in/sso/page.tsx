import { Alert, buttonClass, Card, Label, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthBar } from '@/components/auth-bar.tsx';
import { SsoSignInForm } from '@/components/sso/sso-sign-in-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { startSsoAction } from './actions.ts';

/** Why a single sign-on came back without signing in (`?error=`), each with its own message. */
const ERRORS = [
  'expired',
  'cancelled',
  'failed',
  'connection_inactive',
  'domain_not_verified',
  'identity_conflict',
  'deprovisioned',
  'not_provisioned',
  'staff_two_factor',
  'session_failed',
  'invalid_signature',
  'wrong_issuer',
  'wrong_audience',
  'wrong_request',
  'malformed',
  'no_email',
  'idp_error',
  'sso_required',
] as const;

export default async function SsoSignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  const { error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('signIn.sso');
  const known = ERRORS.find((e) => e === error);
  return (
    <>
      <AuthBar />
      <main
        id="main"
        className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-md flex-col justify-center gap-6 px-6 py-16"
      >
        <PageHeader
          eyebrow={<Label>{t('eyebrow')}</Label>}
          title={t('title')}
          description={t('description')}
        />
        {known ? (
          <Alert title={t(`refused.${known}`)} />
        ) : error ? (
          <Alert title={t('refused.failed')} />
        ) : null}
        <Card size="panel">
          <SsoSignInForm action={startSsoAction} />
        </Card>
        <Link href="/sign-in" className={buttonClass('ghost', 'sm', 'self-center')}>
          {t('back')}
        </Link>
      </main>
    </>
  );
}
