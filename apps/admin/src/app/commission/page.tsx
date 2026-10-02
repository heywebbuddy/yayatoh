import { formatMoney, money } from '@yayatoh/kernel';
import { buttonClass, Card, PageHeader } from '@yayatoh/ui';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { commissionPeriod, commissionReport } from '@/server/reports.ts';
import { requireStaff } from '@/server/staff.ts';

/**
 * Admin commission report (M1.12c): platform fees per org and currency for a period, from the
 * ledger. Staff with finance access only; every view is in the access log.
 */
export default async function CommissionPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const staff = await requireStaff('fees');
  const t = await getTranslations('commission');
  const period = commissionPeriod(await searchParams);
  const rows = await commissionReport(staff, period);
  const fmt = (minor: number, currency: string) => formatMoney(money(minor, currency), 'en');
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.currency, (totals.get(r.currency) ?? 0) + r.netMinor);
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <form className="flex flex-wrap items-end gap-3">
        {(['from', 'to'] as const).map((k) => (
          <div key={k} className="flex flex-col gap-1.5">
            <label htmlFor={`period-${k}`} className="text-caption text-ink-2">
              {t(k)}
            </label>
            <input
              id={`period-${k}`}
              name={k}
              type="date"
              defaultValue={period[k]}
              aria-invalid={k === 'to' && period.error ? true : undefined}
              aria-describedby={k === 'to' && period.error ? 'period-error' : undefined}
              className="field"
            />
          </div>
        ))}
        <button type="submit" className={buttonClass('primary')}>
          {t('apply')}
        </button>
      </form>
      {period.error ? (
        <p id="period-error" role="alert" className="text-body text-danger">
          {t(period.error)}
        </p>
      ) : null}
      <p className="text-caption text-ink-2">{t('range', { from: period.from, to: period.to })}</p>
      {totals.size ? (
        <ul aria-label={t('totals')} className="flex list-none flex-wrap gap-3 p-0">
          {[...totals].map(([c, v]) => (
            <li key={c}>
              <Card className="flex flex-col gap-1">
                <span className="text-label uppercase text-ink-2">{t('totalIn', { currency: c })}</span>
                <span className="text-[28px] font-extrabold tracking-[-0.04em] tabular-nums">
                  {fmt(v, c)}
                </span>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
      <Card className="p-0">
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must be focusable (axe scrollable-region-focusable) */}
        <section className="overflow-x-auto" tabIndex={0} aria-label={t('title')}>
          <table className="w-full text-start text-body">
            <caption className="sr-only">{t('title')}</caption>
            <thead className="text-caption text-ink-2">
              <tr>
                {(['org', 'currency', 'sales', 'charged', 'refunded', 'net'] as const).map((c) => (
                  <th
                    key={c}
                    scope="col"
                    className={`px-4 py-2 font-normal ${c === 'org' || c === 'currency' ? 'text-start' : 'text-end'}`}
                  >
                    {t(`col.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.orgId}-${r.currency}`} className="border-t border-line">
                  <td className="px-4 py-2">
                    <Link href={`/tenants/${r.orgId}`} className="underline underline-offset-2">
                      {r.name}
                    </Link>
                    <span className="block font-mono text-caption text-ink-2">{r.slug}</span>
                  </td>
                  <td className="px-4 py-2 font-mono">{r.currency}</td>
                  <td className="px-4 py-2 text-end tabular-nums">{r.sales}</td>
                  <td className="px-4 py-2 text-end tabular-nums">{fmt(r.chargedMinor, r.currency)}</td>
                  <td className="px-4 py-2 text-end tabular-nums">{fmt(r.refundedMinor, r.currency)}</td>
                  <td className="px-4 py-2 text-end font-medium tabular-nums">
                    {fmt(r.netMinor, r.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {rows.length === 0 ? <p className="px-4 py-6 text-body text-ink-2">{t('empty')}</p> : null}
      </Card>
    </Shell>
  );
}
