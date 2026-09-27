import { utcToZonedInput } from '@yayatoh/kernel';
import type { ScanResult } from './schema.ts';

/** Doors may open this long before the start, and scanning continues this long after the end. */
export const EARLY_ENTRY_MS = 6 * 3_600_000;
export const LATE_ENTRY_MS = 6 * 3_600_000;

/** The calendar day of `instant` in the event's timezone (YYYY-MM-DD). */
export const eventDay = (instant: Date, timeZone: string) => utcToZonedInput(instant, timeZone).slice(0, 10);

export interface RuleInput {
  readonly now: Date;
  readonly event: {
    readonly id: string;
    readonly startsAt: Date;
    readonly endsAt: Date;
    readonly timezone: string;
  };
  readonly ticket: {
    readonly eventId: string;
    readonly status: string;
    readonly accessDates: readonly { readonly date: string }[];
  } | null;
}

/**
 * Everything but the duplicate check (which needs the database): the ticket exists, is live,
 * belongs to this event, and today is inside the event window and one of its access dates.
 */
export function ruleResult(i: RuleInput): Exclude<ScanResult, 'admitted' | 'duplicate'> | 'ok' {
  if (!i.ticket) return 'invalid';
  if (i.ticket.eventId !== i.event.id) return 'wrong_event';
  if (i.ticket.status !== 'active') return 'void';
  const t = i.now.getTime();
  if (t < i.event.startsAt.getTime() - EARLY_ENTRY_MS || t > i.event.endsAt.getTime() + LATE_ENTRY_MS)
    return 'outside_window';
  if (i.ticket.accessDates.length > 0) {
    const today = eventDay(i.now, i.event.timezone);
    if (!i.ticket.accessDates.some((d) => d.date === today)) return 'not_today';
  }
  return 'ok';
}
