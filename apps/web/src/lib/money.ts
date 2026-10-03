import { MONEY_GRAINS, type MoneyGrain } from '@yayatoh/reports';
import type { DeltaTone } from '@yayatoh/ui';
import type { ResolvedPeriod } from './period.ts';

/** U5 Money dashboards: pure helpers shared by the pages and the CSV route. */

/** The query string of a period (and grain), for links and exports that keep it. */
export function periodQuery(period: ResolvedPeriod, extra: Record<string, string | undefined> = {}) {
  const q = new URLSearchParams();
  q.set('period', period.period);
  if (period.period === 'custom') {
    if (period.from) q.set('from', period.from);
    if (period.to) q.set('to', period.to);
  }
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  return q.toString();
}

export const isGrain = (v: string | undefined): v is MoneyGrain =>
  (MONEY_GRAINS as readonly string[]).includes(v ?? '');

/**
 * The change against the previous period as a chip ("+12%", "−5%", "New"), and its tone: for
 * money in (gross, net, payouts) up is good; for money out (refunds, fees, disputes) it is neutral.
 */
export function deltaOf(
  current: number,
  previous: number | null | undefined,
  locale: string,
  kind: 'in' | 'out',
  newLabel: string,
): { delta?: string; tone: DeltaTone } {
  if (previous === null || previous === undefined) return { tone: 'neutral' };
  if (previous === 0) return current === 0 ? { tone: 'neutral' } : { delta: newLabel, tone: 'primary' };
  const change = (current - previous) / Math.abs(previous);
  const delta = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
    signDisplay: 'exceptZero',
  }).format(change);
  const tone: DeltaTone = kind === 'out' || change === 0 ? 'neutral' : change > 0 ? 'success' : 'danger';
  return { delta, tone };
}

/** A calendar day (`YYYY-MM-DD`, already in the org's zone) for display. */
export function dayLabel(day: string, locale: string, grain: MoneyGrain = 'day') {
  const d = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat(
    locale,
    grain === 'month'
      ? { month: 'short', year: 'numeric', timeZone: 'UTC' }
      : { day: 'numeric', month: 'short', timeZone: 'UTC' },
  ).format(d);
}

/** A localized export link (a plain download, outside the client router). */
export function exportHref(locale: string, org: string, view: string, query: string) {
  const prefix = locale === 'en' ? '' : `/${locale}`;
  return `${prefix}/o/${org}/money/export?view=${view}${query ? `&${query}` : ''}`;
}
