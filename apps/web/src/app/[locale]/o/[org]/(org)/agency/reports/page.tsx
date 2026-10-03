import { agencyClientsQuery, reportTotals } from '@yayatoh/agency';
import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { buttonClass, EmptyState, StatCard, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { ports } from '@/server/ports.ts';
import { loadAgency } from '../load.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('agency');
  return { title: t('tab.reports') };
}

/**
 * Reports (M6.7a): totals across live clients and per client, from the snapshots. Money appears
 * only for clients who let the agency read it, per currency (never added across currencies).
 */
export default async function AgencyReportsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const { data, canRead } = await loadAgency(org);
  if (!canRead) return null;
  const t = await getTranslations('agency');
  const te = await getTranslations('emptyActions');
  const clients = await executeQuery(agencyClientsQuery, {}, data.ctx, ports);
  if (clients.length === 0)
    return (
      <EmptyState
        title={t('emptyTitle')}
        description={t('emptyDescription', { address: data.org.slug })}
        action={
          <Link href={`/o/${org}/settings`} className={buttonClass('primary', 'md')}>
            {te('agencyAddress')}
          </Link>
        }
      />
    );
  const rows = clients.map((c) => ({
    client: c,
    eventsTotal: c.snapshot?.eventsTotal ?? 0,
    eventsUpcoming: c.snapshot?.eventsUpcoming ?? 0,
    ordersSold: c.snapshot?.ordersSold ?? 0,
    ticketsValid: c.snapshot?.ticketsValid ?? 0,
    checkins: c.snapshot?.checkins ?? 0,
    sends: c.snapshot?.sends ?? 0,
    clicks: c.snapshot?.clicks ?? 0,
    revenue: c.snapshot?.revenue ?? null,
  }));
  const totals = reportTotals(rows);
  const n = (v: number) => formatNumber(v, locale);
  const pct = (bps: number) =>
    new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(bps / 10_000);
  const moneyList = (r: Readonly<Record<string, number>>) =>
    Object.entries(r)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cur, v]) => formatMoney(money(v, cur), locale))
      .join(' · ');
  return (
    <>
      <section aria-labelledby="agency-totals" className="flex flex-col gap-3">
        <h2 id="agency-totals" className="text-section">
          {t('reportsTitle')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard testId="agency-total-clients" label={t('clientsCount')} value={n(totals.clients)} />
          <StatCard
            testId="agency-total-events"
            label={t('eventsTotal')}
            value={n(totals.eventsTotal)}
            sub={`${t('upcoming')}: ${n(totals.eventsUpcoming)}`}
          />
          <StatCard
            testId="agency-total-tickets"
            label={t('tickets')}
            value={n(totals.ticketsValid)}
            sub={`${t('checkinRate')}: ${pct(totals.checkinBps)}`}
          />
          <StatCard
            testId="agency-total-revenue"
            label={t('revenue')}
            value={
              totals.financeClients > 0
                ? moneyList(totals.revenue) || formatMoney(money(0, data.org.currency), locale)
                : '—'
            }
            sub={
              totals.financeClients > 0
                ? t('revenueFrom', { count: totals.financeClients })
                : t('revenueNone')
            }
          />
        </div>
      </section>
      <Table
        caption={t('perClient')}
        captionHidden={false}
        rowKey={(r) => r.client.clientOrgId}
        rows={rows}
        empty=""
        columns={[
          {
            key: 'client',
            header: t('client'),
            cell: (r) => <span className="font-semibold">{r.client.name}</span>,
          },
          { key: 'events', header: t('eventsTotal'), align: 'end', cell: (r) => n(r.eventsTotal) },
          { key: 'orders', header: t('orders'), align: 'end', cell: (r) => n(r.ordersSold) },
          { key: 'tickets', header: t('tickets'), align: 'end', cell: (r) => n(r.ticketsValid) },
          { key: 'checkins', header: t('checkins'), align: 'end', cell: (r) => n(r.checkins) },
          {
            key: 'revenue',
            header: t('revenue'),
            align: 'end',
            cell: (r) =>
              r.revenue ? (
                moneyList(r.revenue) || formatMoney(money(0, r.client.currency), locale)
              ) : (
                <span className="text-ink-2">{t('grossHidden')}</span>
              ),
          },
        ]}
      />
    </>
  );
}
