import {
  type AttemptStatus,
  type DeliveryAttempt,
  type EndpointSpec,
  WebhookProviderError,
  type WebhookPublisher,
} from './port.ts';

/**
 * Svix adapter (M6.3b) over its REST API (no SDK dependency). Switched on by `SVIX_API_KEY` once
 * the owner has the account (owner inbox); CI never calls it (`svix.test.ts` stubs `fetch`).
 * Application uid = org id, endpoint uid = our endpoint row id, message eventId = the outbox event
 * id (Svix dedupes on it), so every create is safe to retry.
 */
export function svixPublisher(opts: {
  apiKey: string;
  /** Defaults to the region in the key (`…​.us`, `…​.eu`) or the US API. */
  serverUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): WebhookPublisher {
  const doFetch = opts.fetch ?? fetch;
  const region = /\.(us|eu|in|ca|au)$/.exec(opts.apiKey)?.[1] ?? 'us';
  const base = (opts.serverUrl ?? `https://api.${region}.svix.com`).replace(/\/$/, '');
  const call = async <T>(
    method: string,
    path: string,
    body?: unknown,
    extra: { idempotencyKey?: string; allow?: number[] } = {},
  ): Promise<{ status: number; data: T }> => {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(extra.idempotencyKey ? { 'idempotency-key': extra.idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
    } catch {
      throw new WebhookProviderError('Svix is unreachable', 'unavailable');
    }
    if (!res.ok && !(extra.allow ?? []).includes(res.status)) {
      if (res.status === 404) throw new WebhookProviderError('Svix: not found', 'not_found');
      if (res.status >= 400 && res.status < 500 && res.status !== 429)
        throw new WebhookProviderError(`Svix refused the request (${res.status})`, 'invalid');
      throw new WebhookProviderError(`Svix error (${res.status})`, 'unavailable');
    }
    const text = await res.text();
    return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
  };
  const app = (appId: string) => `/api/v1/app/${encodeURIComponent(appId)}`;
  const ep = (appId: string, id: string) => `${app(appId)}/endpoint/${encodeURIComponent(id)}`;
  const endpointBody = (s: EndpointSpec) => ({
    url: s.url,
    description: s.description,
    disabled: s.disabled,
    // Svix: no filter means every event type.
    filterTypes: s.eventTypes.length > 0 ? [...s.eventTypes] : null,
  });
  const STATUS: Record<number, AttemptStatus> = { 0: 'succeeded', 1: 'pending', 2: 'failed', 3: 'pending' };

  return {
    name: 'svix',
    async ensureApplication(appId, name) {
      await call('POST', '/api/v1/app/?get_if_exists=true', { uid: appId, name });
    },
    async syncEventTypes(types) {
      for (const t of types) {
        const body = {
          name: t.name,
          description: t.description,
          schemas: { [String(t.schemaVersion)]: { ...t.schema, examples: [t.example] } },
        };
        const r = await call('POST', '/api/v1/event-type/', body, { allow: [409] });
        if (r.status === 409) await call('PUT', `/api/v1/event-type/${encodeURIComponent(t.name)}/`, body);
      }
    },
    async createEndpoint(appId, uid, spec) {
      const r = await call<{ id: string }>(
        'POST',
        `${app(appId)}/endpoint/`,
        { ...endpointBody(spec), uid },
        {
          allow: [409],
          idempotencyKey: `endpoint-${uid}`,
        },
      );
      if (r.status === 409) {
        const found = await call<{ id: string }>('GET', `${ep(appId, uid)}/`);
        return { providerEndpointId: found.data.id };
      }
      return { providerEndpointId: r.data.id };
    },
    async updateEndpoint(appId, id, spec) {
      await call('PUT', `${ep(appId, id)}/`, endpointBody(spec));
    },
    async deleteEndpoint(appId, id) {
      await call('DELETE', `${ep(appId, id)}/`, undefined, { allow: [404] });
    },
    async endpointSecret(appId, id) {
      return (await call<{ key: string }>('GET', `${ep(appId, id)}/secret/`)).data.key;
    },
    async rotateSecret(appId, id) {
      await call('POST', `${ep(appId, id)}/secret/rotate/`, {});
    },
    async sendMessage(appId, input) {
      const r = await call<{ id: string }>(
        'POST',
        `${app(appId)}/msg/`,
        { eventType: input.eventType, eventId: input.eventId, payload: input.payload },
        { idempotencyKey: input.eventId, allow: [409] },
      );
      // 409: this eventId was already sent (a relay retry); Svix kept the first message.
      return { messageId: r.data?.id ?? input.eventId };
    },
    async sendTest(appId, id, input) {
      const r = await call<{ id: string }>('POST', `${ep(appId, id)}/send-example/`, {
        eventType: input.eventType,
      });
      return { messageId: r.data.id };
    },
    async listAttempts(appId, id, limit) {
      const r = await call<{
        data: {
          id: string;
          msgId: string;
          responseStatusCode: number;
          status: number;
          timestamp: string;
          triggerType: number;
          msg?: { eventType: string; eventId?: string | null };
          nextAttempt?: string | null;
        }[];
      }>('GET', `${app(appId)}/attempt/endpoint/${encodeURIComponent(id)}/?limit=${limit}&with_msg=true`);
      return r.data.data.map(
        (a): DeliveryAttempt => ({
          attemptId: a.id,
          messageId: a.msgId,
          eventId: a.msg?.eventId ?? null,
          eventType: a.msg?.eventType ?? 'unknown',
          status: STATUS[a.status] ?? 'pending',
          responseStatus: a.responseStatusCode,
          attemptedAt: new Date(a.timestamp),
          trigger: a.triggerType === 1 ? 'manual' : 'scheduled',
          nextAttemptAt: a.nextAttempt ? new Date(a.nextAttempt) : null,
        }),
      );
    },
    async resendMessage(appId, id, messageId) {
      await call(
        'POST',
        `${app(appId)}/msg/${encodeURIComponent(messageId)}/endpoint/${encodeURIComponent(id)}/resend/`,
      );
    },
    async recoverFailed(appId, id, since) {
      await call('POST', `${ep(appId, id)}/recover/`, { since: since.toISOString() });
    },
    async portalAccess(appId) {
      const r = await call<{ url: string }>(
        'POST',
        `/api/v1/auth/app-portal-access/${encodeURIComponent(appId)}/`,
        {},
      );
      return { url: r.data.url, origin: new URL(r.data.url).origin };
    },
  };
}
