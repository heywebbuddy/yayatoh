import { formatMoney, money } from '@yayatoh/kernel';
import type { AnalyticsRowDto, FiguresDto } from '@yayatoh/marketing';
import { BarChart, Button, ChartTable, StatCard, Table } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';

/**
 * Marketing analytics (M3.8b) building blocks, server-rendered: the date-range form (a plain GET
 * form, keyboard and no-script friendly), the figure tiles, and the chart with its accessible
 * table alternative. Numbers only come from the allowlisted report DTOs.
 */

export const moneyText = (minor: number, currency: string, locale: string) =>
  formatMoney(money(minor, currency), locale);

/** Basis points as a percentage with up to two decimals ("6.66 %", "25 %"). */
export const ratePct = (bps: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(bps / 10_000);

export async function RangeForm({
  action,
  from,
  to,
  timeZone,
  currency,
  error,
  hidden = {},
}: {
  action: string;
  from: string;
  to: string;
  timeZone: string;
  currency: string;
  error: string | null;
  hidden?: Record<string, string>;
}) {
  const t = await getTranslations('marketingAnalytics');
  return (
    <form method="get" action={action} className="flex flex-col gap-2" aria-labelledby="range-legend">
      <h2 id="range-legend" className="sr-only">
        {t('rangeLegend')}
      </h2>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-[13px] font-bold text-ink">
          {t('from')}
          <input
            type="date"
            name="from"
            defaultValue={from}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'range-error' : 'range-note'}
            className="field"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-bold text-ink">
          {t('to')}
          <input
            type="date"
            name="to"
            defaultValue={to}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'range-error' : 'range-note'}
            className="field"
          />
        </label>
        <Button type="submit" variant="secondary">
          {t('apply')}
        </Button>
      </div>
      {error ? (
        <p id="range-error" role="alert" className="text-caption text-danger">
          {t(`rangeErrors.${error}` as 'rangeErrors.invalid_date')}
        </p>
      ) : null}
      <p id="range-note" className="text-caption text-ink-2">
        {t('rangeNote', { timeZone, currency })}
      </p>
    </form>
  );
}

/** The headline numbers of a report or a campaign. */
export async function FigureTiles({
  figures,
  currency,
  locale,
  label,
}: {
  figures: FiguresDto;
  currency: string;
  locale: string;
  label: string;
}) {
  const t = await getTranslations('marketingAnalytics.figures');
  const n = new Intl.NumberFormat(locale);
  const items: [string, string][] = [
    ['sends', figures.sends === null ? '—' : n.format(figures.sends)],
    ['deliveries', figures.deliveries === null ? '—' : n.format(figures.deliveries)],
    ['clicks', n.format(figures.clicks)],
    ['uniqueClickers', n.format(figures.uniqueClickers)],
    ['lastOrders', n.format(figures.lastTouch.orders)],
    ['lastRevenue', moneyText(figures.lastTouch.revenueMinor, currency, locale)],
    ['firstOrders', n.format(figures.firstTouch.orders)],
    ['firstRevenue', moneyText(figures.firstTouch.revenueMinor, currency, locale)],
    ['conversion', ratePct(figures.conversionBps, locale)],
  ];
  return (
    <section aria-label={label} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <StatCard
          key={k}
          testId={`figure-${k}`}
          label={t(k as 'sends')}
          value={v}
          progress={
            k === 'deliveries' && figures.sends && figures.deliveries !== null
              ? {
                  value: Math.min(figures.deliveries, figures.sends),
                  max: figures.sends,
                  label: t('deliveredShare'),
                  tone: 'success',
                }
              : k === 'conversion'
                ? {
                    value: Math.min(figures.conversionBps, 10_000),
                    max: 10_000,
                    label: t('conversion'),
                    tone: 'brand',
                  }
                : undefined
          }
        />
      ))}
    </section>
  );
}

/**
 * One view's rows: a bar chart of last-touch revenue (decorative beyond its title) with its data
 * table behind "Show the data", then the full table (the accessible alternative with every
 * figure). Campaign rows link to their drill-down.
 */
