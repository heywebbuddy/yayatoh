import type { Granularity, OrgDashboardDto, OrgRevenueDto } from '@yayatoh/analytics';
import { Button, Input, LineChart, Select, StatCard, Table } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { moneyText } from './marketing-analytics.tsx';

/**
 * Org analytics (M6.2a) building blocks, server-rendered from the allowlisted dashboard DTOs: the
 * filter form (a plain GET form, keyboard and no-script friendly), the figure tiles, the chart
 * with its data table, and the top events. Money only ever comes from the revenue DTO, which the
 * page asks for only when the member may see finance.
 */

/** A bucket's label: the day, "Week of …" or the month, in the viewer's locale. */
export function bucketLabel(bucket: string, g: Granularity, locale: string, weekOf: (d: string) => string) {
  const d = new Date(`${bucket}T00:00:00Z`);
  if (g === 'month')
    return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(d);
  const day = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(d);
  return g === 'week' ? weekOf(day) : day;
}

export async function AnalyticsFilters({
  action,
  from,
  to,
  eventId,
  granularity,
  events,
  timeZone,
  error,
}: {
  action: string;
  from: string;
  to: string;
  eventId: string | null;
  granularity: Granularity;
  events: readonly { id: string; name: string }[];
  timeZone: string;
  error: string | null;
}) {
  const t = await getTranslations('warehouse');
  return (
    <form method="get" action={action} className="flex flex-col gap-2" aria-labelledby="filters-heading">
      <h2 id="filters-heading" className="sr-only">
        {t('filters')}
      </h2>
      <input type="hidden" name="view" value={granularity} />
      <div className="flex flex-wrap items-end gap-3">
        <Input
          type="date"
          id="analytics-from"
          name="from"
          label={t('from')}
          defaultValue={from}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'analytics-to-error' : undefined}
        />
        <Input
          type="date"
          id="analytics-to"
          name="to"
          label={t('to')}
          defaultValue={to}
          error={error ? t(`rangeErrors.${error}` as 'rangeErrors.invalid_date') : undefined}
        />
        <Select id="analytics-event" name="event" label={t('event')} defaultValue={eventId ?? ''}>
          <option value="">{t('allEvents')}</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </Select>
        <Button type="submit" data-testid="analytics-apply">
          {t('apply')}
        </Button>
      </div>
      <p className="m-0 text-caption text-ink-2">{t('timeZoneNote', { timeZone })}</p>
    </form>
  );
}

export async function CountTiles({ totals, locale }: { totals: OrgDashboardDto['totals']; locale: string }) {
  const t = await getTranslations('warehouse.figures');
  const n = new Intl.NumberFormat(locale);
  const items = [
    ['registrations', totals.registrations],
    ['tickets', totals.tickets],
    ['compTickets', totals.compTickets],
    ['checkins', totals.checkins],
    ['noShows', totals.noShows],
  ] as const;
  return (
    <section aria-label={t('label')} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {items.map(([k, v]) => (
        <StatCard key={k} testId={`analytics-${k}`} label={t(k)} value={n.format(v)} />
      ))}
    </section>
  );
}

export async function RevenueTiles({ revenue, locale }: { revenue: OrgRevenueDto; locale: string }) {
  const t = await getTranslations('warehouse.revenue');
  return (
    <section aria-labelledby="revenue-heading" className="flex flex-col gap-3">
      <h2 id="revenue-heading" className="text-section">
        {t('title')}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {revenue.totals.map((m) => (
          <StatCard
            key={m.currency}
            testId={`analytics-revenue-${m.currency}`}
            label={t('net', { currency: m.currency })}
            value={moneyText(m.netMinor, m.currency, locale)}
            sub={t('grossRefunds', {
              gross: moneyText(m.grossMinor, m.currency, locale),
              refunds: moneyText(m.refundsMinor, m.currency, locale),
            })}
          />
        ))}
      </div>
      <Table
        caption={t('byPeriod')}
        captionHidden={false}
        density="compact"
        stackOnPhone
        rowKey={(r) => `${r.bucket}|${r.currency}`}
        rows={revenue.series.filter((r) => r.grossMinor !== 0 || r.refundsMinor !== 0)}
        empty={t('noRevenue')}
        columns={[
          {
            key: 'bucket',
            header: t('period'),
            cell: (r) => bucketLabel(r.bucket, revenue.granularity, locale, (d) => t('weekOf', { day: d })),
          },
          { key: 'currency', header: t('currency'), cell: (r) => r.currency },
          {
            key: 'gross',
            header: t('gross'),
            align: 'end',
            cell: (r) => moneyText(r.grossMinor, r.currency, locale),
          },
          {
            key: 'refunds',
            header: t('refunds'),
            align: 'end',
            cell: (r) => moneyText(r.refundsMinor, r.currency, locale),
          },
          {
            key: 'netCol',
            header: t('netColumn'),
            align: 'end',
            cell: (r) => moneyText(r.netMinor, r.currency, locale),
          },
        ]}
      />
      {revenue.topEvents.length > 0 ? (
        <Table
          caption={t('topEvents')}
          captionHidden={false}
          density="compact"
          stackOnPhone
          rowKey={(r) => `${r.eventId}|${r.currency}`}
          rows={revenue.topEvents}
          columns={[
            { key: 'name', header: t('eventColumn'), cell: (r) => r.name },
            { key: 'currency', header: t('currency'), cell: (r) => r.currency },
            {
              key: 'gross',
              header: t('gross'),
              align: 'end',
              cell: (r) => moneyText(r.grossMinor, r.currency, locale),
            },
            {
              key: 'netCol',
              header: t('netColumn'),
              align: 'end',
              cell: (r) => moneyText(r.netMinor, r.currency, locale),
            },
          ]}
        />
      ) : null}
    </section>
  );
}

