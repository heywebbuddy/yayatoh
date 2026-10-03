import { executeQuery } from '@yayatoh/kernel';
import { type EventMoneyDto, eventMoneyQuery, orgReportQuery } from '@yayatoh/reports';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, EmptyState, PageHeader, SectionHeader, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { dayLabel, exportHref, MoneyTabs, PeriodForm, periodQuery } from '@/components/money.tsx';
import { AsOf, fmtMoney } from '@/components/reports.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { resolvePeriod } from '@/lib/period.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('money.sales');
  return { title: t('title') };
}

/**
 * Sales by event (U5): orders, tickets and gross per event for a period (`orgReportQuery`,
 * `orders:read`), with refunds, fees and net per event for finance roles (`eventMoneyQuery`).
 * Each event links to its own finance analysis.
 */
export default async function SalesByEventPage({
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
  if (!roleCan(data.role, 'orders:read')) notFound();
  const t = await getTranslations('money.sales');
  const tm = await getTranslations('money');
  const period = resolvePeriod(sp, data.org.timezone, new Date());
  const input = { ...(period.from ? { from: period.from } : {}), ...(period.to ? { to: period.to } : {}) };
  const report = await executeQuery(orgReportQuery, input, data.ctx, ports);
  const finance = roleCan(data.role, 'finance:read');
  const money: EventMoneyDto | null = finance
    ? await executeQuery(eventMoneyQuery, input, data.ctx, ports)
    : null;
  const moneyOf = (eventId: string, currency: string) =>
    money?.events.find((e) => e.eventId === eventId && e.currency === currency) ?? null;
  // Events with only refunds or lost disputes in the period appear too (finance roles).
  const rows = [
    ...report.byEvent.map((r) => ({ ...r, money: moneyOf(r.eventId, r.currency) })),
    ...(money?.events ?? [])
      .filter((m) => !report.byEvent.some((r) => r.eventId === m.eventId && r.currency === m.currency))
      .map((m) => ({
        eventId: m.eventId,
        name: m.name,
        slug: m.slug,
        currency: m.currency,
        orders: 0,
        tickets: 0,
        compTickets: 0,
        grossMinor: 0,
        money: m,
      })),
  ];
  const fmt = (minor: number, currency: string) => fmtMoney(minor, currency, locale);
  const n = (v: number) => formatNumber(v, locale);
  const dash = '—';
  return (
    <>
      <PageHeader
        title={t('title')}
        description={finance ? t('description') : t('descriptionNoFinance')}
        actions={
          rows.length ? (
            <a
              href={exportHref(locale, org, 'events', periodQuery(period))}
              download
              className={buttonClass('secondary')}
            >
              {tm('export')}
            </a>
          ) : null
        }
      />
      <MoneyTabs org={org} role={data.role} current="sales" />
      <PeriodForm period={period} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-ink-2">
          {report.from && report.to
            ? tm('overview.range', { from: dayLabel(report.from, locale), to: dayLabel(report.to, locale) })
            : tm('overview.allTime')}
        </p>
        <AsOf asOf={report.asOf} locale={locale} />
      </div>
      <section aria-labelledby="sales-events" className="flex flex-col gap-3">
        <SectionHeader id="sales-events" title={t('tableTitle')} count={rows.length} />
        {rows.length === 0 ? (
          <EmptyState
            title={t('emptyTitle')}
            description={t('empty')}
            action={
              period.period === 'all' ? (
                <Link href={`/o/${org}/events/new`} className={buttonClass('primary', 'md')}>
                  {tm('overview.createEvent')}
                </Link>
              ) : (
                <Link href={`/o/${org}/sales-by-event?period=all`} className={buttonClass('primary', 'md')}>
                  {tm('overview.showAllTime')}
                </Link>
              )
            }
          />
        ) : (
          <Table
            caption={t('tableTitle')}
            captionHidden
            stackOnPhone
            rowKey={(r) => `${r.eventId}-${r.currency}`}
            rows={rows}
            columns={[
              {
                key: 'event',
                header: t('event'),
                cell: (r) =>
                  r.slug ? (
                    <Link
                      href={`/o/${org}/e/${r.slug}/analysis${finance ? '/finance' : ''}`}
                      className="underline underline-offset-2"
                      aria-label={t(finance ? 'openFinance' : 'openAnalysis', { event: r.name })}
                    >
                      {r.name}
                    </Link>
                  ) : (
                    r.name
                  ),
              },
              { key: 'orders', header: t('orders'), cell: (r) => n(r.orders), mono: true, align: 'end' },
              { key: 'tickets', header: t('tickets'), cell: (r) => n(r.tickets), mono: true, align: 'end' },
              {
                key: 'gross',
                header: t('gross'),
                cell: (r) => fmt(r.grossMinor, r.currency),
                mono: true,
                align: 'end',
              },
              ...(finance
                ? [
                    {
                      key: 'refunds',
                      header: t('refunds'),
                      cell: (r: (typeof rows)[number]) =>
                        r.money ? fmt(r.money.refundsMinor, r.currency) : dash,
                      mono: true,
                      align: 'end' as const,
                    },
                    {
                      key: 'fees',
                      header: t('fees'),
                      cell: (r: (typeof rows)[number]) =>
                        r.money ? fmt(r.money.feesMinor, r.currency) : dash,
                      mono: true,
                      align: 'end' as const,
                    },
                    {
                      key: 'net',
                      header: t('net'),
                      cell: (r: (typeof rows)[number]) =>
                        r.money ? fmt(r.money.netMinor, r.currency) : dash,
                      mono: true,
                      align: 'end' as const,
                    },
                  ]
                : []),
            ]}
          />
        )}
        {finance && rows.length ? <p className="text-caption text-ink-2">{t('netNote')}</p> : null}
      </section>
    </>
  );
}
