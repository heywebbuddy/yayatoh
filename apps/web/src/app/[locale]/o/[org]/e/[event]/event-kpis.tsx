import { type Ctx, executeQuery } from '@yayatoh/kernel';
import { applyUnpublishedMetricEvents, eventFinanceKpisQuery, eventKpisQuery } from '@yayatoh/reports';
import { buttonClass, EmptyState } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { AsOf, countOf, fmtPercent, Kpi, KpiGrid, metricText } from '@/components/reports.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { ports } from '@/server/ports.ts';

/**
 * The event home's key numbers (M1.12), from the metric registry: gross sales, net revenue
 * (finance roles) or orders, tickets sold against capacity, and check-ins. Read from the metric
 * projections (M3.1) after applying any events the relay has not published yet, so a change the
 * organizer just made shows at once and the numbers equal the full report's.
 */
export async function EventKpis({
  eventId,
  base,
  locale,
  ctx,
  finance,
}: {
  eventId: string;
  base: string;
  locale: string;
  ctx: Ctx;
  finance: boolean;
}) {
  const t = await getTranslations();
  if (ctx.orgId) await applyUnpublishedMetricEvents(ctx.orgId);
  const r = await executeQuery(eventKpisQuery, { eventId }, ctx, ports);
  if (!r.hasSales)
    return (
      <EmptyState
        title={t('dashboard.noSalesTitle')}
        description={t('dashboard.noSalesDescription')}
        action={
          <Link href={`${base}/tickets-orders`} className={buttonClass('primary', 'md')}>
            {t('dashboard.toTicketsOrders')}
          </Link>
        }
      />
    );
  const f = finance ? await executeQuery(eventFinanceKpisQuery, { eventId }, ctx, ports) : null;
  const m = r.metrics;
  const n = (v: number) => formatNumber(v, locale);
  return (
    <>
      <KpiGrid label={t('dashboard.keyNumbers')}>
        <Kpi
          label={t('reports.metric.sales.gross')}
          values={metricText(m, 'sales.gross', locale)}
          note={t('reports.note.refunded', { amount: metricText(m, 'sales.refunds', locale).join(' · ') })}
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AsOf asOf={r.asOf} locale={locale} />
        <Link href={`${base}/analysis`} className={buttonClass('secondary', 'sm')}>
          {t('reports.seeReport')}
        </Link>
      </div>
    </>
  );
}
