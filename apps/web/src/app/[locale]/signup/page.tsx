import { signupCodeValid } from '@yayatoh/tenancy';
import { buttonClass, Card, Label, PageHeader } from '@yayatoh/ui';
import { headers } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SignupForm } from '@/components/signup-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { getAuth } from '@/server/auth.ts';
import { signupAction } from './actions.ts';

/**
 * Invite-only signup (M1.3): with a signup code, a person verifies their email (a one-time code
 * creates the account) and creates their organization. Without a valid code there is no form.
 */
export default async function SignupPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ code?: string }>;
}) {
  const { locale } = await params;
  const code = ((await searchParams).code ?? '').trim().slice(0, 64);
  setRequestLocale(locale);
  const t = await getTranslations();
  const session = await getAuth().api.getSession({ headers: await headers() });
  const valid = code ? await signupCodeValid(code) : false;
  const here = `/signup?code=${encodeURIComponent(code)}`;
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <PageHeader
        eyebrow={<Label>{t('signup.eyebrow')}</Label>}
        title={t('signup.title')}
        description={t('signup.description')}
      />
      <Card size="panel" className="flex flex-col gap-4">
        {!valid ? (
          <p className="text-body text-zinc-600">{code ? t('signup.invalidCode') : t('signup.needCode')}</p>
        ) : !session ? (
          <>
            <p className="text-body text-zinc-600">{t('signup.verifyFirst')}</p>
            <Link
              href={`/sign-in?next=${encodeURIComponent(here)}`}
              className={buttonClass('primary', 'md', 'self-start')}
            >
              {t('signup.continueWithEmail')}
            </Link>
          </>
        ) : (
          <>
            <p className="text-caption text-zinc-600">
              {t('signup.signedInAs', { email: session.user.email })}
            </p>
            <SignupForm action={signupAction} code={code} />
          </>
        )}
      </Card>
    </main>
  );
}
