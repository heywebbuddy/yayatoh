import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  type AttemptStatus,
  type DeliveryAttempt,
  type EndpointSpec,
  RETRY_SCHEDULE_SECONDS,
  type SendMessageInput,
  WebhookProviderError,
  type WebhookPublisher,
} from './port.ts';
import { SECRET_PREFIX, type SignedHeaders, webhookHeaders } from './signing.ts';

/**
 * Fake Svix for dev, preview and CI (M6.3b; no Svix account yet, owner inbox). It keeps endpoints,
 * messages and attempts in memory (one store per process, like the fake payment provider's
 * balance), signs every delivery exactly as Svix does (Standard Webhooks), and records the request
 * instead of sending it: no network, so no SSRF surface in CI. The endpoint's "answer" is decided
 * by its URL: a path segment `fail` answers 503 (to exercise retries and replay), anything else
 * 200. Secrets are derived from a seed, so they survive a restart of the process.
 */

export interface RecordedDelivery {
  readonly attemptId: string;
  readonly endpointId: string;
  readonly url: string;
  readonly headers: SignedHeaders & { readonly 'content-type': 'application/json' };
  readonly body: string;
  readonly status: number;
}

interface FakeEndpoint extends EndpointSpec {
  readonly id: string;
  readonly uid: string;
  generation: number;
  previous: { generation: number; until: Date } | null;
}

interface FakeMessage {
  readonly id: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly body: string;
  readonly createdAt: Date;
}

interface FakeAttempt extends DeliveryAttempt {
  readonly endpointId: string;
  /** Attempts so far for this (message, endpoint), this one included. */
  readonly attemptNumber: number;
}

interface App {
  readonly endpoints: Map<string, FakeEndpoint>;
  readonly messages: Map<string, FakeMessage>;
  readonly attempts: FakeAttempt[];
  readonly recorded: RecordedDelivery[];
}

export interface FakeWebhookStore {
  readonly apps: Map<string, App>;
}

export function memoryWebhookStore(): FakeWebhookStore {
  return { apps: new Map() };
}

/** One store per process (the console, the dev drain and the fake portal share it). */
export function processWebhookStore(): FakeWebhookStore {
  const g = globalThis as { __yayatohFakeWebhooks?: FakeWebhookStore };
  g.__yayatohFakeWebhooks ??= memoryWebhookStore();
  return g.__yayatohFakeWebhooks;
}

export interface FakePublisher extends WebhookPublisher {
  readonly name: 'fake';
  /** What was "sent" to this app's endpoints, newest last (tests and the fake portal). */
  recorded(appId: string): readonly RecordedDelivery[];
  /** Run automatic retries that are due (the worker would; tests call it with a clock). */
  runDueRetries(now?: Date): Promise<number>;
}

const PORTAL_TTL_MS = 10 * 60_000;