export async function CountsOverTime({ dashboard, locale }: { dashboard: OrgDashboardDto; locale: string }) {
  const t = await getTranslations('warehouse');
  const n = new Intl.NumberFormat(locale);
  const label = (b: string) =>
    bucketLabel(b, dashboard.granularity, locale, (d) => t('revenue.weekOf', { day: d }));
  return (
    <section aria-labelledby="trend-heading" className="flex flex-col gap-3">
      <h2 id="trend-heading" className="text-section">
        {t('trend')}
      </h2>
      <LineChart
        title={t('chartTitle')}
        xLabels={dashboard.series.map((s) => label(s.bucket))}
        series={[
          {
            label: t('figures.registrations'),
            tone: 'primary',
            points: dashboard.series.map((s) => s.registrations),
          },
          {
            label: t('figures.ticketsIssued'),
            tone: 'brand',
            points: dashboard.series.map((s) => s.ticketsIssued),
          },
          { label: t('figures.checkins'), tone: 'success', points: dashboard.series.map((s) => s.checkins) },
        ]}
        formatValue={(v) => n.format(v)}
      />
      <Table
        caption={t('byPeriod')}
        captionHidden={false}
        density="compact"
        stackOnPhone
        rowKey={(r) => r.bucket}
        rows={dashboard.series}
        columns={[
          { key: 'bucket', header: t('period'), cell: (r) => label(r.bucket) },
          {
            key: 'registrations',
            header: t('figures.registrations'),
            align: 'end',
            cell: (r) => n.format(r.registrations),
          },
          { key: 'tickets', header: t('figures.tickets'), align: 'end', cell: (r) => n.format(r.tickets) },
          { key: 'checkins', header: t('figures.checkins'), align: 'end', cell: (r) => n.format(r.checkins) },
          { key: 'noShows', header: t('figures.noShows'), align: 'end', cell: (r) => n.format(r.noShows) },
        ]}
      />
    </section>
  );
}

export async function TopEvents({
  rows,
  orgBase,
  locale,
}: {
  rows: OrgDashboardDto['topEvents'];
  orgBase: string;
  locale: string;
}) {
  const t = await getTranslations('warehouse');
  const n = new Intl.NumberFormat(locale);
  return (
    <section aria-labelledby="top-heading" className="flex flex-col gap-3">
      <h2 id="top-heading" className="text-section">
        {t('topEvents')}
      </h2>
      <Table
        caption={t('topEvents')}
        density="compact"
        stackOnPhone
        rowKey={(r) => r.eventId}
        rows={rows}
        empty={t('noTopEvents')}
        columns={[
          {
            key: 'name',
            header: t('revenue.eventColumn'),
            cell: (r) =>
              r.slug ? (
                <Link href={`${orgBase}/e/${r.slug}`} className="inline-flex min-h-6 items-center underline">
                  {r.name}
                </Link>
              ) : (
                r.name
              ),
          },
          {
            key: 'registrations',
            header: t('figures.registrations'),
            align: 'end',
            cell: (r) => n.format(r.registrations),
          },
          { key: 'tickets', header: t('figures.tickets'), align: 'end', cell: (r) => n.format(r.tickets) },
          { key: 'checkins', header: t('figures.checkins'), align: 'end', cell: (r) => n.format(r.checkins) },
        ]}
      />
    </section>
  );
}
