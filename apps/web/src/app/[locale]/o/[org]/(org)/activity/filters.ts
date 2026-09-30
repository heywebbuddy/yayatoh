import { zonedTimeToUtc } from '@yayatoh/kernel';

export interface ActivityFilterInput {
  readonly actor?: string;
  readonly action?: string;
  readonly from?: string;
  readonly to?: string;
}

export type ActivityFilterError = 'badDate' | 'backwards';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Activity filters from the query string: org-timezone calendar days → instants (`to` is
 * inclusive of its whole day). Unknown or malformed values are dropped with an error.
 */
export function resolveActivityFilter(
  sp: ActivityFilterInput,
  timeZone: string,
): {
  filter: { actor?: string; action?: string; from?: Date; to?: Date };
  values: { actor: string; action: string; from: string; to: string };
  error: ActivityFilterError | null;
} {
  const actor = (sp.actor ?? '').slice(0, 120);
  const action = (sp.action ?? '').slice(0, 80);
  let from = (sp.from ?? '').trim();
  let to = (sp.to ?? '').trim();
  let error: ActivityFilterError | null = null;
  const valid = (d: string) => DAY.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
  if ((from && !valid(from)) || (to && !valid(to))) {
    error = 'badDate';
    from = valid(from) ? from : '';
    to = valid(to) ? to : '';
  }
  if (from && to && from > to) {
    error = 'backwards';
    from = '';
    to = '';
  }
  const nextDay = (d: string) =>
    new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return {
    filter: {
      ...(actor ? { actor } : {}),
      ...(action ? { action } : {}),
      ...(from ? { from: zonedTimeToUtc(`${from}T00:00`, timeZone) } : {}),
      ...(to ? { to: zonedTimeToUtc(`${nextDay(to)}T00:00`, timeZone) } : {}),
    },
    values: { actor, action, from, to },
    error,
  };
}
