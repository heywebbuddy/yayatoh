import { formatMoney, money } from '@yayatoh/kernel';
import { buttonClass, Card, PageHeader, Select } from '@yayatoh/ui';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { DistributionChart, TrendChart } from '@/components/dashboard-chart.tsx';
import { Shell } from '@/components/shell.tsx';
import { dashboardData, dashboardDays } from '@/server/dashboard.ts';
import { requireStaff } from '@/server/staff.ts';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const staff = await requireStaff();
  const t = await getTranslations('dashboard');
  const days = dashboardDays((await searchParams).days);
  const data = await dashboardData(staff, days);
  const metrics = [
    'organizations',
    'users',
    'events',
    'upcoming',
    'orders',
    'tickets',
    'subscriptions',
    'newOrganizations',
  ] as const;
  const attention = [
    ['suspended', data.totals.suspended, '/tenants'],
    ['payoutsHeld', data.totals.payoutsHeld, '/tenants'],
    ['pendingRefunds', data.totals.pendingRefunds, '/tenants'],
    ['reconciliation', data.totals.reconciliation, '/tenants'],
    ['pastDue', data.totals.pastDue, staff.can('plans') ? '/plans' : '/tenants'],
    ['openDisputes', data.totals.openDisputes, '/tenants'],
  ] as const;
  const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });
  const amount = (minor: string, currency: string) => formatMoney(money(Number(minor), currency), 'en');
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <form className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="days" className="text-caption font-bold">
              {t('period')}
            </label>
            <Select id="days" name="days" defaultValue={String(days)} className="field">
              {[7, 30, 90].map((n) => (
                <option key={n} value={n}>
                  {t('lastDays', { days: n })}
                </option>
              ))}
            </Select>
          </div>
          <button type="submit" className={buttonClass('secondary')}>
            {t('refresh')}
          </button>
        </form>
        <div className="flex flex-wrap gap-2">
          <Link href="/tenants" className={buttonClass('secondary')}>
            {t('tenants')}
          </Link>
          {staff.can('createTenant') ? (
            <Link href="/tenants/new" className={buttonClass('primary')}>
              {t('add')}
            </Link>
          ) : null}
        </div>
      </div>
      <p className="text-caption text-ink-2">{t('scope')}</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((key) => (
          <Card key={key}>
            <p className="text-caption text-ink-2">{t(`metrics.${key}`)}</p>
            <p className="mt-2 text-[30px] font-extrabold tabular-nums">
              {data.totals[key].toLocaleString('en')}
            </p>
            <p className="mt-1 text-caption text-ink-2">
              {key === 'newOrganizations' ? t('lastDays', { days }) : t('current')}
            </p>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <TrendChart title={t('growth')} rows={data.trend} metric="organizations" tableLabel={t('table')} />
        <TrendChart title={t('orderActivity')} rows={data.trend} metric="orders" tableLabel={t('table')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {(['periodOrders', 'paidOrders', 'paymentFailed'] as const).map((key) => (
          <Card key={key}>
            <p className="text-caption text-ink-2">{t(`metrics.${key}`)}</p>
            <p className="mt-2 text-[26px] font-bold tabular-nums">{data.totals[key].toLocaleString('en')}</p>
            <p className="text-caption text-ink-2">{t('lastDays', { days })}</p>
          </Card>
        ))}
      </div>
      <Card className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold">{t('financials')}</h2>
          {staff.can('fees') ? (
            <Link href="/commission" className="text-caption underline">
              {t('commissionReport')}
            </Link>
          ) : null}
        </div>
        <p className="mt-2 text-caption text-ink-2">{t('financialHint')}</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-body">
            <caption className="sr-only">{t('financials')}</caption>
            <thead>
              <tr>
                {['currency', 'gross', 'refunds', 'commission'].map((key) => (
                  <th
                    key={key}
                    scope="col"
                    className="whitespace-nowrap px-3 py-3 text-start text-caption font-bold"
                  >
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.financials.map((row) => (
                <tr key={row.currency} className="border-t border-line">
                  <td className="px-3 py-3">{row.currency}</td>
                  <td className="px-3 py-3 tabular-nums">{amount(row.gross, row.currency)}</td>
                  <td className="px-3 py-3 tabular-nums">{amount(row.refunds, row.currency)}</td>
                  <td className="px-3 py-3 tabular-nums">{amount(row.commission, row.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.financials.length === 0 ? <p className="mt-4 text-body text-ink-2">{t('emptyMoney')}</p> : null}
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <DistributionChart
          title={t('organizationStatus')}
          rows={data.organizationStatus}
          empty={t('empty')}
          label={(key) => t(`statuses.${key}`)}
        />
        <DistributionChart
          title={t('eventStatus')}
          rows={data.eventStatus}
          empty={t('empty')}
          label={(key) => t(`statuses.${key}`)}
        />
        <DistributionChart title={t('planUsage')} rows={data.plans} empty={t('empty')} />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl font-bold">{t('attention')}</h2>
          <ul className="mt-4 divide-y divide-line">
            {attention.map(([key, count, href]) => (
              <li key={key}>
                <Link href={href} className="flex items-center justify-between gap-4 py-3 text-body">
                  <span>{t(key)}</span>
                  <span className="rounded-control bg-surface-solid px-3 py-1 font-bold tabular-nums">
                    {count.toLocaleString('en')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-caption text-ink-2">{t('attentionHint')}</p>
        </Card>
        <Card>
          <h2 className="text-xl font-bold">{t('recent')}</h2>
          <ul className="mt-4 divide-y divide-line">
            {data.recent.map((org) => (
              <li key={org.id} className="py-3">
                <Link href={`/tenants/${org.id}`} className="block font-bold underline underline-offset-2">
                  {org.name}
                </Link>
                <div className="mt-1 flex flex-wrap justify-between gap-2 text-caption text-ink-2">
                  <span className="break-all">
                    {org.slug} · {t(`statuses.${org.status}`)}
                  </span>
                  <time dateTime={new Date(org.created).toISOString()}>
                    {date.format(new Date(org.created))}
                  </time>
                </div>
              </li>
            ))}
          </ul>
          {data.recent.length === 0 ? <p className="mt-4 text-body text-ink-2">{t('empty')}</p> : null}
        </Card>
      </div>
    </Shell>
  );
}
