'use client';

import { type KpiKey, kpiSpans } from '@yayatoh/command-center/client';
import { formatMoney, money } from '@yayatoh/kernel';
import { cx, Skeleton, StatCard } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';

type Sales = { lines: { currency: string; total: number; today: number }[] };
type Tickets = { sold: number; capacity: number };
type Checkins = { total: number; valid: number };
type Alerts = { alerts: { severity: 'info' | 'warning' | 'critical' }[] };

// Static class names (Tailwind sees them): phone spans, and the tablet-and-up column count.
const BASE_SPAN: Record<number, string> = { 1: 'col-span-1', 2: 'col-span-2' };
const MD_COLS: Record<number, string> = {
  1: 'md:grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
};
const BASE_COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2' };

const num = (n: number, locale: string) => new Intl.NumberFormat(locale).format(n);

/**
 * The KPI row (U4): sales, tickets sold of capacity, check-ins and open alerts — only the ones the
 * member's role may see (`kpiKeys`, the widget loaders' own rule: the door never gets sales). The
 * figures come from the same loaders as the widgets and follow the same live updates. Packed so
 * no tile sits beside an empty cell.
 */
export function KpiRow({
  keys,
  data,
  locale,
}: {
  keys: readonly KpiKey[];
  data: Readonly<Record<string, unknown>>;
  locale: string;
}) {
  const t = useTranslations('commandCenter.kpi');
  const tm = useTranslations('commandCenter');
  const shown = keys.filter((k) => data[k] !== null);
  if (shown.length === 0) return null;
  const spans = kpiSpans(shown.length);
  const m = (minor: number, cur: string) => formatMoney(money(minor, cur), locale);
  const tile = (k: KpiKey) => {
    const d = data[k];
    if (d === undefined)
      return (
        <div className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-5" role="status">
          <span className="sr-only">{tm('loading')}</span>
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      );
    switch (k) {
      case 'sales': {
        const lines = (d as Sales).lines;
        const first = lines[0];
        return (
          <StatCard
            testId="cc-kpi-sales"
            label={t('sales')}
            value={first ? m(first.total, first.currency) : '—'}
            sub={[
              first ? t('salesToday', { amount: m(first.today, first.currency) }) : null,
              ...lines.slice(1).map((l) => m(l.total, l.currency)),
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        );
      }
      case 'tickets': {
        const x = d as Tickets;
        return (
          <StatCard
            testId="cc-kpi-tickets"
            label={t('tickets')}
            value={num(x.sold, locale)}
            sub={x.capacity > 0 ? t('ofCapacity', { capacity: num(x.capacity, locale) }) : t('noCapacity')}
            progress={
              x.capacity > 0
                ? {
                    value: Math.min(x.sold, x.capacity),
                    max: x.capacity,
                    label: tm('meter', { value: x.sold, max: x.capacity }),
                  }
                : undefined
            }
          />
        );
      }
      case 'checkins': {
        const x = d as Checkins;
        return (
          <StatCard
            testId="cc-kpi-checkins"
            label={t('checkins')}
            value={num(x.total, locale)}
            sub={t('ofValid', { valid: num(x.valid, locale) })}
            progress={
              x.valid > 0
                ? {
                    value: Math.min(x.total, x.valid),
                    max: x.valid,
                    label: tm('meter', { value: x.total, max: x.valid }),
                    tone: 'success',
                  }
                : undefined
            }
          />
        );
      }
      case 'alerts': {
        const list = (d as Alerts).alerts;
        const critical = list.filter((a) => a.severity === 'critical').length;
        return (
          <StatCard
            testId="cc-kpi-alerts"
            label={t('alerts')}
            value={num(list.length, locale)}
            sub={list.length === 0 ? t('allClear') : t('critical', { count: critical })}
            delta={critical > 0 ? t('needsYou') : undefined}
            deltaTone="danger"
          />
        );
      }
    }
  };
  return (
    <section aria-labelledby="cc-kpis-title" className="flex flex-col gap-2">
      <h2 id="cc-kpis-title" className="sr-only">
        {t('title')}
      </h2>
      <ul
        className={cx(
          'm-0 grid list-none gap-3.5 p-0',
          BASE_COLS[Math.min(2, shown.length)],
          MD_COLS[spans.mdColumns],
        )}
        data-testid="cc-kpis"
      >
        {shown.map((k, i) => (
          <li key={k} className={cx(BASE_SPAN[spans.base[i] ?? 1], 'md:col-span-1 [&>*]:h-full')}>
            {tile(k)}
          </li>
        ))}
      </ul>
    </section>
  );
}