export async function AnalyticsRows({
  view,
  rows,
  currency,
  locale,
  href,
}: {
  view: 'campaign' | 'channel' | 'link';
  rows: readonly AnalyticsRowDto[];
  currency: string;
  locale: string;
  /** The drill-down path of a campaign row (null: no drill-down). */
  href: (row: AnalyticsRowDto) => string | null;
}) {
  const t = await getTranslations('marketingAnalytics');
  const n = new Intl.NumberFormat(locale);
  const name = (r: AnalyticsRowDto) =>
    r.name ?? (r.link ? `${r.link.source} / ${r.link.medium} / ${r.link.campaign}` : t('unnamed'));
  const m = (minor: number) => moneyText(minor, currency, locale);
  const opt = (v: number | null) => (v === null ? '—' : n.format(v));
  const chartRows = rows.slice(0, 12);
  const chartTitle = t(`chartTitle.${view}`);
  return (
    <div className="flex flex-col gap-4">
      {rows.length > 0 ? (
        <figure className="m-0 flex flex-col gap-3 rounded-card border border-line bg-surface p-5 elevation-card glass">
          <figcaption className="text-card text-ink">{chartTitle}</figcaption>
          <BarChart
            title={chartTitle}
            bars={chartRows.map((r) => ({ label: name(r).slice(0, 18), value: r.lastTouch.revenueMinor }))}
            height={180}
            formatValue={(v) => m(v)}
          />
          <ChartTable
            toggle={t('showData')}
            caption={chartTitle}
            headers={[t('columns.name'), t('figures.lastRevenue')]}
            rows={chartRows.map((r) => [name(r), m(r.lastTouch.revenueMinor)])}
          />
        </figure>
      ) : null}
      <Table
        caption={t(`tableCaption.${view}`)}
        rowKey={(r) => r.key}
        rows={rows}
        empty={t('empty')}
        columns={[
          {
            key: 'name',
            header: t('columns.name'),
            cell: (r) => {
              const to = href(r);
              return (
                <span className="flex flex-col gap-0.5">
                  {to ? (
                    <Link
                      href={to}
                      className="inline-flex min-h-6 items-center font-bold text-primary-ink underline underline-offset-2"
                    >
                      {name(r)}
                    </Link>
                  ) : (
                    <span className="font-bold text-ink">{name(r)}</span>
                  )}
                  {r.kind === 'campaign' || r.kind === 'utm' ? (
                    <span className="text-caption text-ink-2">{t(`kind.${r.kind}`)}</span>
                  ) : null}
                  {r.link ? (
                    <span className="text-caption text-ink-2">
                      {r.link.eventName ?? ''} · {r.link.source} / {r.link.medium} / {r.link.campaign}
                    </span>
                  ) : null}
                </span>
              );
            },
          },
          { key: 'sends', header: t('figures.sends'), cell: (r) => opt(r.sends), align: 'end' },
          {
            key: 'deliveries',
            header: t('figures.deliveries'),
            cell: (r) => opt(r.deliveries),
            align: 'end',
          },
          {
            key: 'clicks',
            header: t('figures.clicks'),
            cell: (r) => n.format(r.clicks),
            align: 'end',
          },
          {
            key: 'unique',
            header: t('figures.uniqueClickers'),
            cell: (r) => n.format(r.uniqueClickers),
            align: 'end',
          },
          {
            key: 'firstOrders',
            header: t('figures.firstOrders'),
            cell: (r) => n.format(r.firstTouch.orders),
            align: 'end',
          },
          {
            key: 'firstRevenue',
            header: t('figures.firstRevenue'),
            cell: (r) => m(r.firstTouch.revenueMinor),
            align: 'end',
          },
          {
            key: 'lastOrders',
            header: t('figures.lastOrders'),
            cell: (r) => n.format(r.lastTouch.orders),
            align: 'end',
          },
          {
            key: 'lastRevenue',
            header: t('figures.lastRevenue'),
            cell: (r) => m(r.lastTouch.revenueMinor),
            align: 'end',
          },
          {
            key: 'conversion',
            header: t('figures.conversion'),
            cell: (r) => ratePct(r.conversionBps, locale),
            align: 'end',
          },
        ]}
      />
    </div>
  );
}
