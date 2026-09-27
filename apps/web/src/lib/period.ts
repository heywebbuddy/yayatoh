/** Report periods for the org home (M1.12): presets or custom calendar days in the org's timezone. */
export const PERIODS = ['7d', '30d', '90d', 'month', 'year', 'all', 'custom'] as const;
export type Period = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: Period = '30d';

export interface ResolvedPeriod {
  readonly period: Period;
  /** Inclusive calendar days (`YYYY-MM-DD`); both absent for all time. */
  readonly from?: string;
  readonly to?: string;
  /** Custom dates that could not be used (the default period is shown instead). */
  readonly error?: 'badRange' | 'badDate';
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (d: string | undefined): d is string =>
  Boolean(
    d &&
      DAY.test(d) &&
      !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) &&
      new Date(`${d}T00:00:00Z`).toISOString().startsWith(d),
  );

/** Today's calendar day in `timeZone`. */
export function localDay(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const minusDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

export function resolvePeriod(
  sp: { period?: string; from?: string; to?: string },
  timeZone: string,
  now: Date,
): ResolvedPeriod {
  const today = localDay(now, timeZone);
  const preset = (p: Period): ResolvedPeriod => {
    switch (p) {
      case '7d':
        return { period: p, from: minusDays(today, 6), to: today };
      case '90d':
        return { period: p, from: minusDays(today, 89), to: today };
      case 'month':
        return { period: p, from: `${today.slice(0, 8)}01`, to: today };
      case 'year':
        return { period: p, from: `${today.slice(0, 5)}01-01`, to: today };
      case 'all':
        return { period: p };
      default:
        return { period: '30d', from: minusDays(today, 29), to: today };
    }
  };
  const p = (PERIODS as readonly string[]).includes(sp.period ?? '') ? (sp.period as Period) : DEFAULT_PERIOD;
  if (p !== 'custom') return preset(p);
  if (!validDay(sp.from) || !validDay(sp.to)) return { ...preset(DEFAULT_PERIOD), error: 'badDate' };
  if (sp.from > sp.to) return { ...preset(DEFAULT_PERIOD), error: 'badRange' };
  return { period: 'custom', from: sp.from, to: sp.to };
}
