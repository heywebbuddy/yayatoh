import { executeQuery } from '@yayatoh/kernel';
import { listSurveysQuery, surveyTargetsQuery } from '@yayatoh/surveys';
import { Card, PageHeader, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CreatePostEventForm, CreateSessionForm } from '@/components/survey-forms.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createSurveyAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('surveys');
  return { title: t('title') };
}

/** Marketing → Surveys: the event's post-event survey and session feedback, with response rates. */
export default async function SurveysPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'marketing');
  if (!data.modules.has('messaging') || !can('messages:read')) notFound();
  const t = await getTranslations('surveys');
  const [list, targets] = await Promise.all([
    executeQuery(listSurveysQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(surveyTargetsQuery, { eventId: ev.id }, data.ctx, ports),
  ]);
  const canSend = can('messages:send');
  const base = `/o/${org}/e/${event}/marketing/surveys`;
  const open = targets.sessions.filter((s) => s.surveyId === null);
  return (
    <>
      <PageHeader title={t('title')} description={t('description', { event: ev.name })} />
      <p>
        <Link href={`/o/${org}/e/${event}/marketing`} className="text-body underline underline-offset-2">
          {t('backToMarketing')}
        </Link>
      </p>
      {canSend ? (
        <section aria-labelledby="create-heading" className="flex flex-col gap-3">
          <h2 id="create-heading" className="text-section">
            {t('createTitle')}
          </h2>
          <Card className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <h3 className="text-body font-medium">{t('kind.post_event')}</h3>
              {targets.postEvent ? (
                <p className="text-body text-zinc-600">{t('postEventExists')}</p>
              ) : (
                <CreatePostEventForm action={createSurveyAction.bind(null, org, event)} />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-body font-medium">{t('kind.session_feedback')}</h3>
              {targets.sessions.length === 0 ? (
                <p className="text-body text-zinc-600">{t('noSessions')}</p>
              ) : open.length === 0 ? (
                <p className="text-body text-zinc-600">{t('allSessionsHaveSurveys')}</p>
              ) : (
                <CreateSessionForm action={createSurveyAction.bind(null, org, event)} sessions={open} />
              )}
            </div>
          </Card>
        </section>
      ) : null}
      <section aria-labelledby="list-heading" className="flex flex-col gap-3">
        <h2 id="list-heading" className="text-section">
          {t('listTitle')}
        </h2>
        <Table
          caption={t('listTitle')}
          rowKey={(s) => s.id}
          rows={list}
          empty={t('empty')}
          columns={[
            {
              key: 'title',
              header: t('columns.title'),
              cell: (s) => (
                <span className="flex flex-col">
                  <Link href={`${base}/${s.id}`} className="underline underline-offset-2">
                    {s.title}
                  </Link>
                  <span className="text-caption text-zinc-500">
                    {s.kind === 'session_feedback' && s.sessionTitle
                      ? t('kindSession', { session: s.sessionTitle })
                      : t(`kind.${s.kind}`)}
                  </span>
                </span>
              ),
            },
            {
              key: 'questions',
              header: t('columns.questions'),
              cell: (s) => s.questions,
              mono: true,
              align: 'end',
            },
            {
              key: 'invited',
              header: t('columns.invited'),
              cell: (s) => s.invited,
              mono: true,
              align: 'end',
            },
            {
              key: 'responded',
              header: t('columns.responded'),
              cell: (s) => s.responded,
              mono: true,
              align: 'end',
            },
            {
              key: 'rate',
              header: t('columns.rate'),
              cell: (s) => (s.rate === null ? t('noRate') : t('rate', { rate: s.rate })),
              mono: true,
              align: 'end',
            },
            {
              key: 'status',
              header: t('columns.status'),
              cell: (s) => (s.closed ? t('status.closed') : t('status.open')),
            },
          ]}
        />
      </section>
    </>
  );
}
