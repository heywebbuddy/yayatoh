import {
  listReportRunsQuery,
  listReportSchedulesQuery,
  periodLabel,
  periodOfKey,
  type ReportFrequency,
  type ReportScheduleDto,
} from '@yayatoh/analytics';
import { listEventsQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, buttonClass, EmptyState, PageHeader, StatusPill, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ReportScheduleForm, RowActionForm } from '@/components/analytics-pro-forms.tsx';
import { AnalyticsTabs } from '@/components/analytics-tabs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { hourLabels, reportRecipients } from '@/server/analytics-pro.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createScheduleAction, deleteScheduleAction, toggleScheduleAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('analyticsPro.reports');
  return { title: t('title') };
}

const DONE = ['created', 'saved', 'on', 'off', 'deleted'] as const;

/**
 * Scheduled PDF reports (M6.2b): owners and admins schedule them (frequency, send hour in the
 * org's time zone, an event filter, member recipients); every member who reads orders sees the
 * recent periods and opens their own PDF (their language; revenue only with finance).
 */
export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const data = await loadConsole(org);
  if (!data.modules.has('analytics_pro') || !roleCan(data.role, 'orders:read')) notFound();
  const t = await getTranslations('analyticsPro.reports');
  const te = await getTranslations('emptyActions');
  const canManage = roleCan(data.role, 'org:update');
  const schedules = canManage ? await executeQuery(listReportSchedulesQuery, {}, data.ctx, ports) : [];
  const runs = await executeQuery(listReportRunsQuery, { locale }, data.ctx, ports);
  const events = canManage ? await executeQuery(listEventsQuery, {}, data.ctx, ports) : [];
  const members = canManage ? await reportRecipients(data, (name) => t('you', { name })) : [];
  const timeZone = schedules[0]?.timeZone ?? (data.org as { timezone?: string }).timezone ?? 'UTC';
  const done = DONE.find((d) => d === sp.done);
  const doneText = done
    ? {
        created: t('created'),
        saved: t('saved'),
        on: t('turnedOn'),
        off: t('turnedOff'),
        deleted: t('deleted'),
      }[done]
    : null;
  const when = (d: Date, tz: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(d);

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <AnalyticsTabs org={org} current="reports" />
      {doneText ? (
        <div role="status">
          <Alert tone="success" title={doneText} />
        </div>
      ) : null}
      {canManage ? (
        <>
          <div id="new-report" className="contents">
            <ReportScheduleForm
              action={createScheduleAction.bind(null, org)}
              mode="create"
              events={events.map((e) => ({ id: e.id, name: e.name }))}
              members={members}
              hours={hourLabels(locale)}
              timeZone={timeZone}
              initial={{
                name: '',
                frequency: 'weekly',
                sendHour: 8,
                eventId: '',
                recipients: data.ctx.actor.type === 'user' ? [data.ctx.actor.userId] : [],
              }}
            />
          </div>
          {schedules.length === 0 ? (
            <EmptyState
              title={t('emptyTitle')}
              description={t('emptyBody')}
              action={
                <Link href="#new-report" className={buttonClass('primary', 'md')}>
                  {te('scheduleReport')}
                </Link>
              }
            />
          ) : (
            <Table
              caption={t('list')}
              captionHidden={false}
              density="compact"
              stackOnPhone
              rowKey={(s) => s.id}
              rows={schedules}
              columns={[
                {
                  key: 'name',
                  header: t('columns.name'),
                  cell: (s) => <span className="font-semibold">{s.name}</span>,
                },
                {
                  key: 'frequency',
                  header: t('columns.frequency'),
                  cell: (s) => t(`frequencyShort.${s.frequency}`),
                },
                {
                  key: 'next',
                  header: t('columns.next'),
                  cell: (s) => (s.nextSendAt ? when(s.nextSendAt, s.timeZone) : '—'),
                },
                {
                  key: 'recipients',
                  header: t('columns.recipients'),
                  cell: (s) => t('recipientsCount', { count: s.recipients.length }),
                },
                {
                  key: 'status',
                  header: t('columns.status'),
                  cell: (s) => (
                    <StatusPill
                      tone={s.enabled ? 'success' : 'neutral'}
                      label={t(s.enabled ? 'status.on' : 'status.off')}
                    />
                  ),
                },
                {
                  key: 'actions',
                  header: t('columns.actions'),
                  cell: (s: ReportScheduleDto) => (
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/o/${org}/analytics/reports/${s.id}`}
                        className={buttonClass('secondary', 'sm')}
                        aria-label={t('editLabel', { name: s.name })}
                      >
                        {t('edit')}
                      </Link>
                      <RowActionForm
                        action={toggleScheduleAction.bind(null, org)}
                        fields={{ scheduleId: s.id, enabled: s.enabled ? '0' : '1' }}
                        label={s.enabled ? t('turnOff') : t('turnOn')}
                        ariaLabel={
                          s.enabled ? t('turnOffLabel', { name: s.name }) : t('turnOnLabel', { name: s.name })
                        }
                      />
                      <RowActionForm
                        action={deleteScheduleAction.bind(null, org)}
                        fields={{ scheduleId: s.id }}
                        label={t('delete')}
                        ariaLabel={t('deleteLabel', { name: s.name })}
                        variant="ghost"
                      />
                    </div>
                  ),
                },
              ]}
            />
          )}
        </>
      ) : null}
      <Table
        caption={t('recent')}
        captionHidden={false}
        density="compact"
        stackOnPhone
        rowKey={(r) => r.id}
        rows={runs}
        empty={t('recentEmpty')}
        columns={[
          { key: 'report', header: t('recentColumns.report'), cell: (r) => r.scheduleName },
          {
            key: 'period',
            header: t('recentColumns.period'),
            cell: (r) => {
              const p = periodOfKey(r.periodKey);
              // The period's own kind (its key), whatever the schedule's frequency is now.
              const f: ReportFrequency = r.periodKey.startsWith('D')
                ? 'daily'
                : r.periodKey.startsWith('W')
                  ? 'weekly'
                  : 'monthly';
              return p ? periodLabel(p, f, locale) : r.periodKey;
            },
          },
          {
            key: 'status',
            header: t('recentColumns.status'),
            cell: (r) => (
              <StatusPill
                tone={r.status === 'sent' ? 'success' : r.status === 'failed' ? 'danger' : 'waiting'}
                label={t(`runStatus.${r.status}`)}
              />
            ),
          },
          {
            key: 'file',
            header: t('recentColumns.file'),
            cell: (r) => {
              const p = periodOfKey(r.periodKey);
              return r.fileId ? (
                <a
                  href={`/o/${org}/analytics/reports/files/${r.fileId}`}
                  className="inline-flex min-h-6 items-center font-semibold text-primary underline-offset-2 hover:underline"
                  aria-label={t('downloadLabel', {
                    name: r.scheduleName,
                    period: p ? `${p.from} – ${p.to}` : r.periodKey,
                  })}
                  data-testid={`report-download-${r.periodKey}`}
                >
                  {t('download')}
                </a>
              ) : (
                <span className="text-ink-2">{t('notReady')}</span>
              );
            },
          },
        ]}
      />
    </>
  );
}
