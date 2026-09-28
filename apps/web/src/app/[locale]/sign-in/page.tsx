import { Alert, buttonClass, Card, Label, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ContinueToSite, type Handoff, SignInForm } from '@/components/sign-in-form.tsx';
import { SocialButtons } from '@/components/social-buttons.tsx';
import { Link } from '@/i18n/navigation.ts';
import { humanCheckWidget } from '@/server/human-check.ts';
import { devAuthEnabled, ownSession } from '@/server/session.ts';
import { enabledSocialProviders } from '@/server/social.ts';
import { verifiedTenantReturn } from '@/server/tenant-return.ts';

/** Messages after a Google/Apple sign-in came back without signing in (M1.2f). */
const SOCIAL_MESSAGES = ['failed', 'cancelled', 'email_unverified', 'no_email', 'unavailable'] as const;

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    next?: string;
    challenge?: string;
    return?: string;
    state?: string;
    signedOut?: string;
    social?: string;
    reset?: string;
  }>;
}) {
  const { locale } = await params;
  const { next, challenge, return: returnUrl, state, signedOut, social, reset } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('signIn');
  // Only same-site relative paths are accepted as a post-sign-in destination (no open redirect).
  const safeNext = next?.startsWith('/') && !next.startsWith('//') ? next : '/o';
  // Signing in for a tenant site (M1.2d): only one of an org's verified hosts can be returned to.
  const ret = state ? await verifiedTenantReturn(returnUrl) : null;
  const handoff: Handoff | undefined =
    ret && state
      ? { returnUrl: ret.origin + ret.path, state: state.slice(0, 64), site: ret.hostname }
      : undefined;
  const session = handoff ? await ownSession() : null;
  const socialMessage = SOCIAL_MESSAGES.find((m) => m === social);
  const providers = enabledSocialProviders();
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <PageHeader
        eyebrow={<Label>{t('eyebrow')}</Label>}
        title={handoff && session ? t('handoff.title', { site: handoff.site }) : t('title')}
        description={handoff ? t('handoff.description', { site: handoff.site }) : undefined}
      />
      {signedOut === 'everywhere' ? <Alert tone="info" title={t('signedOutEverywhere')} /> : null}
      {reset === 'done' ? <Alert tone="info" title={t('passwordReset')} /> : null}
      {socialMessage ? <Alert title={t(`social.${socialMessage}`)} /> : null}
      <Card size="panel">
        {handoff && session ? (
          <ContinueToSite handoff={handoff} name={session.name} email={session.email} />
        ) : (
          <div className="flex flex-col gap-5">
            {challenge !== '1' && providers.length > 0 ? (
              <SocialButtons
                providers={providers}
                locale={locale}
                next={safeNext}
                handoff={handoff ? { returnUrl: handoff.returnUrl, state: handoff.state } : null}
              />
            ) : null}
            {/* `challenge=1`: a magic link or provider signed in the first factor; the code is still due. */}
            <SignInForm
              next={safeNext}
              challenge={challenge === '1'}
              handoff={handoff}
              humanCheck={humanCheckWidget()}
              locale={locale}
            />
          </div>
        )}
      </Card>
      {devAuthEnabled() ? (
        <Link href="/dev/login" className={buttonClass('ghost', 'sm', 'self-center')}>
          {t('devPersonas')}
        </Link>
      ) : null}
    </main>
  );
}
