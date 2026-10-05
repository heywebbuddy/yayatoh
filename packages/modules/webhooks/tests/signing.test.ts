import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERIFY_EXAMPLE_NODE } from '../src/examples.ts';
import { fakePublisher, memoryWebhookStore } from '../src/fake.ts';
import {
  newWebhookSecret,
  signWebhook,
  verifyWebhook,
  WebhookVerificationFailed,
  webhookHeaders,
} from '../src/signing.ts';

// The Standard Webhooks spec's published test vector (standard-webhooks/libraries, MIT).
const VECTOR = {
  secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
  id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
  timestamp: 1614265330,
  body: '{"test": 2432232314}',
  signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
};

/** The docs' Node example, loaded as the receiver would run it. */
async function docsVerifier(): Promise<
  (secret: string, headers: Record<string, string>, raw: string) => unknown
> {
  const dir = mkdtempSync(join(tmpdir(), 'yy-verify-'));
  const file = join(dir, 'verify.mjs');
  writeFileSync(file, VERIFY_EXAMPLE_NODE);
  return (await import(pathToFileURL(file).href)).verifyYayatohWebhook;
}

describe('Standard Webhooks signatures', () => {
  it('matches the spec test vector', () => {
    expect(signWebhook(VECTOR.secret, VECTOR.id, VECTOR.timestamp, VECTOR.body)).toBe(VECTOR.signature);
  });

  it('verifies, and refuses a changed body, a wrong secret, an old or future timestamp', () => {
    const secret = newWebhookSecret();
    const now = 1_900_000_000;
    const h = webhookHeaders([secret], 'msg_1', now, '{"a":1}');
    expect(() => verifyWebhook(secret, h, '{"a":1}', now)).not.toThrow();
    expect(() => verifyWebhook(secret, h, '{"a":2}', now)).toThrow(WebhookVerificationFailed);
    expect(() => verifyWebhook(newWebhookSecret(), h, '{"a":1}', now)).toThrow(WebhookVerificationFailed);
    expect(() => verifyWebhook(secret, h, '{"a":1}', now + 301)).toThrow(/tolerance/);
    expect(() => verifyWebhook(secret, h, '{"a":1}', now - 301)).toThrow(/tolerance/);
    expect(() => verifyWebhook(secret, { ...h, 'webhook-id': '' }, '{"a":1}', now)).toThrow(/missing/);
  });

  it('accepts either secret while two sign a delivery (rotation)', () => {
    const [a, b] = [newWebhookSecret(), newWebhookSecret()];
    const h = webhookHeaders([b, a], 'msg_2', 1_900_000_000, 'x');
    expect(h['webhook-signature'].split(' ')).toHaveLength(2);
    expect(() => verifyWebhook(a, h, 'x', 1_900_000_000)).not.toThrow();
    expect(() => verifyWebhook(b, h, 'x', 1_900_000_000)).not.toThrow();
  });
});

describe('the documented receiver example', () => {
  it('passes the spec test vector at its timestamp', async () => {
    const verify = await docsVerifier();
    const realNow = Date.now;
    Date.now = () => VECTOR.timestamp * 1000;
    try {
      expect(
        verify(
          VECTOR.secret,
          {
            'webhook-id': VECTOR.id,
            'webhook-timestamp': String(VECTOR.timestamp),
            'webhook-signature': VECTOR.signature,
          },
          VECTOR.body,
        ),
      ).toEqual({ test: 2432232314 });
    } finally {
      Date.now = realNow;
    }
  });

  it('verifies what the platform sends, and rejects tampering and replays', async () => {
    const verify = await docsVerifier();
    const fake = fakePublisher({
      seed: 's'.repeat(40),
      appOrigin: 'https://app.test',
      store: memoryWebhookStore(),
    });
    await fake.createEndpoint('org-1', '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a81', {
      url: 'https://hooks.example.com/in',
      description: '',
      eventTypes: [],
      disabled: false,
    });
    await fake.sendMessage('org-1', { eventType: 'order.paid', eventId: 'e1', payload: { hello: 'world' } });
    const [d] = fake.recorded('org-1');
    if (!d) throw new Error('no delivery');
    const secret = await fake.endpointSecret('org-1', d.endpointId);
    expect(verify(secret, { ...d.headers }, d.body)).toEqual({ hello: 'world' });
    expect(() => verify(secret, { ...d.headers }, d.body.replace('world', 'w0rld'))).toThrow(
      /Invalid signature/,
    );
    expect(() =>
      verify(
        secret,
        { ...d.headers, 'webhook-timestamp': String(Number(d.headers['webhook-timestamp']) - 600) },
        d.body,
      ),
    ).toThrow(/tolerance/);
    expect(() => verify(secret, { ...d.headers, 'webhook-signature': '' }, d.body)).toThrow(/Missing/);
  });
});
