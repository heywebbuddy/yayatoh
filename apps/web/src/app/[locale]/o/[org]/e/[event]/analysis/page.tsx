import { currencyExponent, executeQuery } from '@yayatoh/kernel';
import { eventReportQuery } from '@yayatoh/reports';
import { roleCan } from '@yayatoh/tenancy';
import { BarChart, Card, ChartTable, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  AsOf,
  countOf,
  fmtMoney,
  fmtPercent,
  Kpi,
  KpiGrid,
  metricText,
  ReportTabs,
} from '@/components/reports.tsx';
import { formatNumber } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/** The event's report (M1.12): key numbers, sales by day, ticket type, channel, status and code. */
export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event);
  const t = await getTranslations();
  const base = `/o/${org}/e/${event}/analysis`;
  if (!data.modules.has('reports') || !roleCan(data.role, 'orders:read')) {
    return (
      <>
        <PageHeader title={t('reports.title')} description={ev.name} />
        <EmptyState title={t('reports.noAccessTitle')} description={t('reports.noAccessDescription')} />
      </>
    );
  }
  const r = await executeQuery(eventReportQuery, { eventId: ev.id }, data.ctx, ports);
  const finance = roleCan(data.role, 'finance:read');
  const m = r.metrics;
  const n = (v: number) => formatNumber(v, locale);
  const money = (minor: number, currency: string) => fmtMoney(minor, currency, locale);
  const main = r.currencies[0] ?? ev.currency;
  const days = r.byDay.filter((d) => d.currency === main);
  const dayLabel = (d: string) =>
    new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${d}T12:00:00Z`),
    );

  return (
    <>
      <PageHeader
        title={t('reports.title')}
        description={ev.name}
        actions={<AsOf asOf={r.asOf} locale={locale} />}
      />
      <ReportTabs base={base} current="overview" finance={finance} />
      {!r.hasSales ? (
        <EmptyState title={t('reports.emptyTitle')} description={t('reports.emptyDescription')} />
      ) : (
        <>
          <KpiGrid label={t('reports.keyNumbers')}>
            <Kpi
              label={t('reports.metric.sales.gross')}
              values={metricText(m, 'sales.gross', locale)}
              note={t('reports.note.refunded', {
                amount: metricText(m, 'sales.refunds', locale).join(' · '),
              })}
            />
            <Kpi
              label={t('reports.metric.orders.sold')}
              values={[n(countOf(m, 'orders.sold'))]}
              note={t('reports.note.compOrders', { count: countOf(m, 'orders.comp') })}
            />
            <Kpi
              label={t('reports.metric.tickets.sold')}
              values={[n(countOf(m, 'tickets.sold'))]}
              note={t('reports.note.ofCapacity', {
                capacity: n(countOf(m, 'tickets.capacity')),
                comps: n(countOf(m, 'tickets.comp')),
              })}
            />
            <Kpi
              label={t('reports.metric.checkins.tickets')}
              values={[n(countOf(m, 'checkins.tickets'))]}
              note={t('reports.note.ofValid', {
                rate: fmtPercent(countOf(m, 'checkins.rate'), locale),
                valid: n(countOf(m, 'tickets.valid')),
              })}
            />
          </KpiGrid>
          <Card size="panel" className="flex flex-col gap-1">
            <h2 className="text-section">{t('reports.moreNumbers')}</h2>
            <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
              {(
                [
                  'sales.discounts',
                  'sales.refunds',
                  'orders.failed',
                  'orders.refunded',
                  'orders.comp',
                  'tickets.comp',
                  'tickets.refunded',
                  'tickets.valid',
                  'tickets.capacity',
                ] as const
              ).map((k) => (
                <div
                  key={k}
                  className="flex items-baseline justify-between gap-3 border-b border-zinc-100 py-2"
                >
                  <dt className="text-body text-zinc-600">{t(`reports.metric.${k}`)}</dt>
                  <dd className="font-mono tabular-nums">{metricText(m, k, locale).join(' · ')}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="flex flex-col gap-3">
            <h2 className="text-section">{t('reports.byDay')}</h2>
            <BarChart
              title={t('reports.byDayChart', { currency: main })}
              bars={days.map((d) => ({
                label: dayLabel(d.day),
                value: d.grossMinor / 10 ** currencyExponent(main),
              }))}
              formatValue={(v) => n(v)}
            />
            <ChartTable
              toggle={t('reports.showData')}
              caption={t('reports.byDay')}
              headers={[t('reports.day'), t('reports.orders'), t('reports.tickets'), t('reports.gross')]}
              rows={r.byDay.map((d) => [
                dayLabel(d.day),
                n(d.orders),
                n(d.tickets),
                money(d.grossMinor, d.currency),
              ])}
            />
          </Card>

          <section aria-labelledby="by-type" className="flex flex-col gap-3">
            <h2 id="by-type" className="text-section">
              {t('reports.byType')}
            </h2>
            <Table
              caption={t('reports.byType')}
              rowKey={(x) => x.ticketTypeId}
              rows={r.byTicketType}
              columns={[
                { key: 'name', header: t('reports.ticketType'), cell: (x) => x.name },
                { key: 'sold', header: t('reports.sold'), cell: (x) => n(x.sold), mono: true, align: 'end' },
                {
                  key: 'comps',
                  header: t('reports.comps'),
                  cell: (x) => n(x.comps),
                  mono: true,
                  align: 'end',
                },
                {
                  key: 'capacity',
                  header: t('reports.capacity'),
                  cell: (x) => n(x.capacity),
                  mono: true,
                  align: 'end',
                },
                {
                  key: 'gross',
                  header: t('reports.gross'),
                  cell: (x) => money(x.grossMinor, x.currency),
                  mono: true,
                  align: 'end',
                },
              ]}
            />
          </section>

          <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
            <section aria-labelledby="by-channel" className="flex flex-col gap-3">
              <h2 id="by-channel" className="text-section">
                {t('reports.byChannel')}
              </h2>
              <Table
                caption={t('reports.byChannel')}
                rowKey={(x) => `${x.channel}-${x.currency}`}
                rows={r.byChannel}
                columns={[
                  {
                    key: 'channel',
                    header: t('reports.channel'),
                    cell: (x) => t(`reports.channels.${x.channel}`),
                  },
                  {
                    key: 'orders',
                    header: t('reports.orders'),
                    cell: (x) => n(x.orders),
                    mono: true,
                    align: 'end',
                  },
                  {
                    key: 'tickets',
                    header: t('reports.tickets'),
                    cell: (x) => n(x.tickets),
                    mono: true,
                    align: 'end',
                  },
                  {
                    key: 'gross',
                    header: t('reports.gross'),
                    cell: (x) => money(x.grossMinor, x.currency),
                    mono: true,
                    align: 'end',
                  },
                ]}
              />
            </section>
            <section aria-labelledby="by-status" className="flex flex-col gap-3">
              <h2 id="by-status" className="text-section">
                {t('reports.byStatus')}
              </h2>
              <Table
                caption={t('reports.byStatus')}
                rowKey={(x) => x.status}
                rows={r.ordersByStatus.filter((s) => s.orders > 0)}
                columns={[
                  {
                    key: 'status',
                    header: t('reports.status'),
                    cell: (x) => (
                      <StatusDot
                        status={
                          x.status === 'paid'
                            ? 'success'
                            : x.status === 'payment_failed'
                              ? 'danger'
                              : ['expired', 'cancelled'].includes(x.status)
                                ? 'neutral'
                                : 'warning'
                        }
                        label={t(`order.status.${x.status}`)}
                      />
                    ),
                  },
                  {
                    key: 'orders',
                    header: t('reports.orders'),
                    cell: (x) => n(x.orders),
                    mono: true,
                    align: 'end',
                  },
                ]}
              />
            </section>
          </div>

          <section aria-labelledby="by-code" className="flex flex-col gap-3">
            <h2 id="by-code" className="text-section">
              {t('reports.promo')}
            </h2>
            <Table
              caption={t('reports.promo')}
              rowKey={(x) => x.code}
              rows={r.promoCodes}
              empty={t('reports.promoEmpty')}
              columns={[
                {
                  key: 'code',
                  header: t('reports.code'),
                  mono: true,
                  cell: (x) => (
                    <span className="flex flex-col">
                      <span>{x.code}</span>
                      {x.active ? null : (
                        <span className="text-caption text-zinc-500">{t('reports.inactive')}</span>
                      )}
                    </span>
                  ),
                },
                {
                  key: 'uses',
                  header: t('reports.uses'),
                  cell: (x) => n(x.orders),
                  mono: true,
                  align: 'end',
                },
                {
                  key: 'tickets',
                  header: t('reports.tickets'),
                  cell: (x) => n(x.tickets),
                  mono: true,
                  align: 'end',
                },
                {
                  key: 'discount',
                  header: t('reports.discount'),
                  cell: (x) => money(x.discountMinor, x.currency),
                  mono: true,
                  align: 'end',
                },
                {
                  key: 'gross',
                  header: t('reports.gross'),
                  cell: (x) => money(x.grossMinor, x.currency),
                  mono: true,
                  align: 'end',
                },
              ]}
            />
          </section>
        </>
      )}
    </>
  );
}
