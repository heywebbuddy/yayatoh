import { engagementScore, noShowPropensityBps } from './formulas.ts';

/** One participation row, as the stats read it (crm `event_participation`). */
export interface StatsParticipation {
  readonly eventId: string;
  readonly registered: boolean;
  readonly checkedIn: boolean;
  readonly tickets: number;
  readonly orders: number;
  readonly spendMinor: number;
  readonly currency: string;
  readonly registeredAt: Date;
}

/** Whether an event is over (ended and not cancelled) at compute time, from the events module. */
export type EventOver = (eventId: string) => boolean;

export interface StatsSignals {
  readonly sessionsAttended: number;
  readonly campaignsOpened: number;
  readonly firstAt: Date | null;
  readonly lastAt: Date | null;
}

export interface ComputedScores {
  readonly events: number;
  readonly eventsRegistered: number;
  readonly eventsAttended: number;
  readonly pastRegistered: number;
  readonly noShows: number;
  readonly sessionsAttended: number;
  readonly campaignsOpened: number;
  readonly orders: number;
  readonly monetaryMinor: number;
  readonly monetaryCurrency: string;
  readonly firstSeenAt: Date | null;
  readonly lastSeenAt: Date | null;
  readonly engagementScore: number;
  readonly noShowBps: number;
}

export interface ComputedCurrencyStats {
  readonly currency: string;
  readonly orders: number;
  readonly tickets: number;
  readonly events: number;
  readonly eventsAttended: number;
  readonly spendMinor: number;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
}

const minDate = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a <= b ? a : b);
const maxDate = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a >= b ? a : b);

/**
 * One contact's stats from their participation rows and signals (M6.1b). Pure: the same inputs
 * always give the same numbers, so recomputing after a replayed event never double-counts.
 * - `events` (RFM frequency): events taken part in, on the list or as a buyer;
 * - `eventsRegistered`: on the list; `eventsAttended`: on the list and checked in;
 * - `pastRegistered` / `noShows`: registrations for events that are over, and those without a
 *   check-in (the no-show propensity's inputs);
 * - lifetime value per currency (net of refunds, as the buyer) and `monetaryMinor` in the org's
 *   currency; first and last seen across registrations and signals.
 */
export function computeContactStats(input: {
  readonly participation: readonly StatsParticipation[];
  readonly signals: StatsSignals;
  readonly orgCurrency: string;
  readonly isOver: EventOver;
}): { scores: ComputedScores; currencies: ComputedCurrencyStats[] } | null {
  const { participation: rows, signals } = input;
  if (rows.length === 0 && signals.sessionsAttended === 0 && signals.campaignsOpened === 0) return null;
  let eventsRegistered = 0;
  let eventsAttended = 0;
  let pastRegistered = 0;
  let noShows = 0;
  let orders = 0;
  let first: Date | null = signals.firstAt;
  let last: Date | null = signals.lastAt;
  const byCurrency = new Map<string, ComputedCurrencyStats>();
  for (const r of rows) {
    const attended = r.registered && r.checkedIn;
    if (r.registered) eventsRegistered += 1;
    if (attended) eventsAttended += 1;
    if (r.registered && input.isOver(r.eventId)) {
      pastRegistered += 1;
      if (!r.checkedIn) noShows += 1;
    }
    orders += r.orders;
    first = minDate(first, r.registeredAt);
    last = maxDate(last, r.registeredAt);
    const c = byCurrency.get(r.currency);
    byCurrency.set(r.currency, {
      currency: r.currency,
      orders: (c?.orders ?? 0) + r.orders,
      tickets: (c?.tickets ?? 0) + r.tickets,
      events: (c?.events ?? 0) + 1,
      eventsAttended: (c?.eventsAttended ?? 0) + (attended ? 1 : 0),
      spendMinor: (c?.spendMinor ?? 0) + r.spendMinor,
      firstSeenAt: minDate(c?.firstSeenAt ?? null, r.registeredAt) as Date,
      lastSeenAt: maxDate(c?.lastSeenAt ?? null, r.registeredAt) as Date,
    });
  }
  const currencies = [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  return {
    scores: {
      events: rows.length,
      eventsRegistered,
      eventsAttended,
      pastRegistered,
      noShows,
      sessionsAttended: signals.sessionsAttended,
      campaignsOpened: signals.campaignsOpened,
      orders,
      monetaryMinor: byCurrency.get(input.orgCurrency)?.spendMinor ?? 0,
      monetaryCurrency: input.orgCurrency,
      firstSeenAt: first,
      lastSeenAt: last,
      engagementScore: engagementScore({
        eventsAttended,
        sessionsAttended: signals.sessionsAttended,
        campaignsOpened: signals.campaignsOpened,
      }),
      noShowBps: noShowPropensityBps(pastRegistered, noShows),
    },
    currencies,
  };
}
