import { MONEY_GRAINS, type MoneyGrain } from '@yayatoh/reports';
import { roleCan } from '@yayatoh/tenancy';
import { Button, DatePicker, Select, Tabs, tabClass } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { PERIODS, type ResolvedPeriod } from '@/lib/period.ts';

export { dayLabel, deltaOf, exportHref, isGrain, periodQuery } from '@/lib/money.ts';

/**
 * U5 Money dashboards: the pieces every Money page shares — the page switcher, the period form
 * (GET, so a period is a shareable URL) and the comparison chip.
 */

export const MONEY_PAGES = [
  { key: 'overview', path: 'money', needs: 'finance:read' },
  { key: 'payouts', path: 'payouts', needs: 'finance:read' },
  { key: 'sales', path: 'sales-by-event', needs: 'orders:read' },
  { key: 'fees', path: 'fees', needs: 'finance:read' },
] as const;
export type MoneyPage = (typeof MONEY_PAGES)[number]['key'];

/** Overview · Payouts · Sales by event · Fees, for the pages this role may open. */
export async function MoneyTabs({
  org,
  role,
  current,
}: {
  org: string;
  role: Parameters<typeof roleCan>[0];
  current: MoneyPage;
}) {
  const t = await getTranslations('money.tabs');
  const pages = MONEY_PAGES.filter((p) => roleCan(role, p.needs));
  if (pages.length < 2) return null;
  return (
    <Tabs label={t('label')} className="self-start">
      {pages.map((p) => (
        <Link
          key={p.key}
          href={`/o/${org}/${p.path}`}
          aria-current={p.key === current ? 'page' : undefined}
          className={tabClass(p.key === current)}
        >
          {t(p.key)}
        </Link>
      ))}
    </Tabs>
  );
}

/** Period presets or custom days in the org's time zone; the overview adds day/week/month. */
export async function PeriodForm({
  period,
  grain,
}: {
  period: ResolvedPeriod;
  /** Shown on the overview: the chart's bucket size (`auto` follows the period's length). */
  grain?: MoneyGrain | 'auto';
}) {
  const t = await getTranslations();
  const error = period.error ? t(`reports.org.${period.error}`) : undefined;
  return (
    <form method="get" className="flex flex-wrap items-start gap-3" aria-label={t('money.periodForm')}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="money-period" className="text-[13px] font-bold text-ink">
          {t('reports.org.period')}
        </label>
        <Select id="money-period" name="period" defaultValue={period.error ? 'custom' : period.period}>
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {t(`reports.org.periods.${p}`)}
            </option>
          ))}
        </Select>
      </div>
      <DatePicker
        name="from"
        id="money-from"
        label={t('reports.org.from')}
        defaultValue={period.period === 'custom' ? period.from : undefined}
        hint={t('reports.org.customHint')}
      />
      <DatePicker
        name="to"
        id="money-to"
        label={t('reports.org.to')}
        defaultValue={period.period === 'custom' ? period.to : undefined}
        error={error}
      />
      {grain ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="money-grain" className="text-[13px] font-bold text-ink">
            {t('money.grain.label')}
          </label>
          <Select id="money-grain" name="grain" defaultValue={grain}>
            <option value="auto">{t('money.grain.auto')}</option>
            {MONEY_GRAINS.map((g) => (
              <option key={g} value={g}>
                {t(`money.grain.${g}`)}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <Button type="submit" variant="secondary" className="mt-[22px]">
        {t('reports.org.apply')}
      </Button>
    </form>
  );
}
