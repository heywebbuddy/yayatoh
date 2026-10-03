import { describe, expect, it } from 'vitest';
import { USAGE_EVENTS, usageFromEvent } from '../src/meters.ts';
import { changeDirection, moduleDelta } from '../src/plan-change.ts';

const ev = (type: string, payload: unknown, version = 1) => ({ type, version, payload });

describe('usage from outbox events (M6.6b)', () => {
  it('messages count per paid channel (SMS by segment); push is free', () => {
    expect(usageFromEvent(ev('messaging.usage_metered', { channel: 'email', units: 1 }))).toEqual([
      { meter: 'email', quantity: 1 },
    ]);
    expect(usageFromEvent(ev('messaging.usage_metered', { channel: 'sms', units: 3 }))).toEqual([
      { meter: 'sms', quantity: 3 },
    ]);
    expect(usageFromEvent(ev('messaging.usage_metered', { channel: 'whatsapp', units: 1 }))).toEqual([
      { meter: 'whatsapp', quantity: 1 },
    ]);
    expect(usageFromEvent(ev('messaging.usage_metered', { channel: 'push', units: 1 }))).toEqual([]);
  });

  it('AI credits count when spent and come back negative when refunded; devices count once', () => {
    expect(usageFromEvent(ev('ai.credits_spent', { credits: 1 }))).toEqual([
      { meter: 'ai_credits', quantity: 1 },
    ]);
    expect(usageFromEvent(ev('ai.credits_refunded', { credits: 1 }))).toEqual([
      { meter: 'ai_credits', quantity: -1 },
    ]);
    expect(usageFromEvent(ev('device.enrolled', { deviceId: 'x' }))).toEqual([
      { meter: 'devices', quantity: 1 },
    ]);
  });

  it('anything else, another version or a malformed payload counts nothing', () => {
    expect(usageFromEvent(ev('device.heartbeat', {}))).toEqual([]);
    expect(usageFromEvent(ev('device.enrolled', {}, 2))).toEqual([]);
    expect(usageFromEvent(ev('messaging.usage_metered', { channel: 'sms', units: 0 }))).toEqual([]);
    expect(usageFromEvent(ev('ai.credits_spent', { credits: 'many' }))).toEqual([]);
  });

  it('the meter subscribes to exactly the usage events', () => {
    expect([...USAGE_EVENTS].sort()).toEqual(
      [
        'ai.credits_refunded@1',
        'ai.credits_spent@1',
        'device.enrolled@1',
        'messaging.usage_metered@1',
      ].sort(),
    );
  });
});

describe('plan change direction and module delta (M6.6b)', () => {
  it('compares monthly cost; no subscription is a start', () => {
    expect(changeDirection(null, { unitAmountMinor: 0, interval: 'month' })).toBe('start');
    expect(
      changeDirection(
        { unitAmountMinor: 2900, interval: 'month' },
        { unitAmountMinor: 9900, interval: 'month' },
      ),
    ).toBe('upgrade');
    expect(
      changeDirection(
        { unitAmountMinor: 9900, interval: 'month' },
        { unitAmountMinor: 0, interval: 'month' },
      ),
    ).toBe('downgrade');
    expect(
      changeDirection(
        { unitAmountMinor: 1200, interval: 'month' },
        { unitAmountMinor: 14400, interval: 'year' },
      ),
    ).toBe('switch');
  });

  it('lists what turns off and on; core never turns off', () => {
    expect(moduleDelta(['core', 'sessions', 'marketing'], ['marketing', 'ai'])).toEqual({
      removed: ['sessions'],
      added: ['ai'],
    });
    expect(moduleDelta(['core'], []).removed).toEqual([]);
  });
});
