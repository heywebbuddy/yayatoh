import { twoFactorRequiredBy } from '@yayatoh/tenancy';
import { buttonClass, Card, Label, PageHeader, StatusDot } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StepUpProvider } from '@/components/step-up.tsx';
import { RegenerateCodes, TwoFactorOff, TwoFactorSetup } from '@/components/two-factor.tsx';
import { Link, redirect } from '@/i18n/navigation.ts';
import { getTwoFactor } from '@/server/auth.ts';
import { getSession } from '@/server/session.ts';

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
 * closed to them before that).
 */
export default async function SecurityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) return redirect({ href: '/sign-in?next=/account/security', locale });
  const [status, requiredBy] = await Promise.all([
    getTwoFactor().status(session.userId),
    twoFactorRequiredBy(session.userId),
  ]);
  const t = await getTranslations();
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
            className="flex flex-col gap-2 rounded-card border border-accent-700 bg-accent-50 px-5 py-4 text-accent-text"
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
          <p className="text-body text-zinc-600">{t('security.appExplain')}</p>
          {status.enabled ? (
            required ? (
              <p className="text-body text-zinc-600">
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
        {!required || status.enabled ? (
          <Link href="/o" className={buttonClass('ghost', 'sm', 'self-start')}>
            {t('security.backToConsole')}
          </Link>
        ) : null}
      </StepUpProvider>
    </main>
  );
}
