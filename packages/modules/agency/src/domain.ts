/**
 * Pure rules of the agency pages (M6.7a), unit-tested in tests/domain.test.ts.
 */

interface Timed {
  readonly name: string;
  readonly status: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

const ACTIVE = new Set(['draft', 'published', 'postponed']);

/** The client's next event: the soonest one not cancelled that has not started yet. */
export function nextEvent<T extends Timed>(events: readonly T[], now: Date): T | null {
  let best: T | null = null;
  for (const e of events)
    if (ACTIVE.has(e.status) && e.startsAt > now && (!best || e.startsAt < best.startsAt)) best = e;
  return best;
}

/** Published events running right now. */
export function liveCount(events: readonly Timed[], now: Date): number {
  return events.filter((e) => e.status === 'published' && e.startsAt <= now && e.endsAt > now).length;
}

/** Check-in rate in basis points (0 when nothing is valid). */
export const checkinBps = (checkins: number, valid: number) =>
  valid <= 0 ? 0 : Math.min(10_000, Math.round((checkins / valid) * 10_000));

export interface ReportRow {
  readonly eventsTotal: number;
  readonly eventsUpcoming: number;
  readonly ordersSold: number;
  readonly ticketsValid: number;
  readonly checkins: number;
  readonly sends: number;
  readonly clicks: number;
  /** Gross sales per currency, or null without the client's finance opt-in. */
  readonly revenue: Readonly<Record<string, number>> | null;
}

export interface ReportTotals {
  readonly clients: number;
  readonly eventsTotal: number;
  readonly eventsUpcoming: number;
  readonly ordersSold: number;
  readonly ticketsValid: number;
  readonly checkins: number;
  readonly checkinBps: number;
  readonly sends: number;
  readonly clicks: number;
  /** Per currency, over the clients that opted in to finance only (never added across currencies). */
  readonly revenue: Readonly<Record<string, number>>;
  /** How many clients' money is in `revenue`. */
  readonly financeClients: number;
}

/** Totals across clients for the Reports page. Money is summed per currency, finance clients only. */
export function reportTotals(rows: readonly ReportRow[]): ReportTotals {
  const revenue: Record<string, number> = {};
  let financeClients = 0;
  const sum = (k: keyof Omit<ReportRow, 'revenue'>) => rows.reduce((n, r) => n + r[k], 0);
  for (const r of rows) {
    if (!r.revenue) continue;
    financeClients += 1;
    for (const [cur, v] of Object.entries(r.revenue)) revenue[cur] = (revenue[cur] ?? 0) + v;
  }
  const ticketsValid = sum('ticketsValid');
  const checkins = sum('checkins');
  return {
    clients: rows.length,
    eventsTotal: sum('eventsTotal'),
    eventsUpcoming: sum('eventsUpcoming'),
    ordersSold: sum('ordersSold'),
    ticketsValid,
    checkins,
    checkinBps: checkinBps(checkins, ticketsValid),
    sends: sum('sends'),
    clicks: sum('clicks'),
    revenue,
    financeClients,
  };
}
