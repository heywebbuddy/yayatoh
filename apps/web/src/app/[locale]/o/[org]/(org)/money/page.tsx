import { executeQuery } from '@yayatoh/kernel';
import {
  type MoneyGrain,
  type MoneyTotals,
  moneyOverviewQuery,
  payoutsDashboardQuery,
} from '@yayatoh/reports';
import { roleCan } from '@yayatoh/tenancy';
import {
  BarChart,
  buttonClass,
  Card,
  ChartTable,
  EmptyState,
  HighlightCard,
  PageHeader,
  SectionHeader,
  StatCard,
} from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { HowItWorks } from '@/components/how-it-works.tsx';
import {
  dayLabel,
  deltaOf,
  exportHref,
  isGrain,
  MoneyTabs,
  PeriodForm,
  periodQuery,
} from '@/components/money.tsx';
import { AsOf, fmtMoney } from '@/components/reports.tsx';
import { Link } from '@/i18n/navigation.ts';
import { resolvePeriod } from '@/lib/period.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('money.overview');
  return { title: t('title') };
}

const IN = ['grossMinor', 'netMinor', 'payoutsMinor'] as const;

/**
 * Money overview (U5, UX review 1 principle 5 "numbers before prose"): net as the hero, then
 * gross, refunds, fees, lost disputes and payouts for a period in the org's time zone, each
 * against the period before, and gross sales per day, week or month. Finance roles only.
 */
