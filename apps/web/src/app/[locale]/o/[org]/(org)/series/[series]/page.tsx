import { listEventsQuery, listSeriesQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { orgReportQuery } from '@yayatoh/reports';
import { roleCan } from '@yayatoh/tenancy';
import {
  Alert,
  Button,
  buttonClass,
  Card,
  type Column,
  EmptyState,
  PageHeader,
  StatusPill,
  Table,
} from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { fmtMoney } from '@/components/reports.tsx';
import { AddEventToSeriesForm } from '@/components/series-forms.tsx';
import { SeriesTabs } from '@/components/series-tabs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { eventPhase } from '@/lib/event-status.ts';
import { formatEventDateRange, formatNumber } from '@/lib/format.ts';
import { ports } from '@/server/ports.ts';
import { addEventToSeriesAction, removeEventFromSeriesAction } from './actions.ts';
import { loadSeries } from './data.ts';

type Row = Awaited<ReturnType<typeof loadSeries>>['series']['events'][number];

const tone = (status: Row['status'], phase: string) =>
  status === 'cancelled'
    ? 'danger'
    : phase === 'live'
      ? 'success'
      : status === 'draft' || status === 'postponed'
        ? 'waiting'
        : phase === 'completed' || status === 'archived'
          ? 'neutral'
          : 'info';

/**
 * U7: a series' Events tab — its events with status, dates and sales, adding and removing
 * events, and "Create next event in series" (a copy of the latest event's setup).
 */
export default async function SeriesEventsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; series: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { locale, org, series: slug } = await params;
  const { done } = await searchParams;
  setRequestLocale(locale);
  const { data, series } = await loadSeries(org, slug);
  const t = await getTranslations();
  const canWrite = roleCan(data.role, 'events:write');
  const showSales = data.modules.has('reports') && roleCan(data.role, 'orders:read');
  const [report, allEvents, allSeries] = await Promise.all([
    showSales ? executeQuery(orgReportQuery, {}, data.ctx, ports) : null,
    canWrite ? executeQuery(listEventsQuery, {}, data.ctx, ports) : [],
    canWrite ? executeQuery(listSeriesQuery, {}, data.ctx, ports) : [],
  ]);
  const sales = new Map((report?.byEvent ?? []).map((r) => [r.eventId, r] as const));
  const base = `/o/${org}/series/${series.slug}`;
  const when = (e: { startsAt: Date; endsAt: Date; timezone: string; currency: string }) =>
    formatEventDateRange(e.startsAt.toISOString(), e.endsAt.toISOString(), {
      locale,
      currency: e.currency,
      timeZone: e.timezone,
    });
  const inThis = new Set(series.events.map((e) => e.id));
  const seriesOf = new Map(allSeries.flatMap((s) => s.eventIds.map((id) => [id, s.name] as const)));
  const addable = allEvents
    .filter((e) => !inThis.has(e.id) && e.status !== 'archived')
    .map((e) => ({ id: e.id, name: e.name, when: when(e), otherSeries: seriesOf.get(e.id) ?? null }));

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: t('seriesPage.columns.event'),
      cell: (e) => (
        <Link href={`/o/${org}/e/${e.slug}`} className="font-semibold underline underline-offset-2">
          {e.name}
        </Link>
      ),
    },
    {
      key: 'status',
      header: t('seriesPage.columns.status'),
      cell: (e) => {
        const phase = eventPhase(e.startsAt.toISOString(), e.endsAt.toISOString());
        return (
          <StatusPill
            tone={tone(e.status, phase.phase)}
            label={`${t(`eventStatus.${e.status}`)} · ${t(`phase.${phase.phase}`, { days: phase.days })}`}
          />
        );
      },
    },
    { key: 'dates', header: t('seriesPage.columns.dates'), cell: (e) => when(e) },
    ...(showSales
      ? [
          {
            key: 'sales',
            header: t('seriesPage.columns.sales'),
            align: 'end' as const,
            cell: (e: Row) => {
              const s = sales.get(e.id);
              return s ? (
                <span className="flex flex-col items-end tabular-nums">
                  <span>
                    {t('seriesPage.sold', { count: s.tickets, n: formatNumber(s.tickets, locale) })}
                  </span>
                  <span className="text-caption text-ink-2">
                    {fmtMoney(s.grossMinor, s.currency, locale)}
                  </span>
                </span>
              ) : (
                <span className="text-ink-2">{t('seriesPage.noSales')}</span>
              );
            },
          },
        ]
      : []),
    ...(canWrite
      ? [
          {
            key: 'actions',
            header: t('seriesPage.columns.actions'),
            align: 'end' as const,
            cell: (e: Row) => (
              <form action={removeEventFromSeriesAction.bind(null, org, series.slug, e.id)}>
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  aria-label={t('seriesPage.removeFor', { name: e.name })}
                >
                  {t('seriesPage.remove')}
                </Button>
              </form>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${org}/series`} className="text-caption text-ink-2 underline underline-offset-2">
            {t('seriesPage.back')}
          </Link>
        }
        title={series.name}
        description={series.description ?? undefined}
        actions={
          <>
            {canWrite && series.events.length > 0 ? (
              <Link href={`${base}/next`} className={buttonClass('primary')}>
                {t('seriesPage.createNext')}
              </Link>
            ) : null}
            <Link href={`/series/${series.slug}`} className={buttonClass('secondary')}>
              {t('series.publicPage')}
            </Link>
          </>
        }
      />
      <SeriesTabs base={base} active="events" />
      <div aria-live="polite">
        {done === 'added' ? <Alert tone="info" title={t('seriesPage.added')} /> : null}
        {done === 'removed' ? <Alert tone="info" title={t('seriesPage.removed')} /> : null}
      </div>
      <section aria-labelledby="series-events-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="series-events-heading" className="text-section">
            {t('seriesPage.eventsHeading', { count: series.events.length })}
          </h2>
          {canWrite && series.events.length > 0 ? (
            <Link href={`/o/${org}/events/new?series=${series.id}`} className={buttonClass('ghost', 'sm')}>
              {t('seriesPage.createIn')}
            </Link>
          ) : null}
        </div>
        {series.events.length === 0 ? (
          <EmptyState
            title={t('seriesPage.emptyTitle')}
            description={canWrite ? t('seriesPage.emptyDescription') : t('seriesPage.emptyReadOnly')}
            action={
              canWrite ? (
                <Link href={`/o/${org}/events/new?series=${series.id}`} className={buttonClass('primary')}>
                  {t('seriesPage.createIn')}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <Table
            caption={t('seriesPage.caption', { name: series.name })}
            rowKey={(e) => e.id}
            rows={series.events}
            columns={columns}
          />
        )}
      </section>
      {canWrite && addable.length > 0 ? (
        <section aria-labelledby="series-add-heading" className="flex flex-col gap-3">
          <h2 id="series-add-heading" className="text-section">
            {t('seriesPage.add.heading')}
          </h2>
          <Card>
            <AddEventToSeriesForm
              action={addEventToSeriesAction.bind(null, org, series.slug)}
              events={addable}
            />
          </Card>
        </section>
      ) : null}
    </>
  );
}
