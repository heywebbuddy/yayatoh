import { formatMoney, money } from '@yayatoh/kernel';
import type { MetricKey, MetricValue } from '@yayatoh/reports';
import { Card, Label } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';

export const fmtMoney = (minor: number, currency: string, locale: string) =>
  formatMoney(money(minor, currency), locale);

export const fmtPercent = (bps: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(bps / 10_000);

/** The values of one metric (money: one per currency, in report order). */
export const valuesOf = (ms: readonly MetricValue[], key: MetricKey) => ms.filter((m) => m.key === key);
export const countOf = (ms: readonly MetricValue[], key: MetricKey) => valuesOf(ms, key)[0]?.value ?? 0;

/** One shown value; money carries its ISO currency code. */
export interface KpiValue {
  readonly text: string;
  readonly code?: string;
}

/**
 * A metric's value(s): money one per currency, each with its code (QA #31: "$0.00" and "₹0.00"
 * side by side read as one figure). Never converted, never summed across currencies.
 */
export function metricAmounts(ms: readonly MetricValue[], key: MetricKey, locale: string): KpiValue[] {
  return valuesOf(ms, key).map((m) =>
    m.unit === 'money'
      ? { text: fmtMoney(m.value, m.currency ?? 'USD', locale), code: m.currency ?? 'USD' }
      : { text: m.unit === 'percent' ? fmtPercent(m.value, locale) : formatNumber(m.value, locale) },
  );
}

/** A metric's value(s) as text ("$12.00 USD"): money per currency (never summed across currencies). */
export function metricText(ms: readonly MetricValue[], key: MetricKey, locale: string): string[] {
  return metricAmounts(ms, key, locale).map((v) => (v.code ? `${v.text} ${v.code}` : v.text));
}

/** The currencies a money metric has values in. */
export const currenciesOf = (ms: readonly MetricValue[], key: MetricKey) =>
  new Set(valuesOf(ms, key).flatMap((m) => (m.currency ? [m.currency] : [])));

/** "Updated now" / "Updated 2 minutes ago": every report shows when its numbers were read. */
export async function AsOf({ asOf, locale }: { asOf: Date; locale: string }) {
  const t = await getTranslations('reports');
  const secs = Math.round((asOf.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const rel =
    Math.abs(secs) < 60
      ? rtf.format(0, 'second')
      : Math.abs(secs) < 3600
        ? rtf.format(Math.round(secs / 60), 'minute')
        : rtf.format(Math.round(secs / 3600), 'hour');
  const full = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(asOf);
  return (
    <p className="text-caption text-ink-2" data-as-of={asOf.toISOString()}>
      <time dateTime={asOf.toISOString()} title={full}>
        {t('asOf', { time: rel })}
      </time>
    </p>
  );
}

/** One key number: label, value (one line per currency for money), and a note. */
export function Kpi({
  label,
  values,
  note,
}: {
  label: string;
  values: readonly (string | KpiValue)[];
  note?: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-2.5 px-[22px]">
      <Label>{label}</Label>
      <div className="flex flex-col gap-1">
        {values.map((value) => {
          const v = typeof value === 'string' ? { text: value } : value;
          return (
            <p
              key={`${v.text}-${v.code ?? ''}`}
              className="text-[32px] leading-none font-extrabold tracking-[-0.045em] tabular-nums"
            >
              {v.text}
              {v.code ? (
                <span className="text-[13px] font-bold tracking-normal text-ink-2"> {v.code}</span>
              ) : null}
            </p>
          );
        })}
      </div>
      {note ? <p className="text-[13px] text-ink-2">{note}</p> : null}
    </Card>
  );
}

export function KpiGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      {children}
    </section>
  );
}

/** Overview · Bookings · Finance for one event's reports. */
export async function ReportTabs({
  base,
  current,
  finance,
}: {
  base: string;
  current: 'overview' | 'bookings' | 'finance';
  finance: boolean;
}) {
  const t = await getTranslations('reports.tabs');
  const tabs = [
    { key: 'overview', href: base },
    { key: 'bookings', href: `${base}/bookings` },
    ...(finance ? [{ key: 'finance', href: `${base}/finance` }] : []),
  ] as const;
  return (
    <nav aria-label={t('label')}>
      <ul className="flex list-none flex-wrap gap-2 p-0">
        {tabs.map((tab) => (
          <li key={tab.key}>
            <Link
              href={tab.href}
              aria-current={tab.key === current ? 'page' : undefined}
              className={
                tab.key === current
                  ? 'inline-flex min-h-9 items-center rounded-pill bg-tag px-4 text-body text-white'
                  : 'inline-flex min-h-9 items-center rounded-pill border border-line bg-surface px-4 text-body text-ink-2 hover:bg-surface-2'
              }
            >
              {t(tab.key)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
