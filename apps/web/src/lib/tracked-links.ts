import { formatMoney, money } from '@yayatoh/kernel';
import type { MoneyTotalDto } from '@yayatoh/marketing';

/** The origin tracked links are shown with (the same as event short links). */
export const linkOrigin = () => (process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** Revenue per currency, e.g. "$40.00 · €12.00"; a dash when there is none. */
export function revenueText(totals: readonly MoneyTotalDto[], locale: string): string {
  return totals.length
    ? totals.map((m) => formatMoney(money(m.amountMinor, m.currency), locale)).join(' · ')
    : '—';
}

/** Basis points as a localized percentage. */
export const percent = (bps: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(bps / 10_000);
