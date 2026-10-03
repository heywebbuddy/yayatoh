import { executeQuery, utcToZonedInput } from '@yayatoh/kernel';
import { cfpOverviewQuery, MAX_CFP_QUESTIONS } from '@yayatoh/program';
import { Alert, Card, EmptyState } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionButtonForm } from '@/components/portal-admin-forms.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { ports } from '@/server/ports.ts';
import { loadProgramPage } from '@/server/program.ts';
import { addQuestionAction, removeQuestionAction, saveCfpAction } from '../actions.ts';
import { CfpHeader } from '../cfp-header.tsx';

const LENGTHS = [15, 20, 30, 45, 60, 90] as const;
const QUESTION_TYPES = ['short_text', 'long_text', 'select', 'multi_select', 'checkbox', 'number'] as const;

/**
 * Call for papers, settings (M5.3b): open or close the call, the deadline (event time zone), the
 * session lengths offered, co-speakers allowed, blind review, and the extra questions (forms
 * engine: each change is a new form version, answers keep theirs).
 */
export default async function CfpSettingsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, ev, canWrite } = await loadProgramPage(org, event, 'speakers');
  const t = await getTranslations('cfp');
  const view = await executeQuery(cfpOverviewQuery, { eventId: ev.id }, data.ctx, ports);
  const call = view.call;
  const tz = ev.timezone;
  return (
    <>
      <CfpHeader
        org={org}
        event={event}
        orgName={data.org.name}
        eventName={ev.name}
        status={call.status}
        active="settings"
        counts={{ submissions: view.submissions.length, reviewers: view.reviewers.length }}
      />
      {canWrite ? null : <Alert tone="info" title={t('viewerNotice')} />}
      <section aria-labelledby="call-heading">
        <Card size="panel" className="flex flex-col gap-3">
          <h2 id="call-heading" className="text-section">
            {t('settingsHeading')}
          </h2>
          {canWrite ? (
            <ProgramForm
              action={saveCfpAction.bind(null, org, event)}
              idPrefix="cfp"
              submitLabel={t('save')}
              successLabel={t('saved')}
              errors={{
                closesAt: t('errors.closesAt'),
                past: t('errors.pastDeadline'),
                durations: t('errors.durations'),
              }}
              fields={[
                {
                  kind: 'select',
                  name: 'status',
                  label: t('statusLabel'),
                  hint: t('statusHint'),
                  defaultValue: call.status,
                  options: (['draft', 'open', 'closed'] as const).map((s) => ({
                    value: s,
                    label: t(`statusOption.${s}`),
                  })),
                },
                {
                  kind: 'datetime-local',
                  name: 'closesAt',
                  label: t('closesAtLabel'),
                  hint: t('closesAtHint', { zone: tz.replace(/_/g, ' ') }),
                  defaultValue: call.closesAt ? utcToZonedInput(call.closesAt, tz) : undefined,
                },
                {
                  kind: 'checkboxes',
                  name: 'durations',
                  label: t('durationsLabel'),
                  defaultValues: call.durations.map(String),
                  options: [...new Set([...LENGTHS, ...call.durations])]
                    .sort((a, b) => a - b)
                    .map((m) => ({ value: String(m), label: t('minutes', { count: m }) })),
                },
                {
                  kind: 'select',
                  name: 'maxCoSpeakers',
                  label: t('maxCoSpeakersLabel'),
                  defaultValue: String(call.maxCoSpeakers),
                  options: [0, 1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) })),
                },
                {
                  kind: 'checkboxes',
                  name: 'blind',
                  label: t('blindLabel'),
                  defaultValues: call.blind ? ['1'] : [],
                  options: [{ value: '1', label: t('blindOption') }],
                },
                {
                  kind: 'textarea',
                  name: 'intro',
                  label: t('introLabel'),
                  hint: t('introHint'),
                  rows: 5,
                  defaultValue: call.intro,
                },
              ]}
            />
          ) : (
            <dl className="grid grid-cols-1 gap-2 text-body sm:grid-cols-2">
              <dt className="font-bold">{t('statusLabel')}</dt>
              <dd>{t(`statusOption.${call.status}`)}</dd>
              <dt className="font-bold">{t('durationsLabel')}</dt>
              <dd>{call.durations.map((m) => t('minutes', { count: m })).join(', ')}</dd>
              <dt className="font-bold">{t('blindLabel')}</dt>
              <dd>{call.blind ? t('yes') : t('no')}</dd>
            </dl>
          )}
        </Card>
      </section>
      <section aria-labelledby="questions-heading" className="flex flex-col gap-3">
        <h2 id="questions-heading" className="text-section">
          {t('questionsHeading')}
        </h2>
        <p className="text-caption text-ink-2">{t('questionsHint')}</p>
        {view.questions.length === 0 ? (
          <EmptyState title={t('noQuestionsTitle')} description={t('noQuestionsDescription')} />
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-card border border-line bg-surface p-0 glass">
            {view.questions.map((q) => (
              <li key={q.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <span className="flex flex-col gap-0.5">
                  <span className="text-body font-bold text-ink">{q.label}</span>
                  <span className="text-caption text-ink-2">
                    {t(`questionType.${q.type}`)}
                    {q.required ? ` · ${t('required')}` : ''}
                    {q.options.length ? ` · ${q.options.join(', ')}` : ''}
                  </span>
                </span>
                {canWrite ? (
                  <ActionButtonForm
                    action={removeQuestionAction.bind(null, org, event, q.key)}
                    label={t('removeQuestion', { label: q.label })}
                    successLabel={t('questionRemoved')}
                    variant="ghost"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canWrite && view.questions.length < MAX_CFP_QUESTIONS ? (
          <Card size="panel" className="flex flex-col gap-3">
            <h3 className="text-section">{t('addQuestion')}</h3>
            <ProgramForm
              action={addQuestionAction.bind(null, org, event)}
              idPrefix="cfp-question"
              submitLabel={t('addQuestion')}
              successLabel={t('questionAdded')}
              reset
              errors={{
                label: t('errors.questionLabel'),
                options: t('errors.options'),
                too_few: t('errors.options'),
                too_many: t('errors.tooManyQuestions'),
              }}
              fields={[
                {
                  kind: 'select',
                  name: 'type',
                  label: t('questionTypeLabel'),
                  options: QUESTION_TYPES.map((x) => ({ value: x, label: t(`questionType.${x}`) })),
                },
                { kind: 'text', name: 'label', label: t('questionLabel'), required: true, maxLength: 200 },
                {
                  kind: 'textarea',
                  name: 'options',
                  label: t('optionsLabel'),
                  hint: t('optionsHint'),
                  rows: 3,
                },
                {
                  kind: 'checkboxes',
                  name: 'required',
                  label: t('requiredLabel'),
                  options: [{ value: '1', label: t('requiredOption') }],
                },
              ]}
            />
          </Card>
        ) : null}
      </section>
    </>
  );
}
