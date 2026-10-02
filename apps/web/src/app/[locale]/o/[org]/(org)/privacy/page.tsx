import { executeQuery } from '@yayatoh/kernel';
import { type DsarRequestDto, requestsQuery } from '@yayatoh/privacy';
import { roleCan } from '@yayatoh/tenancy';
import { EmptyState, PageHeader, SectionHeader, StatusPill, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PrivacyConsole } from '@/components/privacy-console.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { findPersonAction, openRequestAction } from './actions.ts';

/**
 * Privacy requests (M1.14c, M6.1c): find a person across every module, open an access or erasure
 * request, and work the queue (open requests by due date; then closed ones). Owners and admins.
 */
export default async function PrivacyPage({ params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations();
  if (!roleCan(data.role, 'privacy:manage')) {
    return (
      <>
        <PageHeader title={t('privacy.title')} />
        <EmptyState title={t('privacy.noAccessTitle')} description={t('privacy.noAccessDescription')} />
      </>
    );
  }
  const { open, closed } = await executeQuery(requestsQuery, { limit: 50 }, data.ctx, ports);
  const date = new Intl.DateTimeFormat(locale, { timeZone: data.org.timezone, dateStyle: 'medium' });
  const review = (r: DsarRequestDto) => (
    <Link
      href={`/o/${org}/privacy/requests/${r.id}`}
      className="inline-flex min-h-6 items-center text-body underline underline-offset-2"
    >
      {t('privacy.queue.review')}
      <span className="sr-only"> {r.subjectHint}</span>
    </Link>
  );
  return (
    <>
      <PageHeader
        title={t('privacy.title')}
        description={t('privacy.description')}
        actions={
          <Link href="/privacy" className="text-body underline underline-offset-2">
            {t('privacy.noticeLink')}
          </Link>
        }
      />
      <PrivacyConsole find={findPersonAction.bind(null, org)} open={openRequestAction.bind(null, org)} org={org} />
      <section aria-labelledby="dsar-open" className="flex flex-col gap-3">
        <SectionHeader id="dsar-open" title={t('privacy.queue.title')} count={open.length} />
        {open.length === 0 ? (
          <EmptyState title={t('privacy.queue.emptyTitle')} description={t('privacy.queue.empty')} />
        ) : (
          <Table
            caption={t('privacy.queue.caption')}
            rowKey={(r) => r.id}
            rows={open}
            columns={[
              { key: 'subject', header: t('privacy.queue.person'), cell: (r) => r.subjectHint, mono: true },
              { key: 'kind', header: t('privacy.queue.kind'), cell: (r) => t(`privacy.kinds.${r.kind}`) },
              { key: 'source', header: t('privacy.queue.source'), cell: (r) => t(`privacy.sources.${r.source}`) },
              {
                key: 'opened',
                header: t('privacy.queue.opened'),
                cell: (r) => <time dateTime={r.createdAt.toISOString()}>{date.format(r.createdAt)}</time>,
              },
              {
                key: 'due',
                header: t('privacy.queue.due'),
                cell: (r) =>
                  r.dueAt ? (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <time dateTime={r.dueAt.toISOString()}>{date.format(r.dueAt)}</time>
                      {r.overdue ? <StatusPill tone="danger" label={t('privacy.queue.overdue')} /> : null}
                    </span>
                  ) : (
                    '—'
                  ),
              },
              { key: 'review', header: t('privacy.queue.action'), cell: review, align: 'end' },
            ]}
          />
        )}
      </section>
      <section aria-labelledby="dsar-closed" className="flex flex-col gap-3">
        <SectionHeader id="dsar-closed" title={t('privacy.closed.title')} />
        <Table
          caption={t('privacy.closed.caption')}
          rowKey={(r) => r.id}
          rows={closed}
          empty={t('privacy.closed.empty')}
          columns={[
            {
              key: 'at',
              header: t('privacy.closed.when'),
              cell: (r) => {
                const at = r.completedAt ?? r.cancelledAt ?? r.createdAt;
                return <time dateTime={at.toISOString()}>{date.format(at)}</time>;
              },
            },
            { key: 'kind', header: t('privacy.queue.kind'), cell: (r) => t(`privacy.kinds.${r.kind}`) },
            { key: 'subject', header: t('privacy.queue.person'), cell: (r) => r.subjectHint, mono: true },
            {
              key: 'status',
              header: t('privacy.closed.status'),
              cell: (r) => (
                <StatusPill
                  tone={r.status === 'completed' ? 'success' : 'neutral'}
                  label={t(`privacy.statuses.${r.status}`)}
                />
              ),
            },
            {
              key: 'records',
              header: t('privacy.closed.records'),
              cell: (r) => Object.values(r.summary).reduce((a, b) => a + b, 0),
              mono: true,
              align: 'end',
            },
            { key: 'review', header: t('privacy.queue.action'), cell: review, align: 'end' },
          ]}
        />
      </section>
    </>
  );
}
