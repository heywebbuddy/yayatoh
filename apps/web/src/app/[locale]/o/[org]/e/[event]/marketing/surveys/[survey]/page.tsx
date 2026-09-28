import { executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import type { BulkOperationDto } from '@yayatoh/platform';
import { type SurveyDetailDto, surveyExportBulk, surveyQuery } from '@yayatoh/surveys';
import { roleCan } from '@yayatoh/tenancy';
import { BarChart, Button, buttonClass, Card, ChartTable, EmptyState, PageHeader, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { StepUpForm } from '@/components/step-up.tsx';
import {
  AddSurveyQuestionForm,
  CloseSurveyForm,
  SendSurveyForm,
  SurveyDetailsForm,
} from '@/components/survey-forms.tsx';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  addSurveyQuestionAction,
  exportSurveyAction,
  moveSurveyQuestionAction,
  removeSurveyQuestionAction,
  sendSurveyAction,
  setSurveyClosedAction,
  updateSurveyAction,
} from '../actions.ts';

type Params = Promise<{ locale: string; org: string; event: string; survey: string }>;

async function load(params: Params) {
  const { org, event, survey } = await params;
  const { data, event: ev } = await loadEvent(org, event);
  if (!data.modules.has('messaging') || !roleCan(data.role, 'messages:read')) notFound();
  if (!/^[0-9a-f-]{36}$/.test(survey)) notFound();
  const detail = await executeQuery(surveyQuery, { eventId: ev.id, surveyId: survey }, data.ctx, ports).catch(
    (err) => {
      if (isDomainError(err) && err.code === 'not_found') notFound();
      throw err;
    },
  );
  return { data, ev, detail };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { detail } = await load(params);
  return { title: detail.survey.title };
}

type QuestionRow = SurveyDetailDto['report']['questions'][number];

/** One survey: results (NPS, per question), sending, the questions, and the CSV export. */
export default async function SurveyPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<{ op?: string; exportError?: string }>;
}) {
  const { locale, org, event, survey } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const { data, ev, detail } = await load(params);
  const t = await getTranslations('surveys');
  const tb = await getTranslations('bulk');
  const s = detail.survey;
  const canSend = roleCan(data.role, 'messages:send');
  const canExport = roleCan(data.role, 'attendees:export');
  const base = `/o/${org}/e/${event}/marketing/surveys`;
  const n = new Intl.NumberFormat(locale);
  const pct = (part: number, whole: number) => (whole ? Math.round((100 * part) / whole) : 0);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ev.timezone,
  });
  const ended = s.endsAt.getTime() <= Date.now();
  const subject = s.sessionTitle ?? ev.name;
  const fields = detail.definition.fields;

  let op: BulkOperationDto | null = null;
  if (canExport && sp.op && /^[0-9a-f-]{36}$/.test(sp.op)) {
    op = await executeQuery(surveyExportBulk.status, { operationId: sp.op }, data.ctx, ports).catch((err) => {
      if (isDomainError(err) && (err.code === 'not_found' || err.code === 'forbidden')) return null;
      throw err;
    });
    if (op && op.eventId !== ev.id) op = null;
  }
  const opActive = op ? ['queued', 'running'].includes(op.status) : false;

  const summary = (q: QuestionRow) => {
    const r = q.report;
    switch (r.kind) {
      case 'nps':
      case 'rating': {
        const labels = r.kind === 'nps' ? r.distribution.map((_, i) => String(i)) : ['1', '2', '3', '4', '5'];
        return (
          <div className="flex flex-col gap-2">
            <p className="text-body text-zinc-700">
              {r.kind === 'nps'
                ? t('npsLine', { score: r.score ?? 0, answered: r.answered })
                : t('averageLine', { average: r.average ?? 0, answered: r.answered })}
            </p>
            {r.answered > 0 ? (
              <>
                <BarChart
                  title={t('distributionTitle', { question: q.label })}
                  bars={r.distribution.map((v, i) => ({ label: labels[i] ?? String(i), value: v }))}
                  height={140}
                />
                <ChartTable
                  toggle={t('showData')}
                  caption={t('distributionTitle', { question: q.label })}
                  headers={[t('score'), t('answers')]}
                  rows={r.distribution.map((v, i) => [labels[i] ?? String(i), n.format(v)])}
                />
              </>
            ) : null}
          </div>
        );
      }
      case 'choice':
        return (
          <ul className="flex flex-col gap-1">
            {r.options.map((o) => (
              <li key={o.value} className="flex justify-between gap-3 text-body">
                <span>{o.label}</span>
                <span className="font-mono">
                  {t('countPct', { count: o.count, pct: pct(o.count, r.answered) })}
                </span>
              </li>
            ))}
          </ul>
        );
      case 'checkbox':
        return <p className="text-body">{t('checkboxLine', { yes: r.yes, answered: r.answered })}</p>;
      case 'number':
        return (
          <p className="text-body">
            {r.answered
              ? t('numberLine', { average: r.average ?? 0, min: r.min ?? 0, max: r.max ?? 0 })
              : t('answeredCount', { count: 0 })}
          </p>
        );
      case 'text':
        return r.latest.length ? (
          <ul aria-label={t('latestAnswers', { question: q.label })} className="flex flex-col gap-2">
            {r.latest.map((a, i) => (
              <li key={i} className="rounded-card bg-zinc-50 px-3 py-2 text-body whitespace-pre-line">
                {a}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-zinc-600">{t('answeredCount', { count: 0 })}</p>
        );
    }
  };

  return (
    <>
      <PageHeader
        title={s.title}
        description={
          s.kind === 'session_feedback' && s.sessionTitle
            ? t('kindSession', { session: s.sessionTitle })
            : t('kind.post_event')
        }
      />
      <p className="flex flex-wrap items-center gap-3">
        <Link href={base} className="text-body underline underline-offset-2">
          {t('back')}
        </Link>
        <span className="text-caption text-zinc-600" role="status">
          {s.closed ? t('status.closed') : t('status.open')}
        </span>
      </p>
      {s.closed ? <p className="text-body text-zinc-700">{t('closedNotice')}</p> : null}

      <section aria-labelledby="results-heading" className="flex flex-col gap-3">
        <h2 id="results-heading" className="text-section">
          {t('reportTitle')}
        </h2>
        <Card className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-caption text-zinc-600">{t('columns.invited')}</dt>
              <dd className="font-mono text-section">{n.format(s.invited)}</dd>
            </div>
            <div>
              <dt className="text-caption text-zinc-600">{t('columns.responded')}</dt>
              <dd className="font-mono text-section">{n.format(s.responded)}</dd>
            </div>
            <div>
              <dt className="text-caption text-zinc-600">{t('columns.rate')}</dt>
              <dd className="font-mono text-section">
                {s.rate === null ? t('noRate') : t('rate', { rate: s.rate })}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-zinc-600">{t('npsTitle')}</dt>
              <dd className="font-mono text-section">
                {detail.report.nps?.score === null || !detail.report.nps
                  ? t('noRate')
                  : detail.report.nps.score}
              </dd>
            </div>
          </dl>
          {detail.report.nps && detail.report.nps.answered > 0 ? (
            <dl aria-label={t('npsBreakdown')} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(['promoters', 'passives', 'detractors'] as const).map((k) => (
                <div key={k} className="rounded-card border border-zinc-200 px-3 py-2">
                  <dt className="text-caption text-zinc-600">{t(`bucket.${k}`)}</dt>
                  <dd className="font-mono text-body">
                    {t('countPct', {
                      count: detail.report.nps?.[k] ?? 0,
                      pct: pct(detail.report.nps?.[k] ?? 0, detail.report.nps?.answered ?? 0),
                    })}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </Card>
        {s.responded === 0 ? (
          <EmptyState title={t('noAnswers')} description={t('noAnswersHint')} />
        ) : (
          <ol className="flex flex-col gap-3">
            {detail.report.questions.map((q) => (
              <li key={q.key}>
                <Card className="flex flex-col gap-2">
                  <h3 className="text-body font-medium">{q.label}</h3>
                  <p className="text-caption text-zinc-600">
                    {t('answeredCount', { count: q.report.answered })}
                  </p>
                  {summary(q)}
                </Card>
              </li>
            ))}
          </ol>
        )}
        {canExport && s.responded > 0 ? (
          <StepUpForm
            action={exportSurveyAction.bind(null, org, event, survey)}
            className="flex flex-wrap gap-3"
          >
            <Button type="submit" variant="secondary" size="sm">
              {t('export')}
            </Button>
          </StepUpForm>
        ) : null}
        {sp.exportError ? (
          <p
            role="alert"
            className="rounded-card border border-pink-700 bg-pink-50 px-4 py-3 text-body text-pink-700"
          >
            {t('exportError', { reason: (await getTranslations())(errorMessageKey(sp.exportError)) })}
          </p>
        ) : null}
        {op ? (
          <section
            aria-labelledby="export-heading"
            className="flex flex-col gap-2 rounded-panel border border-zinc-200 bg-white px-5 py-4"
          >
            {opActive ? <AutoRefresh seconds={2} /> : null}
            <h3 id="export-heading" className="text-section">
              {t('exportTitle')}
            </h3>
            <p className="text-body" role="status">
              {op.status === 'done'
                ? tb('exportDone', { succeeded: n.format(op.succeeded) })
                : tb(`status.${op.status}`, {
                    processed: n.format(op.processed),
                    total: n.format(op.total),
                    succeeded: n.format(op.succeeded),
                    failed: n.format(op.failed),
                    undone: n.format(op.undone),
                  })}
            </p>
            {op.status === 'done' && op.hasFile ? (
              <a
                href={`${locale === 'en' ? '' : `/${locale}`}${base}/${survey}/exports/${op.id}`}
                className={buttonClass('primary', 'sm', 'self-start')}
                download
              >
                {tb('download')}
              </a>
            ) : null}
          </section>
        ) : null}
      </section>

      {canSend ? (
        <section aria-labelledby="send-heading" className="flex flex-col gap-3">
          <h2 id="send-heading" className="text-section">
            {t('sendTitle')}
          </h2>
          <Card>
            {s.closed ? (
              <p className="text-body text-zinc-700">{t('errors.closed')}</p>
            ) : !ended ? (
              <p className="text-body text-zinc-700">
                {t('notEnded', { subject, date: when.format(s.endsAt) })}
              </p>
            ) : (
              <SendSurveyForm
                action={sendSurveyAction.bind(null, org, event, survey)}
                idempotencyKey={uuidv7()}
              />
            )}
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="sends-heading" className="flex flex-col gap-3">
        <h2 id="sends-heading" className="text-section">
          {t('sendsTitle')}
        </h2>
        <Table
          caption={t('sendsTitle')}
          rowKey={(x) => x.id}
          rows={detail.sends}
          empty={t('sendsEmpty')}
          columns={[
            { key: 'at', header: t('sentAt'), cell: (x) => when.format(x.at) },
            { key: 'audience', header: t('audience'), cell: (x) => t(`audienceShort.${x.audience}`) },
            {
              key: 'recipients',
              header: t('recipients'),
              cell: (x) => x.recipients,
              mono: true,
              align: 'end',
            },
            {
              key: 'reminder',
              header: t('reminderColumn'),
              cell: (x) => (x.reminderDays ? t('reminderDays', { days: x.reminderDays }) : t('noReminder')),
            },
          ]}
        />
      </section>

      <section aria-labelledby="questions-heading" className="flex flex-col gap-3">
        <h2 id="questions-heading" className="text-section">
          {t('questionsTitle')}
        </h2>
        {canSend ? (
          <Card>
            <SurveyDetailsForm
              action={updateSurveyAction.bind(null, org, event, survey)}
              title={s.title}
              intro={s.intro}
              disabled={s.closed}
            />
          </Card>
        ) : null}
        {fields.length === 0 ? (
          <EmptyState
            title={t('questionsEmpty')}
            description={canSend ? t('questionsEmptyHint') : undefined}
          />
        ) : (
          <ol aria-label={t('questionsTitle')} className="flex flex-col gap-2">
            {fields.map((f, i) => (
              <li
                key={f.key}
                className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-zinc-200 bg-white px-4 py-3"
              >
                <span className="flex flex-col">
                  <span className="text-body">{f.label}</span>
                  <span className="text-caption text-zinc-500">
                    {t(`questionType.${f.type}`)} · {f.required ? t('required') : t('optional')}
                    {f.options.length ? ` · ${f.options.map((o) => o.label).join(', ')}` : ''}
                  </span>
                </span>
                {canSend && !s.closed ? (
                  <span className="flex gap-1">
                    <form action={moveSurveyQuestionAction.bind(null, org, event, survey, f.key, -1)}>
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        disabled={i === 0}
                        aria-label={t('moveUp', { label: f.label })}
                      >
                        ↑
                      </Button>
                    </form>
                    <form action={moveSurveyQuestionAction.bind(null, org, event, survey, f.key, 1)}>
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        disabled={i === fields.length - 1}
                        aria-label={t('moveDown', { label: f.label })}
                      >
                        ↓
                      </Button>
                    </form>
                    <form action={removeSurveyQuestionAction.bind(null, org, event, survey, f.key)}>
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        aria-label={t('remove', { label: f.label })}
                      >
                        {t('removeShort')}
                      </Button>
                    </form>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {canSend && !s.closed ? (
          <Card className="flex flex-col gap-3">
            <h3 className="text-section">{t('addTitle')}</h3>
            <AddSurveyQuestionForm action={addSurveyQuestionAction.bind(null, org, event, survey)} />
          </Card>
        ) : null}
        {canSend ? (
          <CloseSurveyForm
            action={setSurveyClosedAction.bind(null, org, event, survey, !s.closed)}
            closed={s.closed}
          />
        ) : null}
      </section>
    </>
  );
}
