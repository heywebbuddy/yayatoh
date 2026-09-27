import { formatMoney, money } from '@yayatoh/kernel';

export interface FormatCtx {
  readonly locale: string;
  readonly currency: string;
  readonly timeZone: string;
}

export const formatNumber = (n: number, locale: string) => new Intl.NumberFormat(locale).format(n);

export function formatCompactMoney(minor: number, f: FormatCtx): string {
  const major = minor / 100;
  if (Math.abs(major) < 10_000) return formatMoney(money(minor, f.currency), f.locale);
  return new Intl.NumberFormat(f.locale, {
    style: 'currency',
    currency: f.currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(major);
}

/** Event times render in the event's IANA time zone (CLAUDE.md → Time). */
export function formatEventDateRange(startIso: string, endIso: string, f: FormatCtx): string {
  const fmt = new Intl.DateTimeFormat(f.locale, {
    timeZone: f.timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return fmt.formatRange(new Date(startIso), new Date(endIso));
}

export function formatDate(
  iso: string,
  f: FormatCtx,
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' },
) {
  return new Intl.DateTimeFormat(f.locale, { timeZone: f.timeZone, ...opts }).format(new Date(iso));
}

/** Format message parameters by naming convention (see demo Msg). */
export function formatParams(
  params: Readonly<Record<string, string | number>> | undefined,
  f: FormatCtx,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (typeof v === 'number' && k.endsWith('Minor')) {
      const name = k.slice(0, -5);
      const s = formatCompactMoney(v, f);
      out[name] = name === 'delta' && v > 0 ? `+${s}` : s;
    } else if (typeof v === 'number' && k === 'delta') {
      out.delta = new Intl.NumberFormat(f.locale, { signDisplay: 'exceptZero' }).format(v);
    } else if (typeof v === 'string' && k.endsWith('Date')) {
      out[k.slice(0, -4)] = formatDate(`${v}T12:00:00Z`, f);
    } else if (typeof v === 'number') {
      out[k] = formatNumber(v, f.locale);
    } else {
      out[k] = v;
    }
  }
  return out;
}