export function fakePublisher(opts: {
  /** ≥ 32 characters; derives secrets and signs portal links. */
  seed: string;
  appOrigin: string;
  store?: FakeWebhookStore;
  now?: () => Date;
}): FakePublisher {
  if (process.env.VERCEL_ENV === 'production')
    throw new Error('The fake webhook publisher is not allowed in production');
  if (opts.seed.length < 32) throw new Error('fake webhook seed must be ≥32 chars');
  const store = opts.store ?? processWebhookStore();
  const now = opts.now ?? (() => new Date());
  const app = (appId: string): App => {
    let a = store.apps.get(appId);
    if (!a) {
      a = { endpoints: new Map(), messages: new Map(), attempts: [], recorded: [] };
      store.apps.set(appId, a);
    }
    return a;
  };
  const endpoint = (appId: string, id: string): FakeEndpoint => {
    const ep = app(appId).endpoints.get(id);
    if (!ep) throw new WebhookProviderError('endpoint not found', 'not_found');
    return ep;
  };
  const secretOf = (appId: string, epId: string, generation: number) =>
    `${SECRET_PREFIX}${createHmac('sha256', opts.seed)
      .update(`${appId}|${epId}|${generation}`)
      .digest()
      .subarray(0, 24)
      .toString('base64')}`;
  const signingSecrets = (appId: string, ep: FakeEndpoint, at: Date) => [
    secretOf(appId, ep.id, ep.generation),
    ...(ep.previous && ep.previous.until > at ? [secretOf(appId, ep.id, ep.previous.generation)] : []),
  ];
  const answer = (url: string) => {
    try {
      return new URL(url).pathname.split('/').includes('fail') ? 503 : 200;
    } catch {
      return 0;
    }
  };
  const deliver = (
    appId: string,
    ep: FakeEndpoint,
    msg: FakeMessage,
    trigger: 'scheduled' | 'manual',
  ): FakeAttempt => {
    const a = app(appId);
    const at = now();
    const previous = a.attempts.filter((x) => x.messageId === msg.id && x.endpointId === ep.id);
    const attemptNumber = previous.length + 1;
    const status = answer(ep.url);
    const ok = status >= 200 && status < 300;
    const attemptId = `atmpt_${randomUUID().replaceAll('-', '')}`;
    // Automatic retries follow Svix's schedule; a manual resend does not add more.
    const scheduled =
      previous.filter((x) => x.trigger === 'scheduled').length + (trigger === 'scheduled' ? 1 : 0);
    const delay = RETRY_SCHEDULE_SECONDS[scheduled - 1];
    const nextAttemptAt =
      !ok && trigger === 'scheduled' && delay !== undefined ? new Date(at.getTime() + delay * 1000) : null;
    const attempt: FakeAttempt = {
      attemptId,
      messageId: msg.id,
      eventId: msg.eventId,
      eventType: msg.eventType,
      endpointId: ep.id,
      status: (ok ? 'succeeded' : 'failed') satisfies AttemptStatus,
      responseStatus: status,
      attemptedAt: at,
      trigger,
      nextAttemptAt,
      attemptNumber,
    };
    a.attempts.push(attempt);
    a.recorded.push({
      attemptId,
      endpointId: ep.id,
      url: ep.url,
      headers: {
        ...webhookHeaders(signingSecrets(appId, ep, at), msg.id, Math.floor(at.getTime() / 1000), msg.body),
        'content-type': 'application/json',
      },
      body: msg.body,
      status,
    });
    return attempt;
  };
  const message = (appId: string, input: SendMessageInput): FakeMessage => {
    const a = app(appId);
    const id = `msg_${createHash('sha256').update(`${appId}|${input.eventId}`).digest('hex').slice(0, 27)}`;
    const existing = a.messages.get(id);
    if (existing) return existing;
    const m: FakeMessage = {
      id,
      eventId: input.eventId,
      eventType: input.eventType,
      body: JSON.stringify(input.payload),
      createdAt: now(),
    };
    a.messages.set(id, m);
    return m;
  };
  const receives = (ep: FakeEndpoint, type: string) =>
    !ep.disabled && (ep.eventTypes.length === 0 || ep.eventTypes.includes(type));
  const sign = (s: string) => createHmac('sha256', opts.seed).update(`portal|${s}`).digest('base64url');

  return {
    name: 'fake',
    async ensureApplication(appId) {
      app(appId);
    },
    async syncEventTypes() {},
    async createEndpoint(appId, uid, spec) {
      const a = app(appId);
      const id = `ep_${uid.replaceAll('-', '')}`;
      if (!a.endpoints.has(id))
        a.endpoints.set(id, {
          ...spec,
          eventTypes: [...spec.eventTypes],
          id,
          uid,
          generation: 0,
          previous: null,
        });
      return { providerEndpointId: id };
    },
    async updateEndpoint(appId, id, spec) {
      const a = app(appId);
      const ep = a.endpoints.get(id);
      // After a restart the store is empty: an update brings the endpoint back.
      a.endpoints.set(id, {
        ...spec,
        eventTypes: [...spec.eventTypes],
        id,
        uid: ep?.uid ?? id,
        generation: ep?.generation ?? 0,
        previous: ep?.previous ?? null,
      });
    },
    async deleteEndpoint(appId, id) {
      app(appId).endpoints.delete(id);
    },
    async endpointSecret(appId, id) {
      return secretOf(appId, id, app(appId).endpoints.get(id)?.generation ?? 0);
    },
    async rotateSecret(appId, id) {
      const ep = endpoint(appId, id);
      ep.previous = { generation: ep.generation, until: new Date(now().getTime() + 24 * 3600_000) };
      ep.generation += 1;
    },
    async sendMessage(appId, input) {
      const fresh = !app(appId).messages.has(
        `msg_${createHash('sha256').update(`${appId}|${input.eventId}`).digest('hex').slice(0, 27)}`,
      );
      const m = message(appId, input);
      if (fresh)
        for (const ep of app(appId).endpoints.values())
          if (receives(ep, m.eventType)) deliver(appId, ep, m, 'scheduled');
      return { messageId: m.id };
    },
    async sendTest(appId, id, input) {
      const ep = endpoint(appId, id);
      const m = message(appId, input);
      deliver(appId, ep, m, 'manual');
      return { messageId: m.id };
    },
    async listAttempts(appId, id, limit) {
      endpoint(appId, id);
      return app(appId)
        .attempts.filter((x) => x.endpointId === id)
        .slice()
        .reverse()
        .slice(0, limit)
        .map(({ endpointId: _e, attemptNumber: _n, ...rest }) => rest);
    },
    async resendMessage(appId, id, messageId) {
      const ep = endpoint(appId, id);
      const m = app(appId).messages.get(messageId);
      if (!m || !app(appId).attempts.some((x) => x.messageId === messageId && x.endpointId === id))
        throw new WebhookProviderError('message not found', 'not_found');
      deliver(appId, ep, m, 'manual');
    },
    async recoverFailed(appId, id, since) {
      const ep = endpoint(appId, id);
      const a = app(appId);
      const latest = new Map<string, FakeAttempt>();
      for (const x of a.attempts) if (x.endpointId === id) latest.set(x.messageId, x);
      for (const x of latest.values()) {
        const m = a.messages.get(x.messageId);
        if (m && x.status === 'failed' && x.attemptedAt >= since) deliver(appId, ep, m, 'manual');
      }
    },
    async portalAccess(appId) {
      const body = Buffer.from(JSON.stringify({ a: appId, e: now().getTime() + PORTAL_TTL_MS })).toString(
        'base64url',
      );
      return { url: `${opts.appOrigin}/webhook-portal/${body}.${sign(body)}`, origin: opts.appOrigin };
    },
    recorded(appId) {
      return app(appId).recorded;
    },
    async runDueRetries(at = now()) {
      let n = 0;
      for (const [appId, a] of store.apps) {
        const latest = new Map<string, FakeAttempt>();
        for (const x of a.attempts) latest.set(`${x.messageId}|${x.endpointId}`, x);
        for (const x of latest.values()) {
          const ep = a.endpoints.get(x.endpointId);
          const m = a.messages.get(x.messageId);
          if (ep && m && x.nextAttemptAt && x.nextAttemptAt <= at && !ep.disabled) {
            deliver(appId, ep, m, 'scheduled');
            n += 1;
          }
        }
      }
      return n;
    },
  };
}

/** The app (org) a fake portal link opens, or null when forged or expired. */
export function verifyFakePortalToken(seed: string, token: string, now = new Date()): string | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', seed).update(`portal|${body}`).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { a: appId, e } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      a: string;
      e: number;
    };
    return typeof appId === 'string' && e > now.getTime() ? appId : null;
  } catch {
    return null;
  }
}

/** The fake portal's view of an app: its endpoints and recent attempts (the portal page). */
export function fakePortalView(store: FakeWebhookStore, appId: string) {
  const a = store.apps.get(appId);
  if (!a) return { endpoints: [], attempts: [] };
  return {
    endpoints: [...a.endpoints.values()].map((e) => ({
      id: e.id,
      url: e.url,
      description: e.description,
      eventTypes: [...e.eventTypes],
      disabled: e.disabled,
    })),
    attempts: a.attempts
      .slice(-50)
      .reverse()
      .map((x) => ({
        attemptId: x.attemptId,
        endpointId: x.endpointId,
        messageId: x.messageId,
        eventType: x.eventType,
        status: x.status,
        responseStatus: x.responseStatus,
        attemptedAt: x.attemptedAt,
      })),
  };
}
