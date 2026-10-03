import { utcToZonedInput, zonedTimeToUtc } from '@yayatoh/kernel';

/**
 * Invoices (M5.1d, P5-5): pure terms, numbering and money. Amounts are integer minor units; dates
 * are calendar days (`YYYY-MM-DD`) in the event's timezone.
 */

/** INV-00001 */
export const formatInvoiceNumber = (n: number) => `INV-${String(n).padStart(5, '0')}`;

/** The default terms (P5-5): Net 30 from the invoice date, due no later than 7 days before the event. */
export const DEFAULT_TERMS = 'net30_event7' as const;
export const NET_DAYS = 30;
export const DAYS_BEFORE_EVENT = 7;

const DAY_MS = 86_400_000;

const validZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** The calendar day of an instant in a timezone. */
export function localDay(at: Date, timeZone: string): string {
  return utcToZonedInput(at, validZone(timeZone) ? timeZone : 'UTC').slice(0, 10);
}

/** A calendar day plus `days` (negative: earlier). */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export interface InvoiceTerms {
  readonly issuedOn: string;
  readonly dueOn: string;
  /** The start of the due day in the event's timezone (reminders wait from it). */
  readonly dueAt: Date;
}

/**
 * When an invoice is due: 30 days after the invoice date, but no later than 7 days before the
 * event starts (both in the event's timezone). An invoice issued in the last week before the event
 * is due on the day it is issued; never before it.
 */
export function invoiceTerms(i: { issuedAt: Date; eventStart: Date; timeZone: string }): InvoiceTerms {
  const tz = validZone(i.timeZone) ? i.timeZone : 'UTC';
  const issuedOn = localDay(i.issuedAt, tz);
  const net = addDays(issuedOn, NET_DAYS);
  const cap = addDays(localDay(i.eventStart, tz), -DAYS_BEFORE_EVENT);
  const earliest = net < cap ? net : cap;
  const dueOn = earliest < issuedOn ? issuedOn : earliest;
  return { issuedOn, dueOn, dueAt: zonedTimeToUtc(`${dueOn}T00:00`, tz) };
}

/** What is still owed (never negative: an overpayment leaves nothing due). */
export const balanceMinor = (i: { totalMinor: number; paidMinor: number }) =>
  Math.max(0, i.totalMinor - i.paidMinor);

/** Overdue: an open invoice whose due day has passed in the event's timezone. */
export function isOverdue(i: { status: string; dueOn: string }, now: Date, timeZone: string): boolean {
  return i.status === 'open' && localDay(now, timeZone) > i.dueOn;
}

/**
 * The platform-fee part of one payment, so that the parts of all the payments add up to the
 * order's fee exactly once the invoice is paid ("reconciles to the cent"): proportional to what
 * has been paid so far (rounded down), and the payment that settles the balance takes whatever
 * is left. Never more than the payment itself, never more than the fee left.
 */
export function feePartMinor(i: {
  readonly totalMinor: number;
  readonly feeMinor: number;
  /** What succeeded payments paid before this one, and the fee parts they took. */
  readonly paidMinor: number;
  readonly feeAllocatedMinor: number;
  readonly amountMinor: number;
}): number {
  const left = Math.max(0, i.feeMinor - i.feeAllocatedMinor);
  if (i.totalMinor <= 0 || left === 0 || i.amountMinor <= 0) return 0;
  const after = i.paidMinor + i.amountMinor;
  const due =
    after >= i.totalMinor ? left : Math.floor((i.feeMinor * after) / i.totalMinor) - i.feeAllocatedMinor;
  return Math.max(0, Math.min(due, left, i.amountMinor));
}

export type PayAmountProblem = 'nothing_due' | 'amount_too_small' | 'amount_too_large';

/** A payment (pay link or recorded) is 1 minor unit … the balance. */
export function payAmountProblem(amountMinor: number, balance: number): PayAmountProblem | null {
  if (balance <= 0) return 'nothing_due';
  if (!Number.isInteger(amountMinor) || amountMinor < 1) return 'amount_too_small';
  if (amountMinor > balance) return 'amount_too_large';
  return null;
}

/** Normalize a PO number as typed: trimmed, inner whitespace collapsed; empty is none. */
export function normalizePoNumber(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().replace(/\s+/g, ' ');
  return v ? v : null;
}
