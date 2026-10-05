import { isSocialProvider, listSocialAccounts, listTrustedDevices } from '@yayatoh/auth';
import { accountDeletionBlockers } from '@yayatoh/privacy';
import { twoFactorRequiredBy } from '@yayatoh/tenancy';
import { buttonClass, Card, Label, PageHeader, StatusDot } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccountDelete, AccountExport } from '@/components/account-data.tsx';
import { SignInMethods, TrustedDevices } from '@/components/sign-in-methods.tsx';
import { SignOutEverywhere } from '@/components/sign-out-everywhere.tsx';
import { StepUpProvider } from '@/components/step-up.tsx';
import { RegenerateCodes, TwoFactorOff, TwoFactorSetup } from '@/components/two-factor.tsx';
import { Link, redirect } from '@/i18n/navigation.ts';
import { getTwoFactor } from '@/server/auth.ts';
import { getSession } from '@/server/session.ts';
import { enabledSocialProviders } from '@/server/social.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'security' });
  return { title: t('metaTitle') };
}

/**
 * Account security (M1.2c): two-step verification with an authenticator app, backup codes, and
 * turning it off. Owners, admins and finance are sent here until it is on (every console is
 * closed to them before that). M1.14e: the person's own data — download it, delete the account.
 */
export default async function SecurityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ social?: string; provider?: string }>;
}) {
  const { locale } = await params;
  const { social, provider } = await searchParams;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) return redirect({ href: '/sign-in?next=/account/security', locale });
  const t = await getTranslations();
  // Staff acting as a member (M1.2e) can't see or change the member's own security settings.
  if (session.impersonation)
    return (
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12 md:px-6">
        <PageHeader eyebrow={<Label>{t('security.eyebrow')}</Label>} title={t('security.title')} />
        <Card className="flex flex-col gap-3">
          <p className="text-body text-ink-2">{t('security.impersonating')}</p>
          <Link href="/o" className={buttonClass('secondary', 'sm', 'self-start')}>
            {t('security.backToConsole')}
          </Link>
        </Card>
      </main>
    );
  const [status, requiredBy, blockers, linked, devices] = await Promise.all([
    getTwoFactor().status(session.userId),
    twoFactorRequiredBy(session.userId),
    accountDeletionBlockers(session.userId),
    listSocialAccounts(session.userId),
    listTrustedDevices(session.userId),
  ]);
  const providers = enabledSocialProviders();
  // Personal dates (not an org's): shown in UTC, like the rest of this page's times.
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const required = requiredBy.length > 0;
  const reasons = requiredBy.map((o) =>
    t('security.requiredFor', { role: t(`roles.${o.role}`), org: o.name }),
  );
  return (
    <main id="main" className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12 md:px-6">
      <StepUpProvider>
        <PageHeader
          eyebrow={<Label>{t('security.eyebrow')}</Label>}
          title={t('security.title')}
          description={t('security.description')}
        />
        {required && !status.enabled ? (
          <section
            aria-labelledby="required-heading"
            className="flex flex-col gap-2 rounded-card border border-primary bg-primary-soft px-5 py-4 text-primary-ink"
          >
            <h2 id="required-heading" className="text-section">
              {t('security.requiredTitle')}
            </h2>
            <p className="text-body">{t('security.requiredExplain')}</p>
            <ul className="flex list-disc flex-col gap-1 ps-5 text-body">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <Card role="region" aria-labelledby="app-heading" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="app-heading" className="text-section">
              {t('security.appTitle')}
            </h2>
            <StatusDot
              status={status.enabled ? 'success' : 'neutral'}
              label={status.enabled ? t('security.statusOn') : t('security.statusOff')}
            />
          </div>
          <p className="text-body text-ink-2">{t('security.appExplain')}</p>
          {status.enabled ? (
            required ? (
              <p className="text-body text-ink-2">
                {t('security.cannotTurnOff', { reasons: reasons.join(' · ') })}
              </p>
            ) : (
              <TwoFactorOff />
            )
          ) : (
            <TwoFactorSetup required={required} />
          )}
        </Card>
        {status.enabled ? (
          <Card role="region" aria-labelledby="codes-heading" className="flex flex-col gap-3">
            <h2 id="codes-heading" className="text-section">
              {t('security.codesTitle')}
            </h2>
            <RegenerateCodes left={status.backupCodesLeft} />
          </Card>
        ) : null}
        {providers.length > 0 || linked.length > 0 ? (
          <Card role="region" aria-labelledby="methods-heading" className="flex flex-col gap-3">
            <h2 id="methods-heading" className="text-section">
              {t('security.methods.title')}
            </h2>
            <p className="text-body text-ink-2">{t('security.methods.explain')}</p>
            <SignInMethods
              providers={providers.length > 0 ? providers : linked.map((l) => l.provider)}
              linked={linked.map((l) => ({ provider: l.provider, linkedAt: day.format(l.linkedAt) }))}
              result={social && isSocialProvider(provider) ? { code: social.slice(0, 40), provider } : null}
            />
          </Card>
        ) : null}
        {status.enabled || devices.length > 0 ? (
          <Card role="region" aria-labelledby="devices-heading" className="flex flex-col gap-3">
            <h2 id="devices-heading" className="text-section">
              {t('security.devices.title')}
            </h2>
            <p className="text-body text-ink-2">{t('security.devices.explain')}</p>
            <TrustedDevices
              devices={devices.map((d) => ({
                id: d.id,
                label: d.label,
                createdAt: day.format(d.createdAt),
                lastUsedAt: d.lastUsedAt ? day.format(d.lastUsedAt) : null,
                expiresAt: day.format(d.expiresAt),
              }))}
            />
          </Card>
        ) : null}
        <Card role="region" aria-labelledby="sessions-heading" className="flex flex-col gap-3">
          <h2 id="sessions-heading" className="text-section">
            {t('security.sessionsTitle')}
          </h2>
          <p className="text-body text-ink-2">{t('security.sessionsExplain')}</p>
          <SignOutEverywhere />
        </Card>
        {!required || status.enabled ? (
          <>
            <AccountExport />
            <AccountDelete email={session.email} blockers={blockers.map((b) => b.name)} />
          </>
        ) : null}
        {!required || status.enabled ? (
          <Link href="/o" className={buttonClass('ghost', 'sm', 'self-start')}>
            {t('security.backToConsole')}
          </Link>
        ) : null}
      </StepUpProvider>
    </main>
  );
}
