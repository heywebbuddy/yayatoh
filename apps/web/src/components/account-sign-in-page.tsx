import { Alert, buttonClass, Card, Label, PageHeader } from '@yayatoh/ui';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthBar } from '@/components/auth-bar.tsx';
import { ContinueToSite, type Handoff, SignInForm } from '@/components/sign-in-form.tsx';
import { SocialButtons } from '@/components/social-buttons.tsx';
import { Link } from '@/i18n/navigation.ts';
import { authEntryDestination } from '@/lib/auth-entry.ts';
import { localizedPath } from '@/lib/seo/urls.ts';
import { dashboardAccess } from '@/server/dashboard-access.ts';
import { humanCheckWidget } from '@/server/human-check.ts';
import { devAuthEnabled, ownSession } from '@/server/session.ts';
import { signOutHereAction } from '@/server/session-actions.ts';
import { enabledSocialProviders } from '@/server/social.ts';
import { ssoAvailable } from '@/server/sso.ts';
import { verifiedTenantReturn } from '@/server/tenant-return.ts';

/** Messages after a Google/Apple sign-in came back without signing in (M1.2f). */
const SOCIAL_MESSAGES = ['failed', 'cancelled', 'email_unverified', 'no_email', 'unavailable'] as const;

export async function AccountSignInPage({
  params,
  searchParams,
  audience = 'attendee',
  registration = false,
}: {
  audience?: 'attendee' | 'organizer';
  registration?: boolean;
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    next?: string;
    mode?: string;
    challenge?: string;
    return?: string;
    state?: string;
    signedOut?: string;
    social?: string;
    reset?: string;
    sso?: string;
  }>;
}) {
  const { locale } = await params;
  const {
    next,
    mode,
    challenge,
    return: returnUrl,
    state,
    signedOut,
    social,
    reset,
    sso,
  } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('signIn');
  const flow = await getTranslations('attendeeDashboard');
  const organizer = audience === 'organizer';
  const entryPath = organizer ? '/o/sign-in' : registration ? '/sign-up' : '/sign-in';
  // Only same-site relative paths are accepted as a post-sign-in destination (no open redirect).
  const safeNext = next?.startsWith('/') && !next.startsWith('//') ? next : organizer ? '/o' : '/attendee';
  // Signing in for a tenant site (M1.2d): only one of an org's verified hosts can be returned to.
  const ret = state ? await verifiedTenantReturn(returnUrl) : null;
  const handoff: Handoff | undefined =
    ret && state
      ? { returnUrl: ret.origin + ret.path, state: state.slice(0, 64), site: ret.hostname }
      : undefined;
  const session = handoff ? await ownSession() : null;
  const access = await dashboardAccess();
  const wrongRole = organizer && access.kind === 'attendee';
  if (!handoff && challenge !== '1') {
    if (!organizer && access.kind === 'organizer') redirect(localizedPath(locale, '/o/sign-in'));
    if (access.kind !== 'anonymous' && !wrongRole && sso !== 'other_org')
      redirect(localizedPath(locale, authEntryDestination(access.kind, access.href, next)));
  }
  // Return through this page after every authentication method to check backend membership.
  const finishPath = `${entryPath}?${new URLSearchParams({ next: safeNext })}`;
  const socialMessage = SOCIAL_MESSAGES.find((m) => m === social);
  const providers = enabledSocialProviders();
  return (
    <>
      <AuthBar />
      <main
        id="main"
        className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-md flex-col justify-center gap-6 px-6 py-16"
      >
        <PageHeader
          eyebrow={<Label>{registration ? flow('signUpLink') : t('eyebrow')}</Label>}
          title={
            handoff && session
              ? t('handoff.title', { site: handoff.site })
              : flow(
                  organizer
                    ? 'organizerSignInTitle'
                    : registration
                      ? 'attendeeSignUpTitle'
                      : 'attendeeSignInTitle',
                )
          }
          description={
            handoff
              ? t('handoff.description', { site: handoff.site })
              : flow(
                  organizer
                    ? 'organizerSignInDescription'
                    : registration
                      ? 'attendeeSignUpDescription'
                      : 'attendeeSignInDescription',
                )
          }
        />
        {signedOut === 'everywhere' ? <Alert tone="info" title={t('signedOutEverywhere')} /> : null}
        {reset === 'done' ? <Alert tone="info" title={t('passwordReset')} /> : null}
        {sso === 'other_org' ? <Alert tone="info" title={t('ssoOtherOrg')} /> : null}
        {socialMessage ? <Alert title={t(`social.${socialMessage}`)} /> : null}
        <Card size="panel">
          {wrongRole ? (
            <div className="flex flex-col gap-4">
              <Alert title={flow('organizationAccessRequired')} />
              <Link href="/attendee" className={buttonClass('secondary')}>
                {flow('title')}
              </Link>
              <form action={signOutHereAction}>
                <button type="submit" className={buttonClass('secondary')}>
                  {flow('useAnotherAccount')}
                </button>
              </form>
            </div>
          ) : handoff && session ? (
            <ContinueToSite handoff={handoff} name={session.name} email={session.email} />
          ) : (
            <div className="flex flex-col gap-5">
              {challenge !== '1' && providers.length > 0 ? (
                <SocialButtons
                  providers={providers}
                  locale={locale}
                  next={finishPath}
                  handoff={handoff ? { returnUrl: handoff.returnUrl, state: handoff.state } : null}
                />
              ) : null}
              {/* `challenge=1`: a magic link or provider signed in the first factor; the code is still due. */}
              <SignInForm
                allowModeSwitch={!registration}
                initialMode={registration || mode === 'code' ? 'code' : 'password'}
                next={finishPath}
                challenge={challenge === '1'}
                handoff={handoff}
                humanCheck={humanCheckWidget()}
                locale={locale}
              />
            </div>
          )}
        </Card>
        {organizer && !wrongRole && challenge !== '1' && !(handoff && session) && ssoAvailable() ? (
          <Link href="/o/sign-in/sso" className={buttonClass('secondary', 'md', 'self-center')}>
            {t('ssoLink')}
          </Link>
        ) : null}
        <div className="flex flex-wrap justify-center gap-4 text-caption">
          {!organizer ? (
            <Link href={registration ? '/sign-in' : '/sign-up'} className="underline">
              {flow(registration ? 'signInLink' : 'signUpLink')}
            </Link>
          ) : null}
          <Link href={organizer ? '/sign-in' : '/o/sign-in'} className="underline">
            {flow(organizer ? 'attendeeSignInTitle' : 'organizerSignInTitle')}
          </Link>
        </div>
        {devAuthEnabled() ? (
          <Link href="/dev/login" className={buttonClass('ghost', 'sm', 'self-center')}>
            {t('devPersonas')}
          </Link>
        ) : null}
      </main>
    </>
  );
}
