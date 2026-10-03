import { describe, expect, it } from 'vitest';
import { WebhookProviderError } from '../src/port.ts';
import { svixPublisher } from '../src/svix.ts';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function stub(
  responses: ((c: Call) => { status: number; body?: unknown }) | { status: number; body?: unknown }[],
) {
  const calls: Call[] = [];
  let i = 0;
  const fetch = (async (url: string, init: RequestInit) => {
    const c: Call = {
      method: String(init.method),
      url,
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(c);
    const r = Array.isArray(responses) ? (responses[i++] ?? { status: 200, body: {} }) : responses(c);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe('Svix adapter', () => {
  it('uses the key’s region, bearer auth, and the org as the application uid', async () => {
    const s = stub([{ status: 201, body: { id: 'app_1' } }]);
    const p = svixPublisher({ apiKey: 'sk_abc.eu', fetch: s.fetch });
    await p.ensureApplication('org-1', 'org-1');
    expect(s.calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.eu.svix.com/api/v1/app/?get_if_exists=true',
      body: { uid: 'org-1', name: 'org-1' },
    });
    expect(s.calls[0]?.headers.authorization).toBe('Bearer sk_abc.eu');
  });

  it('creates an endpoint with our row id as uid; a retry (409) finds the same one', async () => {
    const s = stub([{ status: 409 }, { status: 200, body: { id: 'ep_x' } }]);
    const p = svixPublisher({ apiKey: 'sk_abc', fetch: s.fetch });
    const r = await p.createEndpoint('org-1', 'row-1', {
      url: 'https://h.example.com',
      description: 'd',
      eventTypes: [],
      disabled: false,
    });
    expect(r.providerEndpointId).toBe('ep_x');
    expect(s.calls[0]?.body).toMatchObject({ uid: 'row-1', filterTypes: null, disabled: false });
    expect(s.calls[0]?.headers['idempotency-key']).toBe('endpoint-row-1');
    expect(s.calls[1]).toMatchObject({
      method: 'GET',
      url: 'https://api.us.svix.com/api/v1/app/org-1/endpoint/row-1/',
    });
  });

  it('sends messages with the outbox event id as eventId and idempotency key', async () => {
    const s = stub([{ status: 202, body: { id: 'msg_1' } }]);
    const p = svixPublisher({ apiKey: 'sk', fetch: s.fetch });
    const r = await p.sendMessage('org-1', { eventType: 'order.paid', eventId: 'evt-9', payload: { a: 1 } });
    expect(r.messageId).toBe('msg_1');
    expect(s.calls[0]?.body).toEqual({ eventType: 'order.paid', eventId: 'evt-9', payload: { a: 1 } });
    expect(s.calls[0]?.headers['idempotency-key']).toBe('evt-9');
  });

  it('maps attempts (status codes, triggers, next retry)', async () => {
    const s = stub([
      {
        status: 200,
        body: {
          data: [
            {
              id: 'atmpt_1',
              msgId: 'msg_1',
              responseStatusCode: 503,
              status: 2,
              timestamp: '2030-01-01T00:00:00Z',
              triggerType: 0,
              msg: { eventType: 'order.paid', eventId: 'e' },
              nextAttempt: '2030-01-01T00:00:05Z',
            },
            {
              id: 'atmpt_2',
              msgId: 'msg_2',
              responseStatusCode: 200,
              status: 0,
              timestamp: '2030-01-01T00:00:00Z',
              triggerType: 1,
            },
          ],
        },
      },
    ]);
    const p = svixPublisher({ apiKey: 'sk', fetch: s.fetch });
    const [a, b] = await p.listAttempts('org-1', 'ep_1', 20);
    expect(a).toMatchObject({
      status: 'failed',
      responseStatus: 503,
      trigger: 'scheduled',
      eventType: 'order.paid',
    });
    expect(a?.nextAttemptAt?.toISOString()).toBe('2030-01-01T00:00:05.000Z');
    expect(b).toMatchObject({
      status: 'succeeded',
      trigger: 'manual',
      eventType: 'unknown',
      nextAttemptAt: null,
    });
    expect(s.calls[0]?.url).toContain('/attempt/endpoint/ep_1/?limit=20&with_msg=true');
  });

  it('resend, recover, rotate, portal and event types hit the documented routes', async () => {
    const s = stub((c) =>
      c.url.includes('app-portal-access')
        ? { status: 200, body: { url: 'https://app.svix.com/login#key=abc' } }
        : c.url.endsWith('/event-type/')
          ? { status: 409 }
          : { status: 204 },
    );
    const p = svixPublisher({ apiKey: 'sk', fetch: s.fetch });
    await p.resendMessage('o', 'ep', 'msg_1');
    await p.recoverFailed('o', 'ep', new Date('2030-01-01T00:00:00Z'));
    await p.rotateSecret('o', 'ep');
    const portal = await p.portalAccess('o');
    await p.syncEventTypes([
      {
        name: 'order.paid',
        description: 'd',
        schemaVersion: 1,
        schema: { type: 'object' },
        example: { a: 1 },
      },
    ]);
    expect(s.calls.map((c) => `${c.method} ${c.url.replace('https://api.us.svix.com', '')}`)).toEqual([
      'POST /api/v1/app/o/msg/msg_1/endpoint/ep/resend/',
      'POST /api/v1/app/o/endpoint/ep/recover/',
      'POST /api/v1/app/o/endpoint/ep/secret/rotate/',
      'POST /api/v1/auth/app-portal-access/o/',
      'POST /api/v1/event-type/',
      'PUT /api/v1/event-type/order.paid/',
    ]);
    expect(s.calls[1]?.body).toEqual({ since: '2030-01-01T00:00:00.000Z' });
    expect(portal.origin).toBe('https://app.svix.com');
    expect(s.calls[4]?.body).toMatchObject({ schemas: { '1': { type: 'object', examples: [{ a: 1 }] } } });
  });

  it('turns failures into provider errors without leaking Svix’s message', async () => {
    const p = (status: number) =>
      svixPublisher({ apiKey: 'sk', fetch: stub([{ status, body: { detail: 'x' } }]).fetch });
    await expect(p(404).endpointSecret('o', 'ep')).rejects.toMatchObject({ kind: 'not_found' });
    await expect(p(422).endpointSecret('o', 'ep')).rejects.toMatchObject({ kind: 'invalid' });
    await expect(p(500).endpointSecret('o', 'ep')).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(p(429).endpointSecret('o', 'ep')).rejects.toMatchObject({ kind: 'unavailable' });
    const down = svixPublisher({
      apiKey: 'sk',
      fetch: (async () => {
        throw new Error('ECONNRESET');
      }) as unknown as typeof fetch,
    });
    await expect(down.endpointSecret('o', 'ep')).rejects.toBeInstanceOf(WebhookProviderError);
  });
});
