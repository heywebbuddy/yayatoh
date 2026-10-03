import { feeScheduleQuery, planSummaryQuery } from '@yayatoh/billing';
import { executeQuery } from '@yayatoh/kernel';
import { FEE_ORDER_LIMIT, feesReportQuery } from '@yayatoh/reports';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, Card, EmptyState, PageHeader, SectionHeader, StatCard, Table, Tag } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { HowItWorks } from '@/components/how-it-works.tsx';
import { dayLabel, exportHref, MoneyTabs, PeriodForm, periodQuery } from '@/components/money.tsx';
import { AsOf, fmtMoney, fmtPercent } from '@/components/reports.tsx';
import { Link } from '@/i18n/navigation.ts';
import { resolvePeriod } from '@/lib/period.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('money.fees');
  return { title: t('title') };
}

/**
 * Fees (U5, decision UX-4): the rates stay set by Yayatoh staff; organizers see their fee plan
 * and every fee taken, per order and per payout, for a period. Finance roles only.
 */
export default async function FeesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const data = await loadConsole(org);
  if (!roleCan(data.role, 'finance:read')) notFound();
  const t = await getTranslations('money.fees');
  const tm = await getTranslations('money');
  const tb = await getTranslations('billingPlan');
  const period = resolvePeriod(sp, data.org.timezone, new Date());
  const input = { ...(period.from ? { from: period.from } : {}), ...(period.to ? { to: period.to } : {}) };
  const report = await executeQuery(feesReportQuery, input, data.ctx, ports);
  const currencies = [...new Set([data.org.currency, ...report.totals.map((x) => x.currency)])];
  const schedules = await Promise.all(
    currencies.map(async (currency) => ({
      currency,
      ...(await executeQuery(feeScheduleQuery, { currency }, data.ctx, ports)),
    })),
  );
  const plan = roleCan(data.role, 'billing:read')
    ? await executeQuery(planSummaryQuery, {}, data.ctx, ports)
    : null;
  const planName = plan
    ? tb.has(`planName.${plan.feePlan.key}`)
      ? tb(`planName.${plan.feePlan.key}`)
      : plan.feePlan.name
    : null;
  const fmt = (minor: number, currency: string) => fmtMoney(minor, currency, locale);
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: report.timeZone });
  const rate = (s: (typeof schedules)[number]) =>
    s.percentBps === 0 && s.fixedMinor === 0
      ? t('noFee')
      : s.fixedMinor === 0
        ? t('ratePercent', { percent: fmtPercent(s.percentBps, locale) })
        : t('rate', { percent: fmtPercent(s.percentBps, locale), fixed: fmt(s.fixedMinor, s.currency) });
  const query = periodQuery(period);
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          report.perOrder.length ? (
            <a href={exportHref(locale, org, 'fees', query)} download className={buttonClass('secondary')}>
              {tm('export')}
            </a>
          ) : null
        }
      />
      <MoneyTabs org={org} role={data.role} current="fees" />
      <section aria-labelledby="fee-plan" className="flex flex-col gap-3">
        <SectionHeader id="fee-plan" title={t('plan')} />
        <Card className="flex flex-col gap-3">
          {planName ? (
            <p className="m-0 flex flex-wrap items-center gap-2 text-body text-ink">
              {t('planName', { plan: planName })}
              {plan?.legacyFees.grandfathered ? <Tag>{t('grandfathered')}</Tag> : null}
            </p>
          ) : null}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {schedules.map((s) => (
              <li key={s.currency} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-caption text-ink-2">{s.currency}</span>
                <span className="text-section tabular-nums" data-testid={`fee-rate-${s.currency}`}>
                  {rate(s)}
                </span>
                {s.override ? <Tag>{t('override')}</Tag> : null}
              </li>
            ))}
          </ul>
          <p className="m-0 text-caption text-ink-2">{t('planNote')}</p>
        </Card>
      </section>
      <PeriodForm period={period} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-ink-2">
          {period.from && period.to
            ? tm('overview.range', { from: dayLabel(period.from, locale), to: dayLabel(period.to, locale) })
            : tm('overview.allTime')}
        </p>
        <AsOf asOf={report.asOf} locale={locale} />
      </div>
      <section aria-label={t('totals')} className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        {report.totals.map((x) => (
          <StatCard
            key={x.currency}
            label={t('net', { currency: x.currency })}
            value={fmt(x.feesMinor, x.currency)}
            sub={t('takenRefunded', {
              taken: fmt(x.takenMinor, x.currency),
              refunded: fmt(x.refundedMinor, x.currency),
            })}
            testId={`fees-net-${x.currency}`}
          />
        ))}
      </section>
      <section aria-labelledby="fees-orders" className="flex flex-col gap-3">
        <SectionHeader id="fees-orders" title={t('perOrder')} count={report.perOrder.length} />
        {report.perOrder.length === 0 ? (
          <EmptyState
            title={t('emptyTitle')}
            description={t('empty')}
            action={
              period.period === 'all' ? (
                <Link href={`/o/${org}/money`} className={buttonClass('primary', 'md')}>
                  {tm('payouts.toOverview')}
                </Link>
              ) : (
                <Link href={`/o/${org}/fees?period=all`} className={buttonClass('primary', 'md')}>
                  {tm('overview.showAllTime')}
                </Link>
              )
            }
          />
        ) : (
          <>
            <Table
              caption={t('perOrder')}
              captionHidden
              stackOnPhone
              rowKey={(r) => r.orderId}
              rows={report.perOrder}
              columns={[
                { key: 'date', header: t('date'), cell: (r) => day.format(r.paidAt) },
                {
                  key: 'order',
                  header: t('order'),
                  cell: (r) =>
                    r.eventSlug ? (
                      <Link
                        href={`/o/${org}/e/${r.eventSlug}/orders/${r.orderId}`}
                        className="font-mono underline underline-offset-2"
                      >
                        {r.orderRef}
                      </Link>
                    ) : (
                      <span className="font-mono">{r.orderRef}</span>
                    ),
                },
                { key: 'event', header: t('event'), cell: (r) => r.eventName || '—' },
                {
                  key: 'total',
                  header: t('total'),
                  cell: (r) => fmt(r.totalMinor, r.currency),
                  mono: true,
                  align: 'end',
                },
                {
                  key: 'fee',
                  header: t('fee'),
                  cell: (r) => fmt(r.feeMinor, r.currency),
                  mono: true,
                  align: 'end',
                },
                {
                  key: 'back',
                  header: t('feeRefunded'),
                  cell: (r) => fmt(r.feeRefundedMinor, r.currency),
                  mono: true,
                  align: 'end',
                },
              ]}
            />
            {report.truncated ? (
              <p className="text-caption text-ink-2">{t('truncated', { count: FEE_ORDER_LIMIT })}</p>
            ) : null}
          </>
        )}
      </section>
      <section aria-labelledby="fees-payouts" className="flex flex-col gap-3">
        <SectionHeader id="fees-payouts" title={t('perPayout')} count={report.perPayout.length} />
        {report.perPayout.length === 0 ? (
          <p className="text-body text-ink-2">{t('noPayouts')}</p>
        ) : (
          <Table
            caption={t('perPayout')}
            captionHidden
            stackOnPhone
            rowKey={(r) => r.settlementId}
            rows={report.perPayout}
            columns={[
              { key: 'date', header: t('date'), cell: (r) => day.format(r.releasedAt) },
              {
                key: 'payout',
                header: t('payout'),
                cell: (r) => (
                  <Link href={`/o/${org}/payouts/${r.settlementId}`} className="underline underline-offset-2">
                    {r.eventName || '—'}
                  </Link>
                ),
              },
              {
                key: 'fee',
                header: t('fee'),
                cell: (r) => fmt(r.feeMinor, r.currency),
                mono: true,
                align: 'end',
              },
              {
                key: 'amount',
                header: t('paidOut'),
                cell: (r) => fmt(r.amountMinor, r.currency),
                mono: true,
                align: 'end',
              },
            ]}
          />
        )}
      </section>
      <HowItWorks topic="fees" />
    </>
  );
}
