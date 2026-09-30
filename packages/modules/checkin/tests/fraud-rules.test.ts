import { describe, expect, it } from 'vitest';
import {
  ALERT_WINDOW_MS,
  alertsFor,
  chatReportSignal,
  checkoutRiskSignal,
  FRAUD_SEVERITY,
  FRAUD_SIGNAL_KINDS,
  shouldAlert,
  signalSubject,
} from '../src/index.ts';

/** M1.9e: how other modules' outcomes map to signals, subjects, and the alert window (pure). */
describe('checkout risk → signal', () => {
  it('a block with a payment-failure rule is card testing; other blocks are order velocity', () => {
    expect(checkoutRiskSignal('block', ['payment_failures_block'])).toEqual({
      kind: 'card_testing',
      severity: 'high',
    });
    expect(checkoutRiskSignal('block', ['email_velocity_block', 'payment_failures_block']).kind).toBe(
      'card_testing',
    );
    expect(checkoutRiskSignal('block', ['email_velocity_block'])).toEqual({
      kind: 'checkout_blocked',
      severity: 'high',
    });
    // An unknown rule id still raises the outcome's generic kind.
    expect(checkoutRiskSignal('block', ['some_future_rule']).kind).toBe('checkout_blocked');
  });

  it('a review is purchase velocity (high) when a velocity rule fired, else a country mismatch (medium)', () => {
    expect(checkoutRiskSignal('review', ['email_velocity_review'])).toEqual({
      kind: 'purchase_velocity',
      severity: 'high',
    });
    expect(checkoutRiskSignal('review', ['country_mismatch_review', 'email_velocity_review']).kind).toBe(
      'purchase_velocity',
    );
    expect(checkoutRiskSignal('review', ['country_mismatch_review'])).toEqual({
      kind: 'country_mismatch',
      severity: 'medium',
    });
  });
});

describe('chat report → signal', () => {
  it('only organizer reports raise a signal; severity follows the reason', () => {
    expect(chatReportSignal('organizer', 'abuse')).toEqual({ kind: 'chat_abuse', severity: 'high' });
    expect(chatReportSignal('organizer', 'spam')).toEqual({ kind: 'chat_abuse', severity: 'medium' });
    expect(chatReportSignal('organizer', 'other')).toEqual({ kind: 'chat_abuse', severity: 'low' });
    // A contact's report about the organizer goes to Yayatoh staff only.
    expect(chatReportSignal('contact', 'abuse')).toBeNull();
  });
});

describe('severity rules', () => {
  it('every kind has a severity; door kinds keep theirs from M1.9d', () => {
    for (const k of FRAUD_SIGNAL_KINDS) expect(['low', 'medium', 'high']).toContain(FRAUD_SEVERITY[k]);
    expect(FRAUD_SEVERITY.two_entrances).toBe('high');
    expect(FRAUD_SEVERITY.impossible_travel).toBe('high');
    expect(FRAUD_SEVERITY.device_velocity).toBe('medium');
    expect(FRAUD_SEVERITY.rejected_burst).toBe('low');
  });

  it('only high severity alerts', () => {
    expect(alertsFor('high')).toBe(true);
    expect(alertsFor('medium')).toBe(false);
    expect(alertsFor('low')).toBe(false);
  });
});

describe('subjects', () => {
  const none = {
    eventId: null,
    ticketId: null,
    orderId: null,
    contactId: null,
    threadId: null,
    deviceId: null,
    userId: null,
  };
  it('picks the most specific subject: ticket, order, contact, thread, device, user, event', () => {
    const all = {
      eventId: 'e',
      ticketId: 't',
      orderId: 'o',
      contactId: 'c',
      threadId: 'th',
      deviceId: 'd',
      userId: 'u',
    };
    expect(signalSubject(all)).toEqual({ type: 'ticket', id: 't' });
    expect(signalSubject({ ...all, ticketId: null })).toEqual({ type: 'order', id: 'o' });
    expect(signalSubject({ ...all, ticketId: null, orderId: null })).toEqual({ type: 'contact', id: 'c' });
    expect(signalSubject({ ...none, threadId: 'th', eventId: 'e' })).toEqual({ type: 'thread', id: 'th' });
    expect(signalSubject({ ...none, deviceId: 'd', userId: 'u' })).toEqual({ type: 'device', id: 'd' });
    expect(signalSubject({ ...none, userId: 'u', eventId: 'e' })).toEqual({ type: 'user', id: 'u' });
    expect(signalSubject({ ...none, eventId: 'e' })).toEqual({ type: 'event', id: 'e' });
    expect(signalSubject(none)).toBeNull();
  });
});

describe('alert dedupe window', () => {
  const t0 = new Date('2027-12-01T20:00:00Z');
  const later = (ms: number) => new Date(t0.getTime() + ms);
  it('alerts a subject once per hour, again after the window; never for medium or low', () => {
    expect(shouldAlert('high', t0, null)).toBe(true);
    expect(shouldAlert('high', later(60_000), t0)).toBe(false);
    expect(shouldAlert('high', later(ALERT_WINDOW_MS - 1), t0)).toBe(false);
    expect(shouldAlert('high', later(ALERT_WINDOW_MS), t0)).toBe(true);
    // A signal processed out of order (raised before the last alert) doesn't alert again.
    expect(shouldAlert('high', t0, later(1000))).toBe(false);
    expect(shouldAlert('medium', t0, null)).toBe(false);
    expect(shouldAlert('low', t0, null)).toBe(false);
  });
});
