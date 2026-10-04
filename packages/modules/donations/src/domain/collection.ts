import { utcToZonedInput, zonedTimeToUtc } from '@yayatoh/kernel';

/**
 * M4.8e cards on file and pledge collection (P4-12, P4-14): the pure rules. Times are planned in
 * the event's time zone (CLAUDE.md → Time).
 */

/** A saved card: waiting for the provider's hosted step, usable, refused there, or removed. */
export const CARD_STATUSES = ['pending', 'active', 'failed', 'removed'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

/** Where the guest started saving the card (P4-14's two entry points, and the party's own page). */
export const CARD_SOURCES = ['checkout', 'checkin', 'table', 'party'] as const;
export type CardSource = (typeof CARD_SOURCES)[number];

/**
 * A pledge's collection: `scheduled` (a card charge planned at `charge_at`), `charging` (claimed
 * by a run; the provider call is in flight or must be replayed with the same key), `invoiced`
 * (a pay link and reminders), then `paid` (a card or a pay link), `paid_offline` (recorded by the
 * host) or `written_off` (with a note).
 */
export const COLLECTION_STATUSES = [
  'scheduled',
  'charging',
  'invoiced',
  'paid',
  'paid_offline',
  'written_off',
] as const;
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];
/** Still owed: counts as unpaid (reminders, the alert). */
export const OPEN_COLLECTION_STATUSES = ['scheduled', 'charging', 'invoiced'] as const;

/** How a host-recorded payment arrived (P4-12). */
export const OFFLINE_METHODS = ['check', 'wire', 'stock', 'daf', 'cash', 'other'] as const;
export type OfflineMethod = (typeof OFFLINE_METHODS)[number];

/** One try to collect: a charge of the saved card, or a pay-link checkout. */
export const ATTEMPT_KINDS = ['card', 'link'] as const;
export const ATTEMPT_STATUSES = ['pending', 'paid', 'failed'] as const;

/** The morning charge runs at this local time (P4-12: "tomorrow at 9:00"). */
export const CHARGE_HOUR = 9;
/** …and at least this long after the night is closed, so donors can read the summary first. */
export const CHARGE_MIN_NOTICE_HOURS = 6;
/** A declined card is retried once, a day later (P4-12), then gets a pay link. */
export const MAX_CARD_ATTEMPTS = 2;
export const RETRY_AFTER_HOURS = 24;
/** A pledge invoice is due 30 days after it is sent (P4-12's default). */
export const INVOICE_DUE_DAYS = 30;
/** Reminders after the invoice, at 09:00 local, until paid (P4-12). */
export const REMINDER_DAYS = [7, 21, 28] as const;
/** The host's alert: pledges still unpaid this long after the event (P4-12). */
export const UNPAID_ALERT_DAYS = 14;
/** Saved cards are removed from the charity's customer this long after the event (P4-14). */
export const CARD_REMOVE_DAYS = 30;
/** A run that claimed a charge and vanished: replay it (same key) after this long. */
export const STALE_CHARGE_MINUTES = 10;

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar day of an instant, `YYYY-MM-DD`. */
export const localDay = (at: Date, timeZone: string) => utcToZonedInput(at, timeZone).slice(0, 10);

/** `YYYY-MM-DD` plus `days` (calendar arithmetic, no time zone involved). */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  return new Date(d.getTime() + days * DAY).toISOString().slice(0, 10);
}

/** `hour`:00 local time on `day` in `timeZone` (DST-safe). */
export const atLocal = (day: string, hour: number, timeZone: string) =>
  zonedTimeToUtc(`${day}T${pad(hour)}:00`, timeZone);

/**
 * When a pledge's saved card is charged after the night is closed: the first 09:00 in the event's
 * time zone at least six hours later ("tomorrow morning", also when the host closes after midnight).
 */
export function chargeTimeFor(closedAt: Date, timeZone: string): Date {
  const earliest = closedAt.getTime() + CHARGE_MIN_NOTICE_HOURS * 3_600_000;
  let day = localDay(closedAt, timeZone);
  for (let i = 0; i < 3; i++) {
    const at = atLocal(day, CHARGE_HOUR, timeZone);
    if (at.getTime() >= earliest) return at;
    day = addDays(day, 1);
  }
  return atLocal(day, CHARGE_HOUR, timeZone);
}

/** The invoice's due day (local) and the reminders' times, from when it was sent. */
export function invoicePlan(invoicedAt: Date, timeZone: string) {
  const today = localDay(invoicedAt, timeZone);
  return {
    dueOn: addDays(today, INVOICE_DUE_DAYS),
    reminders: REMINDER_DAYS.map((d) => atLocal(addDays(today, d), CHARGE_HOUR, timeZone)),
  };
}

/** What follows a declined charge: one retry a day later, then a pay link (P4-12). */
export function afterDecline(
  attempts: number,
  at: Date,
): { next: 'retry'; chargeAt: Date } | { next: 'invoice' } {
  return attempts < MAX_CARD_ATTEMPTS
    ? { next: 'retry', chargeAt: new Date(at.getTime() + RETRY_AFTER_HOURS * 3_600_000) }
    : { next: 'invoice' };
}

/** Pledges are "unpaid after the event" once this instant passes. */
export const unpaidAlertFrom = (eventEndsAt: Date) =>
  new Date(eventEndsAt.getTime() + UNPAID_ALERT_DAYS * DAY);
/** A saved card is removed after this instant. */
export const cardRemoveAfter = (eventEndsAt: Date) =>
  new Date(eventEndsAt.getTime() + CARD_REMOVE_DAYS * DAY);

export interface CardCandidate {
  readonly id: string;
  readonly partyId: string | null;
  readonly guestId: string | null;
  readonly email: string;
  readonly activatedAt: Date | null;
}

/**
 * The saved card that pays a pledge: an active card of the event saved for the pledge's holder
 * (the guest, the guest's party, or the party), else one saved under the holder's email. The
 * newest wins (a guest who saved again replaced the earlier card). null: no consent, no charge.
 */
export function cardForHolder(
  cards: readonly CardCandidate[],
  holder: { guestId: string | null; partyId: string | null; email: string | null },
): CardCandidate | null {
  const newest = (list: readonly CardCandidate[]) =>
    [...list].sort((a, b) => (b.activatedAt?.getTime() ?? 0) - (a.activatedAt?.getTime() ?? 0))[0] ?? null;
  const byId = cards.filter(
    (c) =>
      (holder.guestId !== null && c.guestId === holder.guestId) ||
      (holder.partyId !== null && c.partyId === holder.partyId),
  );
  if (byId.length) return newest(byId);
  const email = holder.email?.trim().toLowerCase();
  if (!email) return null;
  return newest(cards.filter((c) => c.email.trim().toLowerCase() === email));
}
