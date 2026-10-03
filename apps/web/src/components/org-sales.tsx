import { executeQuery } from '@yayatoh/kernel';
import { orgFinanceQuery, orgReportQuery } from '@yayatoh/reports';
import { roleCan } from '@yayatoh/tenancy';
import { Button, DatePicker, EmptyState, Select, Table } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { PERIODS, type ResolvedPeriod } from '@/lib/period.ts';
import type { ConsoleData } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { AsOf, countOf, fmtMoney, Kpi, KpiGrid, metricText } from './reports.tsx';

/**
 * The org home's sales across events for a period (M1.12): a GET form with presets or custom
 * days (in the org's timezone), key numbers from the metric registry and sales per event.
 */
export async function OrgSales({
  data,
  period,
  locale,
  org,
}: {
  data: ConsoleData;
  period: ResolvedPeriod;
  locale: string;
  org: string;
}) {
  const t = await getTranslations();
  const input = { ...(period.from ? { from: period.from } : {}), ...(period.to ? { to: period.to } : {}) };
  const r = await executeQuery(orgReportQuery, input, data.ctx, ports);
  const f = roleCan(data.role, 'finance:read')
    ? await executeQuery(orgFinanceQuery, input, data.ctx, ports)
    : null;
  const m = r.metrics;
  const n = (v: number) => formatNumber(v, locale);
  const day = (d: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${d}T12:00:00Z`),
    );
  const error = period.error ? t(`reports.org.${period.error}`) : undefined;
  return (
    <section aria-labelledby="sales-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="sales-heading" className="text-section">
            {t('reports.org.title')}
          </h2>
          <p className="text-caption text-ink-2">
            {r.from && r.to
              ? t('reports.org.range', { from: day(r.from), to: day(r.to) })
              : t('reports.org.periods.all')}
          </p>
        </div>
        <AsOf asOf={r.asOf} locale={locale} />
      </div>
      <form method="get" className="flex flex-wrap items-start gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="report-period" className="text-[13px] font-bold text-ink">
            {t('reports.org.period')}
          </label>
          <Select
            id="report-period"
            name="period"
            defaultValue={period.error ? 'custom' : period.period}
            className="field"
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {t(`reports.org.periods.${p}`)}
              </option>
            ))}
          </Select>
        </div>
        <DatePicker
          name="from"
          id="report-from"
          label={t('reports.org.from')}
          defaultValue={period.period === 'custom' ? period.from : undefined}
          hint={t('reports.org.customHint')}
        />
        <DatePicker
          name="to"
          id="report-to"
          label={t('reports.org.to')}
          defaultValue={period.period === 'custom' ? period.to : undefined}
          error={error}
        />
        <Button type="submit" variant="secondary" className="mt-[22px]">
          {t('reports.org.apply')}
        </Button>
      </form>
      {!r.hasSales ? (
        <EmptyState title={t('reports.org.emptyTitle')} description={t('reports.org.emptyDescription')} />
      ) : (
        <>
          <KpiGrid label={t('reports.org.keyNumbers')}>
            <Kpi
              label={t('reports.metric.sales.gross')}
              values={metricText(m, 'sales.gross', locale)}
              note={t('reports.note.refunded', {
                amount: metricText(m, 'sales.refunds', locale).join(' · '),
              })}
            />
            {f ? (
              <Kpi
                label={t('reports.metric.finance.net')}
                values={metricText(f.metrics, 'finance.net', locale)}
                note={t('reports.note.afterFees')}
              />
            ) : (
              <Kpi
                label={t('reports.metric.orders.sold')}
                values={[n(countOf(m, 'orders.sold'))]}
                note={t('reports.note.failed', { count: countOf(m, 'orders.failed') })}
              />
            )}
            <Kpi
              label={t('reports.metric.tickets.sold')}
              values={[n(countOf(m, 'tickets.sold'))]}
              note={t('reports.note.compTickets', { count: countOf(m, 'tickets.comp') })}
            />
            <Kpi label={t('reports.metric.checkins.tickets')} values={[n(countOf(m, 'checkins.tickets'))]} />
          </KpiGrid>
          <Table
            caption={t('reports.org.byEvent')}
            rowKey={(x) => `${x.eventId}-${x.currency}`}
            rows={r.byEvent}
            columns={[
              {
                key: 'event',
                header: t('reports.org.event'),
                cell: (x) =>
                  x.slug ? (
                    <Link href={`/o/${org}/e/${x.slug}/analysis`} className="underline underline-offset-2">
                      {x.name}
                    </Link>
                  ) : (
                    x.name
                  ),
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
                key: 'comps',
                header: t('reports.comps'),
                cell: (x) => n(x.compTickets),
                mono: true,
                align: 'end',
              },
              {
                key: 'gross',
                header: t('reports.gross'),
                cell: (x) => fmtMoney(x.grossMinor, x.currency, locale),
                mono: true,
                align: 'end',
              },
            ]}
          />
        </>
      )}
    </section>
  );
}
