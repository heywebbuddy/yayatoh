import type { TicketSummary } from './api';

export interface TicketGroup {
  readonly key: string;
  readonly event: TicketSummary['event'];
  readonly organizerName: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly data: TicketSummary[];
}

/** When a ticket admits: its own date on a multi-date event, else the event's. */
export const ticketStart = (t: TicketSummary): string => t.date?.startsAt ?? t.event.startsAt;
export const ticketEnd = (t: TicketSummary): string => t.date?.endsAt ?? t.event.endsAt;

/**
 * Tickets grouped by event (and date, for multi-date events), in the order the server sent them:
 * soonest first for upcoming, latest first for past.
 */
export function groupByEvent(tickets: readonly TicketSummary[]): TicketGroup[] {
  const groups = new Map<string, TicketGroup>();
  for (const t of tickets) {
    const key = `${t.event.id}|${ticketStart(t)}`;
    const existing = groups.get(key);
    if (existing) existing.data.push(t);
    else
      groups.set(key, {
        key,
        event: t.event,
        organizerName: t.organizerName,
        startsAt: ticketStart(t),
        endsAt: ticketEnd(t),
        data: [t],
      });
  }
  return [...groups.values()];
}
