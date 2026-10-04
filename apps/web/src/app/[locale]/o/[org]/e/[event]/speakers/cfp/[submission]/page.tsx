import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { cfpOverviewQuery, cfpSubmissionQuery } from '@yayatoh/program';
import { Alert, buttonClass, Card, EmptyState, StatusPill } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionButtonForm, DecideForm } from '@/components/portal-admin-forms.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatMoment } from '@/lib/portal-format.ts';
import { ports } from '@/server/ports.ts';
import { loadProgramPage } from '@/server/program.ts';
import { assignReviewerAction, decideSubmissionAction, unassignReviewerAction } from '../actions.ts';
import { CfpHeader, scoreText } from '../cfp-header.tsx';

const TONE = { submitted: 'waiting', accepted: 'success', rejected: 'neutral' } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One proposal (M5.3b): what was submitted (speaker, co-speakers, custom answers), the reviewers
 * assigned and their scores and comments, and the decision. Accepting creates the speakers and
 * one draft session (placed later on the sessions page); the speakers are emailed either way.
 */
export default async function CfpSubmissionPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string; submission: string }>;
}) {
  const { locale, org, event, submission } = await params;
  setRequestLocale(locale);
  if (!UUID.test(submission)) notFound();
  const { data, ev, canWrite } = await loadProgramPage(org, event, 'speakers');
  const t = await getTranslations('cfp');
  const s = await executeQuery(
    cfpSubmissionQuery,
    { eventId: ev.id, submissionId: submission },
    data.ctx,
    ports,
  ).catch((err) => {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  });
  const view = await executeQuery(cfpOverviewQuery, { eventId: ev.id }, data.ctx, ports);
  const tz = ev.timezone;
  const open = s.status === 'submitted';
  return (
    <>
      <CfpHeader
        org={org}
        event={event}
        orgName={data.org.name}
        eventName={ev.name}
        status={view.call.status}
        active={null}
        counts={{ submissions: view.submissions.length, reviewers: view.reviewers.length }}
        title={s.title}
        crumb={s.title}
      />
      {canWrite ? null : <Alert tone="info" title={t('viewerNotice')} />}
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill tone={TONE[s.status]} label={t(`decision.${s.status}`)} />
        <span className="text-caption text-ink-2">
          {t('submittedOn', { date: formatMoment(s.submittedAt, locale, tz) })} ·{' '}
          {t('minutes', { count: s.durationMinutes })}
          {s.track ? ` · ${s.track}` : ''}
        </span>
      </div>
      <section aria-labelledby="proposal-heading">
        <Card className="flex flex-col gap-3">
          <h2 id="proposal-heading" className="text-section">
            {t('abstractHeading')}
          </h2>
          <p className="m-0 whitespace-pre-line text-body text-ink">{s.abstract}</p>
          {s.answers.length ? (
            <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-1 text-body sm:grid-cols-[auto_1fr]">
              {s.answers.map((a) => (
                <div key={a.label} className="contents">
                  <dt className="font-bold text-ink">{a.label}</dt>
                  <dd className="m-0 text-ink-2">{a.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </Card>
      </section>
      <section aria-labelledby="people-heading">
        <Card className="flex flex-col gap-2">
          <h2 id="people-heading" className="text-section">
            {t('speakersHeading')}
          </h2>
          <p className="m-0 text-body font-bold text-ink">
            {s.speakerName}
            <span className="font-normal text-ink-2">
              {[s.speakerTitle, s.speakerCompany].filter(Boolean).length
                ? ` · ${[s.speakerTitle, s.speakerCompany].filter(Boolean).join(', ')}`
                : ''}
            </span>
          </p>
          <p className="m-0 text-caption text-ink-2">{s.speakerEmail}</p>
          {s.speakerBio ? (
            <p className="m-0 whitespace-pre-line text-body text-ink-2">{s.speakerBio}</p>
          ) : null}
          {s.coSpeakers.length ? (
            <p className="m-0 text-body text-ink-2">
              {t('coSpeakersList', { names: s.coSpeakers.map((c) => `${c.name} (${c.email})`).join(', ') })}
            </p>
          ) : null}
        </Card>
      </section>
      <section aria-labelledby="reviews-heading" className="flex flex-col gap-3">
        <h2 id="reviews-heading" className="text-section">
          {t('reviewsHeading', { score: scoreText(s.averageScore) })}
        </h2>
        {s.reviews.length === 0 ? (
          <EmptyState
            title={t('noReviewsTitle')}
            description={canWrite && open ? t('noReviewsAssign') : t('noReviewsDescription')}
            action={
              <Link
                href={`/o/${org}/e/${event}/speakers/cfp/reviewers`}
                className={buttonClass('secondary', 'md')}
              >
                {t('reviewersHeading')}
              </Link>
            }
          />
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-card border border-line bg-surface p-0 glass">
            {s.reviews.map((r) => (
              <li key={r.reviewerId} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
                <span className="flex flex-col gap-0.5">
                  <span className="text-body font-bold text-ink">
                    {r.reviewerName} ·{' '}
                    <span className="tabular-nums">
                      {r.score === null ? t('notReviewed') : t('scoreOf', { score: r.score })}
                    </span>
                  </span>
                  {r.comment ? (
                    <span className="whitespace-pre-line text-body text-ink-2">{r.comment}</span>
                  ) : null}
                </span>
                {canWrite && open ? (
                  <ActionButtonForm
                    action={unassignReviewerAction.bind(null, org, event, s.id, r.reviewerId)}
                    label={t('unassign', { name: r.reviewerName })}
                    successLabel={t('unassigned')}
                    variant="ghost"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canWrite && open ? (
          s.unassigned.length ? (
            <Card className="flex flex-col gap-3">
              <h3 className="text-card">{t('assignHeading')}</h3>
              <ProgramForm
                action={assignReviewerAction.bind(null, org, event, s.id)}
                idPrefix="assign"
                submitLabel={t('assign')}
                successLabel={t('assigned')}
                errors={{ reviewerId: t('errors.reviewer'), already_assigned: t('errors.alreadyAssigned') }}
                fields={[
                  {
                    kind: 'select',
                    name: 'reviewerId',
                    label: t('reviewerLabel'),
                    options: s.unassigned.map((r) => ({ value: r.id, label: r.name })),
                  },
                ]}
              />
            </Card>
          ) : (
            <p className="text-body text-ink-2">
              {t('allAssigned')}{' '}
              <Link
                href={`/o/${org}/e/${event}/speakers/cfp/reviewers`}
                className="underline underline-offset-2"
              >
                {t('addReviewersLink')}
              </Link>
            </p>
          )
        ) : null}
      </section>
      <section aria-labelledby="decision-heading" className="flex flex-col gap-3">
        <h2 id="decision-heading" className="text-section">
          {t('decisionHeading')}
        </h2>
        {open ? (
          canWrite ? (
            <Card className="flex flex-col gap-3">
              <p className="m-0 text-caption text-ink-2">{t('decisionHint')}</p>
              <DecideForm
                action={decideSubmissionAction.bind(null, org, event, s.id)}
                approveLabel={t('accept')}
                rejectLabel={t('reject')}
                noteLabel={t('noteLabel')}
                successLabel={t('decided')}
                errors={{ decided: t('errors.decided'), too_many: t('errors.tooManySessions') }}
              />
            </Card>
          ) : (
            <p className="text-body text-ink-2">{t('undecided')}</p>
          )
        ) : (
          <Card className="flex flex-col gap-2">
            <p className="m-0 text-body text-ink">
              {t(s.status === 'accepted' ? 'acceptedOn' : 'rejectedOn', {
                date: s.decidedAt ? formatMoment(s.decidedAt, locale, tz) : '—',
              })}
            </p>
            <p className="m-0 text-caption text-ink-2">{t('emailedNotice')}</p>
            {s.decisionNote ? (
              <p className="m-0 text-body text-ink-2">{t('noteSent', { note: s.decisionNote })}</p>
            ) : null}
            {s.status === 'accepted' && s.sessionId ? (
              <Link
                href={`/o/${org}/e/${event}/sessions`}
                className={`${buttonClass('secondary')} self-start`}
              >
                {t('placeSessionLink')}
              </Link>
            ) : null}
          </Card>
        )}
      </section>
    </>
  );
}
