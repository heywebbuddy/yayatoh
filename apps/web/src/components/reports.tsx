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

/** A metric's value(s) as text: money per currency (never summed across currencies). */
export function metricText(ms: readonly MetricValue[], key: MetricKey, locale: string): string[] {
  return valuesOf(ms, key).map((m) =>
    m.unit === 'money'
      ? fmtMoney(m.value, m.currency ?? 'USD', locale)
      : m.unit === 'percent'
        ? fmtPercent(m.value, locale)
        : formatNumber(m.value, locale),
  );
}

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
    <p className="text-caption text-zinc-500" data-as-of={asOf.toISOString()}>
      <time dateTime={asOf.toISOString()} title={full}>
        {t('asOf', { time: rel })}
      </time>
    </p>
  );
}

/** One key number: label, value (one line per currency for money), and a note. */
export function Kpi({ label, values, note }: { label: string; values: string[]; note?: ReactNode }) {
  return (
    <Card className="flex flex-col gap-2.5 px-[22px]">
      <Label>{label}</Label>
      <div className="flex flex-col gap-1">
        {values.map((v) => (
          <p key={v} className="text-[32px] leading-none font-light tracking-[-0.045em] tabular-nums">
            {v}
          </p>
        ))}
      </div>
      {note ? <p className="text-[13px] text-zinc-500">{note}</p> : null}
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
                  ? 'inline-flex min-h-9 items-center rounded-pill bg-zinc-900 px-4 text-body text-white'
                  : 'inline-flex min-h-9 items-center rounded-pill border border-zinc-200 bg-white px-4 text-body text-zinc-700 hover:bg-zinc-50'
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
