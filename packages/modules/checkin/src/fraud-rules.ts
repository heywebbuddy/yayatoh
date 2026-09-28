import { FRAUD_SEVERITY, type FraudSeverity, type FraudSignalKind } from './schema.ts';

/**
 * Pure rules for the one fraud-signal model (M1.9e): how other modules' outcomes map to signals,
 * what a signal is about (its subject) and when the team is alerted. Unit-tested without a DB.
 */

/** Checkout risk rule ids (payments' `DEFAULT_CHECKOUT_RISK_RULES`) that point at card testing. */
const CARD_TESTING_RULES = new Set(['payment_failures_block']);
/** Rule ids about many orders from one email (review or block). */
const VELOCITY_RULES = new Set(['email_velocity_review', 'email_velocity_block']);

export interface MappedSignal {
  readonly kind: FraudSignalKind;
  readonly severity: FraudSeverity;
}

const mapped = (kind: FraudSignalKind): MappedSignal => ({ kind, severity: FRAUD_SEVERITY[kind] });

/**
 * A checkout risk outcome (M1.6e) as one signal. A block with a payment-failure rule is card
 * testing; any other block is order velocity. A review is purchase velocity when a velocity rule
 * fired, else a country mismatch. Unknown rule ids still raise the outcome's generic kind.
 */
export function checkoutRiskSignal(outcome: 'review' | 'block', rules: readonly string[]): MappedSignal {
  if (outcome === 'block')
    return mapped(rules.some((r) => CARD_TESTING_RULES.has(r)) ? 'card_testing' : 'checkout_blocked');
  return mapped(rules.some((r) => VELOCITY_RULES.has(r)) ? 'purchase_velocity' : 'country_mismatch');
}

export const CHAT_REPORT_SEVERITY = { abuse: 'high', spam: 'medium', other: 'low' } as const;

/**
 * A chat report (M1.10) as a signal about the contact: only reports the organizer filed. A
 * contact's report about the organizer goes to Yayatoh staff, never to the organizer's team (it
 * could expose the reporter). Severity follows the reason.
 */
export function chatReportSignal(
  reporter: 'organizer' | 'contact',
  reason: keyof typeof CHAT_REPORT_SEVERITY,
): MappedSignal | null {
  if (reporter !== 'organizer') return null;
  return { kind: 'chat_abuse', severity: CHAT_REPORT_SEVERITY[reason] };
}

export type SubjectType = 'ticket' | 'order' | 'contact' | 'thread' | 'device' | 'user' | 'event';

export interface SignalSubjectFields {
  readonly eventId: string | null;
  readonly ticketId: string | null;
  readonly orderId: string | null;
  readonly contactId: string | null;
  readonly threadId: string | null;
  readonly deviceId: string | null;
  readonly userId: string | null;
}

/**
 * What a signal is about, most specific first: the ticket, the order, the contact (or their
 * conversation), the device or signed-in scanner, else the event as a whole.
 */
export function signalSubject(s: SignalSubjectFields): { type: SubjectType; id: string } | null {
  if (s.ticketId) return { type: 'ticket', id: s.ticketId };
  if (s.orderId) return { type: 'order', id: s.orderId };
  if (s.contactId) return { type: 'contact', id: s.contactId };
  if (s.threadId) return { type: 'thread', id: s.threadId };
  if (s.deviceId) return { type: 'device', id: s.deviceId };
  if (s.userId) return { type: 'user', id: s.userId };
  if (s.eventId) return { type: 'event', id: s.eventId };
  return null;
}

/** Only high-severity signals alert the team (in-app, email, push per their preferences). */
export const alertsFor = (severity: FraudSeverity) => severity === 'high';

/** One alert per subject (and event) per this window; later signals only join the list. */
export const ALERT_WINDOW_MS = 60 * 60_000;

/**
 * Whether a new signal should alert, given when its subject last alerted (null = never). Pure:
 * the subscriber reads `lastAlertedAt` under an advisory lock on the subject.
 */
export function shouldAlert(severity: FraudSeverity, raisedAt: Date, lastAlertedAt: Date | null): boolean {
  if (!alertsFor(severity)) return false;
  return lastAlertedAt === null || raisedAt.getTime() - lastAlertedAt.getTime() >= ALERT_WINDOW_MS;
}

/** Blocked checkouts repeat quickly (a card tester retries): one signal per subject per window. */
export const BLOCK_REPEAT_WINDOW_MS = ALERT_WINDOW_MS;
