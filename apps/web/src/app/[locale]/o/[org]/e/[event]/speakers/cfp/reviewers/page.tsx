import { executeQuery } from '@yayatoh/kernel';
import { type CfpReviewerDto, cfpOverviewQuery } from '@yayatoh/program';
import { Alert, Card, EmptyState, StatusPill, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionButtonForm } from '@/components/portal-admin-forms.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { ports } from '@/server/ports.ts';
import { loadProgramPage } from '@/server/program.ts';
import { addReviewerAction, revokeReviewerAction } from '../actions.ts';
import { CfpHeader } from '../cfp-header.tsx';

const TONE = {
  invited: 'waiting',
  active: 'success',
  revoked: 'neutral',
  expired: 'neutral',
  none: 'neutral',
} as const;

/**
 * Call for papers, reviewers (M5.3b): reviewers are portal accounts (P5-7, event role
 * `cfp_reviewer`): invited by email, they sign in with a code or magic link and see only the
 * submissions assigned to them. Re-adding an address emails a fresh invitation.
 */
export default async function CfpReviewersPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, ev, canWrite } = await loadProgramPage(org, event, 'speakers');
  const t = await getTranslations('cfp');
  const view = await executeQuery(cfpOverviewQuery, { eventId: ev.id }, data.ctx, ports);
  const columns = [
    { key: 'name', header: t('colReviewer'), cell: (r: CfpReviewerDto) => r.name },
    { key: 'email', header: t('colEmail'), cell: (r: CfpReviewerDto) => r.email },
    {
      key: 'access',
      header: t('colAccess'),
      cell: (r: CfpReviewerDto) => <StatusPill tone={TONE[r.access]} label={t(`access.${r.access}`)} />,
    },
    {
      key: 'progress',
      header: t('colProgress'),
      cell: (r: CfpReviewerDto) => t('reviewsOf', { done: r.reviewed, total: r.assigned }),
    },
    ...(canWrite
      ? [
          {
            key: 'actions',
            header: t('colActions'),
            cell: (r: CfpReviewerDto) =>
              r.accountId && (r.access === 'invited' || r.access === 'active') ? (
                <ActionButtonForm
                  action={revokeReviewerAction.bind(null, org, event, r.accountId)}
                  label={t('revoke', { name: r.name })}
                  successLabel={t('revoked')}
                  variant="ghost"
                />
              ) : (
                '—'
              ),
          },
        ]
      : []),
  ];
  return (
    <>
      <CfpHeader
        org={org}
        event={event}
        orgName={data.org.name}
        eventName={ev.name}
        status={view.call.status}
        active="reviewers"
        counts={{ submissions: view.submissions.length, reviewers: view.reviewers.length }}
      />
      {canWrite ? null : <Alert tone="info" title={t('viewerNotice')} />}
      <section aria-labelledby="reviewers-heading" className="flex flex-col gap-3">
        <h2 id="reviewers-heading" className="text-section">
          {t('reviewersHeading')}
        </h2>
        <p className="text-caption text-ink-2">{t('reviewersHint')}</p>
        {view.reviewers.length === 0 ? (
          <EmptyState title={t('noReviewersTitle')} description={t('noReviewersDescription')} />
        ) : (
          <Table
            caption={t('reviewersCaption')}
            columns={columns}
            rows={view.reviewers}
            rowKey={(r) => r.id}
            stackOnPhone
          />
        )}
      </section>
      {canWrite ? (
        <section aria-labelledby="add-reviewer-heading">
          <Card size="panel" className="flex flex-col gap-3">
            <h2 id="add-reviewer-heading" className="text-section">
              {t('addReviewer')}
            </h2>
            <ProgramForm
              action={addReviewerAction.bind(null, org, event)}
              idPrefix="cfp-reviewer"
              submitLabel={t('inviteReviewer')}
              successLabel={t('reviewerInvited')}
              reset
              errors={{
                name: t('errors.reviewerName'),
                email: t('errors.email'),
                event_over: t('errors.eventOver'),
                too_many: t('errors.tooManyReviewers'),
              }}
              fields={[
                { kind: 'text', name: 'name', label: t('reviewerName'), required: true, maxLength: 120 },
                { kind: 'text', name: 'email', label: t('reviewerEmail'), required: true, maxLength: 254 },
              ]}
            />
          </Card>
        </section>
      ) : null}
    </>
  );
}
