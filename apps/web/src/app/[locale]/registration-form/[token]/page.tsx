import { publicRespondent } from '@yayatoh/forms';
import { EmptyState, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { RegistrationFormRunner, SubmittedHeading } from '@/components/registration-form-runner.tsx';
import { pageLocale } from '@/server/locale.ts';
import { eventNameOf } from '@/server/registration-forms.ts';
import { respondAction, suggestCompaniesAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('registrationForm');
  return { title: t('metaTitle'), robots: { index: false }, referrer: 'no-referrer' };
}

/**
 * A person's registration form, by their own signed link (M5.1b): one page of their path at a
 * time, with a progress indicator; saving and resuming work from the emailed link. Opening the
 * page changes nothing (mail scanners); only the buttons save.
 */
export default async function RegistrationFormTokenPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  pageLocale(locale);
  const view = await publicRespondent(token, { eventName: eventNameOf });
  if (!view) notFound();
  const t = await getTranslations('registrationForm');
  const consentTexts = Object.fromEntries(
    (view.page?.fields ?? [])
      .filter((f) => f.type === 'consent' && f.consent)
      .map((f) => {
        const key = `consentText.${f.consent?.term}_v${f.consent?.version}`;
        return [f.key, t.has(key) ? t(key) : f.label];
      }),
  );
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-16"
    >
      {view.state === 'submitted' ? (
        <>
          <p className="text-caption text-zinc-600">
            <Label>{view.eventName}</Label>
          </p>
          <SubmittedHeading title={t('submittedTitle')} />
          <p className="text-body text-zinc-600">{t('submittedDescription', { name: view.name })}</p>
        </>
      ) : view.state === 'expired' || !view.page ? (
        <>
          <PageHeader eyebrow={<Label>{view.eventName}</Label>} title={t('title')} />
          <EmptyState title={t('expiredTitle')} description={t('expiredDescription')} />
        </>
      ) : (
        <>
          <PageHeader
            eyebrow={<Label>{view.eventName}</Label>}
            title={t('respondTitle', { name: view.name })}
          />
          <RegistrationFormRunner
            key={view.page.key}
            page={view.page}
            values={view.values}
            step={view.step}
            steps={view.steps}
            first={view.first}
            last={view.last}
            jobTitles={view.jobTitles}
            consentTexts={consentTexts}
            action={respondAction.bind(null, token, view.page.key)}
            suggest={suggestCompaniesAction.bind(null, token)}
          />
        </>
      )}
    </main>
  );
}