export default async function MoneyOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ period?: string; from?: string; to?: string; grain?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const data = await loadConsole(org);
  if (!roleCan(data.role, 'finance:read')) notFound();
  const t = await getTranslations('money');
  const period = resolvePeriod(sp, data.org.timezone, new Date());
  const chosen = isGrain(sp.grain) ? sp.grain : undefined;
  const o = await executeQuery(
    moneyOverviewQuery,
    {
      ...(period.from ? { from: period.from } : {}),
      ...(period.to ? { to: period.to } : {}),
      ...(chosen ? { grain: chosen } : {}),
    },
    data.ctx,
    ports,
  );
  const payouts = await executeQuery(payoutsDashboardQuery, {}, data.ctx, ports);
  const fmt = (minor: number, currency: string) => fmtMoney(minor, currency, locale);
  const longDay = (d: Date) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: o.timeZone }).format(d);
  const hasMoney = o.currencies.some(
    (c) =>
      c.totals.grossMinor ||
      c.totals.refundsMinor ||
      c.totals.payoutsMinor ||
      c.totals.disputesLostMinor ||
      c.totals.feesMinor,
  );
  const query = periodQuery(period, { grain: chosen });
  const grain: MoneyGrain = o.grain;
  const stat = (
    c: (typeof o.currencies)[number],
    key: keyof MoneyTotals & `${string}Minor`,
    label: string,
  ) => {
    const prev = c.previousTotals?.[key];
    const d = deltaOf(
      c.totals[key],
      prev,
      locale,
      (IN as readonly string[]).includes(key) ? 'in' : 'out',
      t('overview.new'),
    );
    return (
      <StatCard
        key={key}
        label={label}
        value={fmt(c.totals[key], c.currency)}
        delta={d.delta}
        deltaTone={d.tone}
        sub={prev !== undefined ? t('overview.previous', { amount: fmt(prev, c.currency) }) : undefined}
        testId={`money-${key}-${c.currency}`}
      />
    );
  };
  return (
    <>
      <PageHeader
        title={t('overview.title')}
        description={t('overview.description', { timeZone: o.timeZone })}
        actions={
          hasMoney ? (
            <a
              href={exportHref(locale, org, 'overview', query)}
              download
              className={buttonClass('secondary')}
            >
              {t('export')}
            </a>
          ) : null
        }
      />
      <MoneyTabs org={org} role={data.role} current="overview" />
      <PeriodForm period={period} grain={chosen ?? 'auto'} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-ink-2">
          {o.from
            ? t('overview.range', {
                from: dayLabel(o.from, locale),
                to: dayLabel(o.to, locale),
              })
            : t('overview.allTime')}
          {o.previous
            ? ` · ${t('overview.comparedWith', {
                from: dayLabel(o.previous.from, locale),
                to: dayLabel(o.previous.to, locale),
              })}`
            : ''}
        </p>
        <AsOf asOf={o.asOf} locale={locale} />
      </div>
      {!hasMoney ? (
        <EmptyState
          title={t('overview.emptyTitle')}
          description={t('overview.emptyDescription')}
          action={
            period.period === 'all' ? (
              <Link href={`/o/${org}/events/new`} className={buttonClass('primary', 'md')}>
                {t('overview.createEvent')}
              </Link>
            ) : (
              <Link href={`/o/${org}/money?period=all`} className={buttonClass('primary', 'md')}>
                {t('overview.showAllTime')}
              </Link>
            )
          }
        />
      ) : (
        o.currencies.map((c) => {
          const d = deltaOf(c.totals.netMinor, c.previousTotals?.netMinor, locale, 'in', t('overview.new'));
          const next = payouts.held.find((h) => h.currency === c.currency) ?? null;
          const hasRows = c.buckets.some((b) => b.grossMinor || b.refundsMinor || b.feesMinor);
          return (
            <section
              key={c.currency}
              aria-labelledby={`money-${c.currency}`}
              className="flex flex-col gap-3.5"
            >
              <h2 id={`money-${c.currency}`} className={o.currencies.length > 1 ? 'text-section' : 'sr-only'}>
                {t('overview.inCurrency', { currency: c.currency })}
              </h2>
              <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
                <HighlightCard
                  className="lg:col-span-2"
                  label={t('overview.net')}
                  value={
                    <span data-testid={`money-net-${c.currency}`}>{fmt(c.totals.netMinor, c.currency)}</span>
                  }
                  chip={d.delta ? t('overview.netChange', { change: d.delta }) : undefined}
                  sub={t('overview.netExplained')}
                />
                <Card className="flex flex-col gap-2.5">
                  <SectionHeader as="h3" title={t('overview.nextPayout')} />
                  {next ? (
                    <>
                      <p className="m-0 text-stat text-ink tabular-nums">
                        {fmt(next.expectedMinor, next.currency)}
                      </p>
                      <p className="m-0 text-body text-ink-2">
                        {t('overview.nextPayoutOn', { date: longDay(next.releaseAt), event: next.eventName })}
                      </p>
                    </>
                  ) : (
                    <p className="m-0 text-body text-ink-2">{t('overview.noNextPayout')}</p>
                  )}
                  <Link
                    href={`/o/${org}/payouts`}
                    className="mt-auto text-body font-bold text-primary-ink underline underline-offset-2"
                  >
                    {t('overview.toPayouts')}
                  </Link>
                </Card>
              </div>
              <section
                aria-label={t('overview.keyNumbers', { currency: c.currency })}
                className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-5"
              >
                {stat(c, 'grossMinor', t('overview.gross'))}
                {stat(c, 'refundsMinor', t('overview.refunds'))}
                {stat(c, 'feesMinor', t('overview.fees'))}
                {stat(c, 'disputesLostMinor', t('overview.disputes'))}
                {stat(c, 'payoutsMinor', t('overview.payouts'))}
              </section>
              <Card className="flex flex-col gap-3">
                <SectionHeader
                  as="h3"
                  title={t(`overview.chart.${grain}`)}
                  description={t('overview.chartNote')}
                />
                {hasRows ? (
                  <>
                    <BarChart
                      title={t(`overview.chart.${grain}`)}
                      bars={c.buckets.map((b) => ({
                        label: dayLabel(b.start, locale, grain),
                        value: b.grossMinor,
                      }))}
                      formatValue={(v) => fmt(v, c.currency)}
                    />
                    <ChartTable
                      toggle={t('overview.showData')}
                      caption={t(`overview.chart.${grain}`)}
                      headers={[
                        t(`overview.bucket.${grain}`),
                        t('overview.gross'),
                        t('overview.refunds'),
                        t('overview.fees'),
                      ]}
                      rows={c.buckets.map((b) => [
                        dayLabel(b.start, locale, grain),
                        fmt(b.grossMinor, c.currency),
                        fmt(b.refundsMinor, c.currency),
                        fmt(b.feesMinor, c.currency),
                      ])}
                    />
                  </>
                ) : (
                  <p className="m-0 text-body text-ink-2">{t('overview.noSalesInPeriod')}</p>
                )}
              </Card>
            </section>
          );
        })
      )}
      <HowItWorks topic="money" />
    </>
  );
}
