import { openSignupEnabled, signupCodeValid } from '@yayatoh/tenancy';
import { buttonClass, Card, Input, Label, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthBar } from '@/components/auth-bar.tsx';
import { SignupForm } from '@/components/signup-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { humanCheckWidget } from '@/server/human-check.ts';
import { ownAuthSession } from '@/server/session.ts';
import { signupAction } from './actions.ts';

/** Where "Join the waitlist" goes while signup is closed (owner-provided; hidden when unset). */
function waitlistUrl(): string | null {
  const url = process.env.SIGNUP_WAITLIST_URL?.trim();
  return url && /^(https:\/\/|mailto:)/.test(url) ? url : null;
}

/**
 * Signup. With a signup code (M1.3b), a person verifies their email (a one-time code creates the
 * account) and creates their organization. Without a code (M3.11a): while staff keep open signup
 * off (the default until launch) this is a "coming soon" page with the waitlist and a code box;
 * once it is on, anyone with a verified email can create an organizer account and org, which
 * starts in setup mode (`limited`) until its onboarding checklist is done.
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
  const [session, open] = await Promise.all([ownAuthSession(), openSignupEnabled()]);
  const valid = code ? await signupCodeValid(code) : false;
  const here = code ? `/signup?code=${encodeURIComponent(code)}` : '/signup';
  const selfServe = !code && open;
  const waitlist = waitlistUrl();
  return (
    <>
      <AuthBar />
      <main
        id="main"
        className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-xl flex-col justify-center gap-6 px-6 py-16"
      >
        <PageHeader
          eyebrow={<Label>{t('signup.eyebrow')}</Label>}
          title={t('signup.title')}
          description={selfServe ? t('signup.openDescription') : t('signup.description')}
        />
        <Card size="panel" className="flex flex-col gap-4">
          {!code && !open ? (
            <section aria-labelledby="coming-soon" className="flex flex-col gap-4">
              <h2 id="coming-soon" className="text-section">
                {t('signup.comingSoon')}
              </h2>
              <p className="text-body text-ink-2">{t('signup.comingSoonBody')}</p>
              {waitlist ? (
                <a href={waitlist} className={buttonClass('primary', 'md', 'self-start')}>
                  {t('signup.joinWaitlist')}
                </a>
              ) : null}
              <p className="text-body text-ink-2">{t('signup.needCode')}</p>
              <form method="get" className="flex flex-wrap items-end gap-3">
                <Input
                  name="code"
                  required
                  minLength={6}
                  maxLength={64}
                  autoComplete="off"
                  spellCheck={false}
                  label={t('signup.code')}
                />
                <button type="submit" className={buttonClass('secondary')}>
                  {t('signup.useCode')}
                </button>
              </form>
              <Link href="/pricing" className="self-start text-body underline underline-offset-2">
                {t('signup.seePricing')}
              </Link>
            </section>
          ) : code && !valid ? (
            <p className="text-body text-ink-2">{t('signup.invalidCode')}</p>
          ) : !session ? (
            <>
              <p className="text-body text-ink-2">{t('signup.verifyFirst')}</p>
              <Link
                href={`/sign-in?next=${encodeURIComponent(here)}`}
                className={buttonClass('primary', 'md', 'self-start')}
              >
                {t('signup.continueWithEmail')}
              </Link>
            </>
          ) : (
            <>
              <p className="text-caption text-ink-2">
                {t('signup.signedInAs', { email: session.user.email })}
              </p>
              {selfServe ? (
                <p className="text-body text-ink-2">
                  {t.rich('signup.openNote', {
                    pricing: (chunks) => (
                      <Link href="/pricing" className="underline underline-offset-2">
                        {chunks}
                      </Link>
                    ),
                  })}
                </p>
              ) : null}
              <SignupForm
                action={signupAction}
                code={code}
                open={selfServe}
                humanCheck={selfServe ? humanCheckWidget() : null}
              />
            </>
          )}
        </Card>
      </main>
    </>
  );
}
