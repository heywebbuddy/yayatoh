import { executeQuery } from '@yayatoh/kernel';
import { type CfpSubmissionRowDto, cfpOverviewQuery } from '@yayatoh/program';
import { Alert, buttonClass, EmptyState, StatusPill, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { formatMoment } from '@/lib/portal-format.ts';
import { ports } from '@/server/ports.ts';
import { loadProgramPage } from '@/server/program.ts';
import { CfpHeader, scoreText } from './cfp-header.tsx';

const TONE = { submitted: 'waiting', accepted: 'success', rejected: 'neutral' } as const;

/**
 * Call for papers, submissions (M5.3b): every proposal with its reviews so far (count and mean
 * score), opened one by one to assign reviewers and decide. Viewers read, never change.
 */
export default async function CfpSubmissionsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, ev, canWrite } = await loadProgramPage(org, event, 'speakers');
  const t = await getTranslations('cfp');
  const view = await executeQuery(cfpOverviewQuery, { eventId: ev.id }, data.ctx, ports);
  const base = `/o/${org}/e/${event}/speakers/cfp`;
  const columns = [
    {
      key: 'title',
      header: t('colTitle'),
      cell: (s: CfpSubmissionRowDto) => (
        <Link href={`${base}/${s.id}`} className="font-bold text-ink underline underline-offset-2">
          {s.title}
        </Link>
      ),
    },
    { key: 'speaker', header: t('colSpeaker'), cell: (s: CfpSubmissionRowDto) => s.speakerName },
    {
      key: 'length',
      header: t('colLength'),
      cell: (s: CfpSubmissionRowDto) => t('minutes', { count: s.durationMinutes }),
    },
    { key: 'track', header: t('colTrack'), cell: (s: CfpSubmissionRowDto) => s.track ?? '—' },
    {
      key: 'reviews',
      header: t('colReviews'),
      cell: (s: CfpSubmissionRowDto) => t('reviewsOf', { done: s.reviewCount, total: s.reviewerCount }),
    },
    {
      key: 'score',
      header: t('colScore'),
      cell: (s: CfpSubmissionRowDto) => <span className="tabular-nums">{scoreText(s.averageScore)}</span>,
    },
    {
      key: 'status',
      header: t('colStatus'),
      cell: (s: CfpSubmissionRowDto) => (
        <StatusPill tone={TONE[s.status]} label={t(`decision.${s.status}`)} />
      ),
    },
    {
      key: 'at',
      header: t('colSubmitted'),
      cell: (s: CfpSubmissionRowDto) => formatMoment(s.submittedAt, locale, ev.timezone),
    },
  ];
  const isPublic = view.call.status !== 'draft';
  return (
    <>
      <CfpHeader
        org={org}
        event={event}
        orgName={data.org.name}
        eventName={ev.name}
        status={view.call.status}
        active="submissions"
        counts={{ submissions: view.submissions.length, reviewers: view.reviewers.length }}
        actions={
          isPublic ? (
            <Link href={`/events/${ev.slug}/cfp`} className={buttonClass('secondary')}>
              {t('openPublicForm')}
            </Link>
          ) : canWrite ? (
            <Link href={`${base}/settings`} className={buttonClass('primary')}>
              {t('setUp')}
            </Link>
          ) : undefined
        }
      />
      {canWrite ? null : <Alert tone="info" title={t('viewerNotice')} />}
      <section aria-labelledby="submissions-heading" className="flex flex-col gap-3">
        <h2 id="submissions-heading" className="text-section">
          {t('submissionsHeading')}
        </h2>
        {view.submissions.length === 0 ? (
          <EmptyState title={t('emptyTitle')} description={isPublic ? t('emptyOpen') : t('emptyDraft')} />
        ) : (
          <Table
            caption={t('tableCaption')}
            columns={columns}
            rows={view.submissions}
            rowKey={(s) => s.id}
            stackOnPhone
          />
        )}
      </section>
    </>
  );
}
