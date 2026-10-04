import { type EVENT_MODES, type OrgOverviewDto, orgOverviewQuery } from '@yayatoh/command-center';
import { executeQuery, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import { applyUnpublishedMetricEvents } from '@yayatoh/reports';
import { buttonClass, EmptyState, PageHeader, ProgressBar, StatCard, StatusDot, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { commandCenterCtx } from '@/server/command-center.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

const DOT = { planning: 'neutral', pre_show: 'warning', live: 'success', wrap: 'info' } as const;
/** Live first, then the ones about to start, being planned, wrapping up (the query's order). */
const GROUPS = [
  'live',
  'pre_show',
  'planning',
  'wrap',
] as const satisfies readonly (typeof EVENT_MODES)[number][];

type Row = OrgOverviewDto['events'][number];

/**
 * The multi-event Command Center overview (M3.2a; U4): the org's events that are live, in
 * pre-show, being planned or wrapping up, grouped by mode with a count per mode on top; each row
 * has its sales and tickets (only for members who read the money: never the door, never a viewer
 * without `orders:read`) and its readiness, and opens its own Command Center.
 */
export default async function CommandCenterOverviewPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('commandCenter');
  let overview: OrgOverviewDto;
  try {
    // The sales and ticket figures come from the metric projection: catch up first.
    if (data.modules.has('reports')) await applyUnpublishedMetricEvents(data.org.id);
    overview = await executeQuery(orgOverviewQuery, {}, await commandCenterCtx(data.ctx), ports);
  } catch (err) {
    if (!isDomainError(err) || err.code !== 'forbidden') throw err;
    return (
      <>
        <PageHeader title={t('overviewTitle')} />
        <EmptyState
          title={t('noAccess.title')}
          description={t('noAccess.description')}
          action={
            <Link href={`/o/${org}/team`} className={buttonClass('primary', 'md')}>
              {t('noAccess.action')}
            </Link>
          }
        />
      </>
    );
  }
  const when = (iso: string, timeZone: string) =>
    new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);
  const showSales = overview.events.some((e) => e.sales !== null);
  const showTickets = overview.events.some((e) => e.tickets !== null);
  const showReadiness = overview.events.some((e) => e.readiness !== null);
  const count = (mode: (typeof GROUPS)[number]) => overview.events.filter((e) => e.mode === mode).length;
  const columns = [
    {
      key: 'event',
      header: t('columns.event'),
      cell: (e: Row) => (
        <Link
          href={`/o/${org}/e/${e.slug}/command-center`}
          className="inline-flex min-h-6 items-center font-medium underline underline-offset-2"
        >
          {e.name}
        </Link>
      ),
    },
    {
      key: 'mode',
      header: t('columns.mode'),
      cell: (e: Row) => (
        <span className="inline-flex flex-wrap items-center gap-2" data-testid="cc-overview-mode">
          <StatusDot status={DOT[e.mode]} label={t(`mode.${e.mode}`)} live={e.mode === 'live'} />
          {e.overridden ? <span className="text-caption text-ink-2">{t('manual')}</span> : null}
        </span>
      ),
    },
    { key: 'starts', header: t('columns.starts'), cell: (e: Row) => when(e.startsAt, e.timeZone) },
    ...(showSales
      ? [
          {
            key: 'sales',
            header: t('columns.sales'),
            align: 'end' as const,
            cell: (e: Row) => (
              <span className="tabular-nums" data-testid="cc-overview-sales">
                {e.sales === null
                  ? '—'
                  : e.sales.map((l) => formatMoney(money(l.total, l.currency), locale)).join(' · ')}
              </span>
            ),
          },
        ]
      : []),
    ...(showTickets
      ? [
          {
            key: 'tickets',
            header: t('columns.tickets'),
            align: 'end' as const,
            cell: (e: Row) => (
              <span className="tabular-nums" data-testid="cc-overview-tickets">
                {e.tickets === null
                  ? '—'
                  : e.tickets.capacity > 0
                    ? t('soldOf', { sold: num(e.tickets.sold), capacity: num(e.tickets.capacity) })
                    : num(e.tickets.sold)}
              </span>
            ),
          },
        ]
      : []),
    ...(showReadiness
      ? [
          {
            key: 'readiness',
            header: t('columns.readiness'),
            cell: (e: Row) =>
              e.readiness === null ? (
                '—'
              ) : (
                <span className="flex min-w-28 flex-col gap-1" data-testid="cc-overview-readiness">
                  <span className="tabular-nums">
                    {new Intl.NumberFormat(locale, { style: 'percent' }).format(e.readiness / 100)}
                  </span>
                  <ProgressBar
                    value={e.readiness}
                    label={t('widget.readiness.score', { score: e.readiness })}
                    tone={e.readiness === 100 ? 'success' : 'primary'}
                  />
                </span>
              ),
          },
        ]
      : []),
  ];
  return (
    <>
      <PageHeader title={t('overviewTitle')} description={t('overviewDescription')} />
      <section aria-labelledby="cc-overview-counts" className="flex flex-col gap-2">
        <h2 id="cc-overview-counts" className="sr-only">
          {t('overviewCounts')}
        </h2>
        <ul
          className="m-0 grid list-none grid-cols-2 gap-3.5 p-0 md:grid-cols-4"
          data-testid="cc-overview-counts"
        >
          {GROUPS.map((m) => (
            <li key={m} className="[&>*]:h-full">
              <StatCard
                testId={`cc-overview-count-${m}`}
                label={<StatusDot status={DOT[m]} label={t(`mode.${m}`)} live={m === 'live'} />}
                value={num(count(m))}
              />
            </li>
          ))}
        </ul>
      </section>
      {overview.total > overview.events.length ? (
        <p className="text-caption text-ink-2">
          {t('overviewTruncated', { shown: overview.events.length, total: overview.total })}
        </p>
      ) : null}
      {overview.events.length === 0 ? (
        <EmptyState
          title={t('overviewEmpty.title')}
          description={t('overviewEmpty.description')}
          action={
            <Link href={`/o/${org}/events`} className={buttonClass('primary', 'md')}>
              {t('overviewEmpty.action')}
            </Link>
          }
        />
      ) : (
        GROUPS.filter((m) => count(m) > 0).map((m) => (
          <section key={m} aria-labelledby={`cc-group-${m}`} className="flex flex-col gap-3">
            <h2 id={`cc-group-${m}`} className="m-0 text-section">
              {t(`overviewGroup.${m}`, { count: count(m) })}
            </h2>
            <Table
              caption={t(`overviewGroup.${m}`, { count: count(m) })}
              rowKey={(e) => e.eventId}
              rows={overview.events.filter((e) => e.mode === m)}
              columns={columns}
              stackOnPhone
            />
          </section>
        ))
      )}
    </>
  );
}
