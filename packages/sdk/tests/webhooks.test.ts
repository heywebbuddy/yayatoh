import { createHmac } from 'node:crypto';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { verifyWebhook, type WebhookMessage, WebhookVerificationError } from '../src/index.ts';

// The Standard Webhooks spec's published test vector.
const VECTOR = {
  secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
  headers: {
    'webhook-id': 'msg_p5jXN8AQM9LWM0D4loKWxJek',
    'webhook-timestamp': '1614265330',
    'webhook-signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
  },
  body: '{"test": 2432232314}',
  at: new Date(1614265330 * 1000),
};

const sign = (secret: string, id: string, ts: number, body: string) =>
  `v1,${createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64'))
    .update(`${id}.${ts}.${body}`)
    .digest('base64')}`;

describe('verifyWebhook (SDK, Web Crypto)', () => {
  it('accepts the spec test vector, with plain objects or Headers', async () => {
    expect(await verifyWebhook(VECTOR.secret, VECTOR.headers, VECTOR.body, { now: VECTOR.at })).toEqual({
      test: 2432232314,
    });
    expect(
      await verifyWebhook(VECTOR.secret, new Headers(VECTOR.headers), VECTOR.body, { now: VECTOR.at }),
    ).toEqual({
      test: 2432232314,
    });
  });

  it('refuses tampering, a wrong secret, stale timestamps and missing headers', async () => {
    const at = { now: VECTOR.at };
    await expect(verifyWebhook(VECTOR.secret, VECTOR.headers, '{"test": 1}', at)).rejects.toBeInstanceOf(
      WebhookVerificationError,
    );
    await expect(
      verifyWebhook('whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', VECTOR.headers, VECTOR.body, at),
    ).rejects.toThrow(/Invalid signature/);
    await expect(
      verifyWebhook(VECTOR.secret, VECTOR.headers, VECTOR.body, {
        now: new Date(VECTOR.at.getTime() + 301_000),
      }),
    ).rejects.toThrow(/tolerance/);
    await expect(
      verifyWebhook(VECTOR.secret, { ...VECTOR.headers, 'webhook-signature': undefined }, VECTOR.body, at),
    ).rejects.toThrow(/Missing/);
  });

  it('accepts either of two signatures (secret rotation) and types the message', async () => {
    const secret = 'whsec_C2FVsBQIhrscChlQIMV+b5sSYspob7oD';
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a80',
      type: 'order.paid',
      version: 1,
      apiVersion: 'v1',
      occurredAt: new Date().toISOString(),
      orgId: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a7f',
      data: { orderId: 'o', eventId: 'e', totalMinor: 5000, currency: 'USD', via: 'stripe' },
    });
    const headers = {
      'webhook-id': 'msg_1',
      'webhook-timestamp': String(ts),
      'webhook-signature': `${sign('whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', 'msg_1', ts, body)} ${sign(secret, 'msg_1', ts, body)}`,
    };
    const m = await verifyWebhook<'order.paid'>(secret, headers, body);
    expect(m.data.totalMinor).toBe(5000);
    expectTypeOf(m.data.via).toEqualTypeOf<'free' | 'box_office' | 'fake' | 'stripe' | 'invoice'>();
    expectTypeOf<WebhookMessage<'event.cancelled'>['data']['to']>().toEqualTypeOf<
      'draft' | 'published' | 'postponed' | 'cancelled' | 'completed' | 'archived'
    >();
  });
});
