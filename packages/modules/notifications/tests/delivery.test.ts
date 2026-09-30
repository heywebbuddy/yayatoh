import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fakeDeliveryAdapter, signFakeDeliveryEvents } from '../src/delivery.ts';
import {
  type DeliveryFact,
  nextDeliveryState,
  SOFT_BOUNCE_WINDOW_MS,
  suppressedReason,
  suppressionFor,
} from '../src/delivery-rules.ts';
import { fakeOutcome } from '../src/transports.ts';

const t0 = new Date('2030-01-10T12:00:00Z');
const later = (h: number) => new Date(t0.getTime() + h * 3_600_000);
const soft = (h: number): DeliveryFact => ({ type: 'bounced', bounceType: 'soft', occurredAt: later(h) });
const delivered = (h: number): DeliveryFact => ({ type: 'delivered', occurredAt: later(h) });

describe('suppression rules', () => {
  it('a hard bounce or a complaint suppresses at once', () => {
    expect(suppressionFor({ type: 'bounced', bounceType: 'hard', occurredAt: t0 }, [])).toBe('hard_bounce');
    expect(suppressionFor({ type: 'complained', occurredAt: t0 }, [])).toBe('complaint');
  });
  it('a delivery never suppresses', () => {
    expect(suppressionFor(delivered(0), [soft(-2), soft(-1)])).toBeNull();
  });
  it('soft bounces suppress on the third within 14 days with no delivery in between', () => {
    expect(suppressionFor(soft(0), [])).toBeNull();
    expect(suppressionFor(soft(2), [soft(0)])).toBeNull();
    expect(suppressionFor(soft(4), [soft(0), soft(2)])).toBe('soft_bounce');
    // A delivery in between resets the count.
    expect(suppressionFor(soft(4), [soft(0), delivered(1), soft(2)])).toBeNull();
    // Bounces older than the window don't count.
    const old = new Date(t0.getTime() - SOFT_BOUNCE_WINDOW_MS - 1);
    expect(
      suppressionFor(soft(4), [{ type: 'bounced', bounceType: 'soft', occurredAt: old }, soft(2)]),
    ).toBeNull();
    // Events after this one (arriving out of order) don't count for it.
    expect(suppressionFor(soft(0), [soft(2), soft(4)])).toBeNull();
  });
  it('the message state keeps the worst news; a retried soft bounce becomes delivered', () => {
    expect(nextDeliveryState(null, delivered(0))).toBe('delivered');
    expect(nextDeliveryState('delivered', { type: 'complained', occurredAt: t0 })).toBe('complained');
    expect(nextDeliveryState('bounced', delivered(1))).toBe('bounced');
    expect(nextDeliveryState('complained', { type: 'bounced', bounceType: 'hard', occurredAt: t0 })).toBe(
      'complained',
    );
    expect(nextDeliveryState('soft_bounced', delivered(1))).toBe('delivered');
    expect(nextDeliveryState(null, soft(0))).toBe('soft_bounced');
  });
  it('maps list reasons to the log reason', () => {
    expect(suppressedReason('hard_bounce')).toBe('bounced');
    expect(suppressedReason('soft_bounce')).toBe('bounced');
    expect(suppressedReason('complaint')).toBe('complained');
  });
});

describe('fake provider webhook verification', () => {
  const secret = 'a'.repeat(64);
  const now = new Date('2030-01-10T12:00:00Z');
  const adapter = fakeDeliveryAdapter(secret, () => now);
  const messageId = '01900000-0000-7000-8000-000000000001';
  const headers = (signature: string) => new Headers({ 'x-fake-email-signature': signature });

  it('accepts a correctly signed delivery and parses its events', () => {
    const { body, signature } = signFakeDeliveryEvents(
      secret,
      [{ id: 'evt-1', type: 'bounced', bounceType: 'hard', messageId, recipient: 'x@example.test' }],
      now,
    );
    const events = adapter.verify(body, headers(signature));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: 'evt-1', type: 'bounced', bounceType: 'hard', messageId });
  });

  it('refuses a tampered body, a wrong secret, a malformed header and an old signature', () => {
    const { body, signature } = signFakeDeliveryEvents(secret, [{ type: 'delivered', messageId }], now);
    expect(() => adapter.verify(body.replace('delivered', 'complained'), headers(signature))).toThrow();
    const other = signFakeDeliveryEvents('b'.repeat(64), [{ type: 'delivered', messageId }], now);
    expect(() => adapter.verify(other.body, headers(other.signature))).toThrow();
    expect(() => adapter.verify(body, headers(''))).toThrow();
    expect(() => adapter.verify(body, headers('t=abc,v1=zz'))).toThrow();
    const stale = signFakeDeliveryEvents(
      secret,
      [{ type: 'delivered', messageId }],
      new Date(now.getTime() - 301_000),
    );
    expect(() => adapter.verify(stale.body, headers(stale.signature))).toThrow(/tolerance/);
  });

  it('refuses a signed body that is not a valid delivery', () => {
    const body = JSON.stringify({ events: [{ id: 'x', type: 'exploded', messageId }] });
    const t = Math.floor(now.getTime() / 1000);
    const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    expect(() => adapter.verify(body, headers(`t=${t},v1=${sig}`))).toThrow();
  });

  it('the fake provider reports by address, like a mailbox simulator', () => {
    expect(fakeOutcome('bounce+abc@example.test')).toEqual([
      expect.objectContaining({ type: 'bounced', bounceType: 'hard' }),
    ]);
    expect(fakeOutcome('softbounce@example.test')[0]).toMatchObject({ type: 'bounced', bounceType: 'soft' });
    expect(fakeOutcome('complaint+1@example.test').map((o) => o.type)).toEqual(['delivered', 'complained']);
    expect(fakeOutcome('rae@example.test').map((o) => o.type)).toEqual(['delivered']);
  });
});
