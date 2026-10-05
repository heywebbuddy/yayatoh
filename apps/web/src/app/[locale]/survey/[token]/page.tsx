import { publicSurvey } from '@yayatoh/surveys';
import { Card, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SurveyAnswerForm } from '@/components/survey-answer-form.tsx';
import { submitSurveyAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('survey');
  return { title: t('metaTitle'), robots: { index: false } };
}

/**
 * A survey reached from the link in its email (M3.9a), mobile first. No account: the signed link
 * is the credential, and it works once. Answered, expired and closed links say so.
 */
export default async function SurveyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ thanks?: string }>;
}) {
  const { locale, token: raw } = await params;
  setRequestLocale(locale);
  const token = decodeURIComponent(raw);
  const view = await publicSurvey(token);
  if (!view) notFound();
  const { thanks } = await searchParams;
  const t = await getTranslations('survey');
  const done = (title: string, body: string) => (
    <Card className="flex flex-col gap-2">
      <h2 className="text-section">{title}</h2>
      <p role="status" className="text-body text-ink-2">
        {body}
      </p>
    </Card>
  );
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-16"
    >
      <PageHeader
        eyebrow={<Label>{t('eyebrow', { org: view.orgName })}</Label>}
        title={view.title}
        description={view.intro || t('defaultIntro', { org: view.orgName, event: view.eventName })}
      />
      {view.sessionTitle ? (
        <p className="text-body text-ink-2">
          {t('sessionLine', { session: view.sessionTitle, event: view.eventName })}
        </p>
      ) : null}
      {view.state === 'answered' ? (
        thanks === '1' ? (
          done(t('thanksTitle'), t('thanks', { org: view.orgName }))
        ) : (
          done(t('answeredTitle'), t('answered'))
        )
      ) : view.state === 'expired' ? (
        done(t('expiredTitle'), t('expired'))
      ) : view.state === 'closed' ? (
        done(t('closedTitle'), t('closed', { org: view.orgName }))
      ) : view.form ? (
        <SurveyAnswerForm action={submitSurveyAction.bind(null, token)} questions={view.form.fields} />
      ) : (
        done(t('closedTitle'), t('closed', { org: view.orgName }))
      )}
    </main>
  );
}
