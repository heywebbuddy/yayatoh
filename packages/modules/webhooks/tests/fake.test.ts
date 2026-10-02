import { describe, expect, it } from 'vitest';
import { fakePortalView, fakePublisher, memoryWebhookStore, verifyFakePortalToken } from '../src/fake.ts';
import { WebhookProviderError } from '../src/port.ts';
import { verifyWebhook } from '../src/signing.ts';

const SEED = 'f'.repeat(40);
const setup = () => {
  let now = new Date('2030-01-01T00:00:00Z');
  const store = memoryWebhookStore();
  const fake = fakePublisher({ seed: SEED, appOrigin: 'https://app.test', store, now: () => now });
  return { fake, store, tick: (ms: number) => (now = new Date(now.getTime() + ms)), at: () => now };
};
const ep = (url: string, eventTypes: string[] = []) => ({
  url,
  description: 'd',
  eventTypes,
  disabled: false,
});

describe('fake publisher', () => {
  it('fans a message out to the endpoints that subscribe to it, once per event id', async () => {
    const { fake } = setup();
    const a = await fake.createEndpoint('org-a', 'u1', ep('https://a.example.com/x'));
    const b = await fake.createEndpoint('org-a', 'u2', ep('https://b.example.com/x', ['order.refunded']));
    await fake.sendMessage('org-a', { eventType: 'order.paid', eventId: 'e1', payload: { n: 1 } });
    await fake.sendMessage('org-a', { eventType: 'order.paid', eventId: 'e1', payload: { n: 1 } });
    expect(await fake.listAttempts('org-a', a.providerEndpointId, 10)).toHaveLength(1);
    expect(await fake.listAttempts('org-a', b.providerEndpointId, 10)).toHaveLength(0);
  });

  it('keeps apps apart: another org cannot read, resend to or see an endpoint', async () => {
    const { fake, store } = setup();
    const a = await fake.createEndpoint('org-a', 'u1', ep('https://a.example.com/x'));
    await fake.sendMessage('org-a', { eventType: 'order.paid', eventId: 'e1', payload: {} });
    await expect(fake.listAttempts('org-b', a.providerEndpointId, 10)).rejects.toBeInstanceOf(
      WebhookProviderError,
    );
    await expect(fake.rotateSecret('org-b', a.providerEndpointId)).rejects.toBeInstanceOf(
      WebhookProviderError,
    );
    await fake.sendMessage('org-b', { eventType: 'order.paid', eventId: 'e2', payload: {} });
    expect(fake.recorded('org-a')).toHaveLength(1);
    expect(fake.recorded('org-b')).toHaveLength(0);
    expect(await fake.endpointSecret('org-b', a.providerEndpointId)).not.toBe(
      await fake.endpointSecret('org-a', a.providerEndpointId),
    );
    expect(fakePortalView(store, 'org-b').endpoints).toEqual([]);
  });

  it('a failing endpoint gets retries on Svix’s schedule; resend and recover replay it', async () => {
    const { fake, tick, at } = setup();
    const e = await fake.createEndpoint('org-a', 'u1', ep('https://a.example.com/fail/x'));
    await fake.sendMessage('org-a', { eventType: 'order.paid', eventId: 'e1', payload: {} });
    let [first] = await fake.listAttempts('org-a', e.providerEndpointId, 10);
    expect(first).toMatchObject({ status: 'failed', responseStatus: 503, trigger: 'scheduled' });
    expect(first?.nextAttemptAt?.getTime()).toBe(at().getTime() + 5_000);
    tick(5_000);
    expect(await fake.runDueRetries(at())).toBe(1);
    [first] = await fake.listAttempts('org-a', e.providerEndpointId, 10);
    expect(first?.nextAttemptAt?.getTime()).toBe(at().getTime() + 300_000);
    // Fixed: point it at a working URL and replay.
    await fake.updateEndpoint('org-a', e.providerEndpointId, ep('https://a.example.com/ok'));
    await fake.resendMessage('org-a', e.providerEndpointId, first?.messageId as string);
    const [resent] = await fake.listAttempts('org-a', e.providerEndpointId, 10);
    expect(resent).toMatchObject({
      status: 'succeeded',
      responseStatus: 200,
      trigger: 'manual',
      nextAttemptAt: null,
    });
    await expect(fake.resendMessage('org-a', e.providerEndpointId, 'msg_nope')).rejects.toBeInstanceOf(
      WebhookProviderError,
    );
  });

  it('recovers the failed messages since a time, not the succeeded or older ones', async () => {
    const { fake, tick, at } = setup();
    const e = await fake.createEndpoint('org-a', 'u1', ep('https://a.example.com/fail'));
    await fake.sendMessage('org-a', { eventType: 'order.paid', eventId: 'old', payload: {} });
    tick(3_600_000);
    const since = at();
    await fake.sendMessage('org-a', { eventType: 'order.paid', eventId: 'new', payload: {} });
    await fake.updateEndpoint('org-a', e.providerEndpointId, ep('https://a.example.com/ok'));
    await fake.recoverFailed('org-a', e.providerEndpointId, since);
    const attempts = await fake.listAttempts('org-a', e.providerEndpointId, 10);
    expect(attempts.filter((a) => a.trigger === 'manual')).toHaveLength(1);
  });

  it('rotation: the new secret signs, the old one still verifies for 24 hours', async () => {
    const { fake, tick } = setup();
    const e = await fake.createEndpoint('org-a', 'u1', ep('https://a.example.com/x'));
    const old = await fake.endpointSecret('org-a', e.providerEndpointId);
    await fake.rotateSecret('org-a', e.providerEndpointId);
    const fresh = await fake.endpointSecret('org-a', e.providerEndpointId);
    expect(fresh).not.toBe(old);
    expect(fresh).toMatch(/^whsec_/);
    await fake.sendTest('org-a', e.providerEndpointId, {
      eventType: 'webhook.test',
      eventId: 't1',
      payload: {},
    });
    let d = fake.recorded('org-a').at(-1);
    const ts = Number(d?.headers['webhook-timestamp']);
    expect(() => verifyWebhook(fresh, { ...d?.headers }, d?.body as string, ts)).not.toThrow();
    expect(() => verifyWebhook(old, { ...d?.headers }, d?.body as string, ts)).not.toThrow();
    tick(25 * 3_600_000);
    await fake.sendTest('org-a', e.providerEndpointId, {
      eventType: 'webhook.test',
      eventId: 't2',
      payload: {},
    });
    d = fake.recorded('org-a').at(-1);
    const ts2 = Number(d?.headers['webhook-timestamp']);
    expect(() => verifyWebhook(old, { ...d?.headers }, d?.body as string, ts2)).toThrow();
  });

  it('a test send reaches only the endpoint tested, even when disabled filters would skip it', async () => {
    const { fake } = setup();
    const a = await fake.createEndpoint('org-a', 'u1', ep('https://a.example.com/x', ['order.paid']));
    await fake.createEndpoint('org-a', 'u2', ep('https://b.example.com/x'));
    await fake.sendTest('org-a', a.providerEndpointId, {
      eventType: 'webhook.test',
      eventId: 't',
      payload: { test: true },
    });
    expect(fake.recorded('org-a').map((r) => r.url)).toEqual(['https://a.example.com/x']);
  });

  it('portal links are signed, scoped to one app and expire', async () => {
    const { fake } = setup();
    const { url, origin } = await fake.portalAccess('org-a');
    expect(origin).toBe('https://app.test');
    const token = url.split('/webhook-portal/')[1] as string;
    expect(verifyFakePortalToken(SEED, token, new Date('2030-01-01T00:05:00Z'))).toBe('org-a');
    expect(verifyFakePortalToken(SEED, token, new Date('2030-01-01T00:11:00Z'))).toBeNull();
    expect(verifyFakePortalToken('x'.repeat(40), token, new Date('2030-01-01T00:05:00Z'))).toBeNull();
    const [body, mac] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ a: 'org-b', e: 9e15 })).toString('base64url');
    expect(verifyFakePortalToken(SEED, `${forged}.${mac}`)).toBeNull();
    expect(body).toBeTruthy();
  });

  it('is refused in production', () => {
    const prev = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = 'production';
    try {
      expect(() => fakePublisher({ seed: SEED, appOrigin: 'https://x' })).toThrow(/production/);
    } finally {
      if (prev === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = prev;
    }
  });
});
