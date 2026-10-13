import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  APNS_PRODUCTION_ORIGIN,
  APNS_SANDBOX_ORIGIN,
  type ApnsHttp2,
  type ApnsRequest,
  apnsConfigFromEnv,
  apnsProviderToken,
  apnsTransport,
  classifyApnsResponse,
  classifyFcmResponse,
  fcmConfigFromEnv,
  fcmMessage,
  fcmTransport,
  liveTransports,
  missingEnv,
  nativePushTransport,
  type OutboundPush,
  type PushTransport,
  providerMode,
  pushProviders,
} from '../src/index.ts';

const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const p8 = ec.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rsaPem = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const HEX = 'ab'.repeat(32);
const base: OutboundPush = {
  platform: 'apns',
  token: HEX,
  title: 'Lakeside Jazz Night',
  body: 'Starts tomorrow at 7:00 PM.',
  url: null,
  path: '/tickets/6f1c0d4e-0000-4000-8000-000000000001',
  appId: 'com.yayatoh.app',
  environment: 'production',
  topic: 'ticket:6f1c0d4e-0000-4000-8000-000000000001',
  lang: 'en',
  dir: 'ltr',
  ttlSeconds: 3600,
  urgency: 'high',
  idempotencyKey: 'msg-1:dev-1',
};

const apnsEnv = {
  APNS_KEY_ID: 'ABC123DEFG',
  APNS_TEAM_ID: 'TEAM123456',
  APNS_PRIVATE_KEY: p8,
  APNS_BUNDLE_ID: 'com.yayatoh.app,com.yayatoh.staff',
  PUSH_PROVIDER: 'apns,fcm',
};
const account = JSON.stringify({
  project_id: 'yayatoh-test',
  client_email: 'push@yayatoh-test.iam.gserviceaccount.com',
  private_key: rsaPem,
  token_uri: 'https://oauth2.googleapis.com/token',
});

/** A recorded APNs: answers from a script, remembers every request. */
function recordedApns(
  ...answers: Array<{ status: number; reason?: string; headers?: Record<string, string> }>
) {
  const seen: ApnsRequest[] = [];
  const http2: ApnsHttp2 = async (req) => {
    seen.push(req);
    const a = answers[Math.min(seen.length - 1, answers.length - 1)] ?? { status: 200 };
    return {
      status: a.status,
      headers: a.headers ?? (a.status === 200 ? { 'apns-id': 'AAAA-1' } : {}),
      body: a.reason ? JSON.stringify({ reason: a.reason }) : '',
    };
  };
  return { http2, seen };
}

describe('APNs adapter (recorded responses)', () => {
  const config = apnsConfigFromEnv(apnsEnv);
  if (!config) throw new Error('config');

  it('signs an ES256 provider token that Apple could verify', () => {
    const jwt = apnsProviderToken(config, new Date('2026-10-13T10:00:00Z'));
    const [h, c, s] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'ABC123DEFG' });
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({
      iss: 'TEAM123456',
      iat: Math.floor(Date.parse('2026-10-13T10:00:00Z') / 1000),
    });
    const ok = createVerify('SHA256')
      .update(`${h}.${c}`)
      .verify({ key: createPublicKey(p8), dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
    expect(ok).toBe(true);
  });

  it('sends to the bundle id topic, with the collapse id, and only the allowlisted body', async () => {
    const { http2, seen } = recordedApns({ status: 200 });
    const t = apnsTransport({ config, http2, now: () => new Date('2026-10-13T10:00:00Z') });
    const r = await t.send(base);
    expect(r).toEqual({ providerMessageId: 'AAAA-1' });
    const req = seen[0] as ApnsRequest;
    expect(req.origin).toBe(APNS_PRODUCTION_ORIGIN);
    expect(req.path).toBe(`/3/device/${HEX}`);
    expect(req.headers['apns-topic']).toBe('com.yayatoh.app');
    expect(req.headers['apns-push-type']).toBe('alert');
    expect(req.headers['apns-collapse-id']).toBe(base.topic);
    expect(req.headers['apns-priority']).toBe('10');
    expect(req.headers['apns-expiration']).toBe(
      String(Math.floor(Date.parse('2026-10-13T10:00:00Z') / 1000) + 3600),
    );
    expect(req.headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(JSON.parse(req.body)).toEqual({
      aps: { alert: { title: base.title, body: base.body }, sound: 'default', 'thread-id': base.topic },
      path: base.path,
      lang: 'en',
    });
  });

  it('uses the sandbox host for a sandbox token and the device’s own listed app id as the topic', async () => {
    const { http2, seen } = recordedApns({ status: 200 });
    const t = apnsTransport({ config, http2 });
    await t.send({ ...base, environment: 'sandbox', appId: 'com.yayatoh.staff' });
    expect(seen[0]?.origin).toBe(APNS_SANDBOX_ORIGIN);
    expect(seen[0]?.headers['apns-topic']).toBe('com.yayatoh.staff');
    // An app id that is not ours falls back to the default topic rather than naming a stranger's.
    await t.send({ ...base, appId: 'com.evil.app' });
    expect(seen[1]?.headers['apns-topic']).toBe('com.yayatoh.app');
  });

  it('keeps one provider token for 50 minutes, then signs another', async () => {
    const { http2, seen } = recordedApns({ status: 200 });
    let now = new Date('2026-10-13T10:00:00Z');
    const t = apnsTransport({ config, http2, now: () => now });
    await t.send(base);
    now = new Date(now.getTime() + 30 * 60_000);
    await t.send(base);
    now = new Date(now.getTime() + 25 * 60_000);
    await t.send(base);
    const auth = seen.map((r) => r.headers.authorization);
    expect(auth[1]).toBe(auth[0]);
    expect(auth[2]).not.toBe(auth[0]);
  });

  it('reports an unregistered or foreign token as invalid (to be disabled)', async () => {
    for (const a of [
      { status: 410, reason: 'Unregistered' },
      { status: 400, reason: 'BadDeviceToken' },
      { status: 400, reason: 'DeviceTokenNotForTopic' },
    ]) {
      const t = apnsTransport({ config, http2: recordedApns(a).http2 });
      expect(await t.send(base)).toMatchObject({ error: 'invalid_token', status: a.status });
    }
    // A token that cannot be one never leaves the process.
    const { http2, seen } = recordedApns({ status: 200 });
    expect(await apnsTransport({ config, http2 }).send({ ...base, token: 'not hex' })).toEqual({
      error: 'invalid_token',
    });
    expect(seen).toHaveLength(0);
  });

  it('retries 429 and 5xx (with Retry-After), and a dropped connection', async () => {
    const t429 = apnsTransport({
      config,
      http2: recordedApns({ status: 429, reason: 'TooManyRequests', headers: { 'retry-after': '120' } })
        .http2,
    });
    expect(await t429.send(base)).toEqual({ error: 'retry', status: 429, retryAfterMs: 120_000 });
    const t503 = apnsTransport({
      config,
      http2: recordedApns({ status: 503, reason: 'ServiceUnavailable' }).http2,
    });
    expect(await t503.send(base)).toEqual({ error: 'retry', status: 503, retryAfterMs: null });
    const down = apnsTransport({
      config,
      http2: async () => {
        throw new Error('ECONNRESET');
      },
    });
    expect(await down.send(base)).toEqual({ error: 'retry', retryAfterMs: null });
  });

  it('signs a fresh provider token once when Apple says it expired', async () => {
    const { http2, seen } = recordedApns({ status: 403, reason: 'ExpiredProviderToken' }, { status: 200 });
    const r = await apnsTransport({ config, http2 }).send(base);
    expect(r).toEqual({ providerMessageId: 'AAAA-1' });
    expect(seen).toHaveLength(2);
    const stuck = recordedApns({ status: 403, reason: 'ExpiredProviderToken' });
    expect(await apnsTransport({ config, http2: stuck.http2 }).send(base)).toMatchObject({ error: 'retry' });
    expect(stuck.seen).toHaveLength(2);
  });

  it('refuses one message for any other reason without touching the token', () => {
    expect(classifyApnsResponse(400, 'PayloadTooLarge')).toEqual({
      kind: 'rejected',
      reason: 'PayloadTooLarge',
    });
    expect(classifyApnsResponse(403, 'InvalidProviderToken')).toEqual({
      kind: 'rejected',
      reason: 'InvalidProviderToken',
    });
  });

  it('needs every name', () => {
    expect(apnsConfigFromEnv({ ...apnsEnv, APNS_TEAM_ID: '' })).toBeNull();
    expect(
      apnsConfigFromEnv({ ...apnsEnv, APNS_PRIVATE_KEY: p8.trim().replace(/\n/g, '\\n') })?.privateKey,
    ).toBe(p8.trim());
  });
});

type FetchCall = { url: string; init: RequestInit };
/** A recorded Google: the token endpoint and the send endpoint, answered from scripts. */
function recordedGoogle(opts: {
  sends: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>;
  tokens?: Array<{ status: number; body: unknown }>;
}) {
  const calls: FetchCall[] = [];
  let sends = 0;
  let tokens = 0;
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init: init ?? {} });
    if (u.startsWith('https://oauth2.googleapis.com/')) {
      const a = opts.tokens?.[Math.min(tokens++, opts.tokens.length - 1)] ?? {
        status: 200,
        body: { access_token: `tok-${tokens++}`, expires_in: 3600 },
      };
      return new Response(JSON.stringify(a.body), { status: a.status });
    }
    const a = opts.sends[Math.min(sends++, opts.sends.length - 1)] ?? { status: 200 };
    return new Response(JSON.stringify(a.body ?? { name: 'projects/yayatoh-test/messages/0:123%abc' }), {
      status: a.status,
      headers: a.headers,
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

describe('FCM adapter (recorded responses)', () => {
  const acct = fcmConfigFromEnv({ FCM_SERVICE_ACCOUNT_JSON: account });
  if (!acct) throw new Error('account');
  const fcmPush: OutboundPush = { ...base, platform: 'fcm', token: 'f'.repeat(40), environment: null };

  it('exchanges a signed assertion for an access token, then sends one HTTP v1 message', async () => {
    const { fetch, calls } = recordedGoogle({ sends: [{ status: 200 }] });
    const r = await fcmTransport({ account: acct, fetch }).send(fcmPush);
    expect(r).toEqual({ providerMessageId: '0:123%abc' });
    const tokenCall = calls[0] as FetchCall;
    const form = new URLSearchParams(String(tokenCall.init.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [h, c, s] = (form.get('assertion') as string).split('.') as [string, string, string];
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
    expect(claims).toMatchObject({
      iss: 'push@yayatoh-test.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
    });
    expect(
      createVerify('RSA-SHA256')
        .update(`${h}.${c}`)
        .verify(createPublicKey(rsaPem), Buffer.from(s, 'base64url')),
    ).toBe(true);
    const send = calls[1] as FetchCall;
    expect(send.url).toBe('https://fcm.googleapis.com/v1/projects/yayatoh-test/messages:send');
    expect((send.init.headers as Record<string, string>).authorization).toBe('Bearer tok-0');
    const { message } = JSON.parse(String(send.init.body));
    expect(message.notification).toEqual({ title: base.title, body: base.body });
    expect(message.data).toEqual({ path: base.path, lang: 'en' });
    expect(message.android).toMatchObject({
      collapse_key: base.topic,
      priority: 'HIGH',
      ttl: '3600s',
      notification: { tag: base.topic },
    });
    expect(message.apns.headers['apns-collapse-id']).toBe(base.topic);
  });

  it('reuses the access token until shortly before it expires', async () => {
    const { fetch, calls } = recordedGoogle({ sends: [{ status: 200 }] });
    let now = new Date('2026-10-13T10:00:00Z');
    const t = fcmTransport({ account: acct, fetch, now: () => now });
    await t.send(fcmPush);
    await t.send(fcmPush);
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1);
    now = new Date(now.getTime() + 56 * 60_000);
    await t.send(fcmPush);
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(2);
  });

  it('reports an unregistered token as invalid (to be disabled)', async () => {
    const unregistered = {
      error: {
        status: 'NOT_FOUND',
        details: [
          { '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' },
        ],
      },
    };
    const { fetch } = recordedGoogle({ sends: [{ status: 404, body: unregistered }] });
    expect(await fcmTransport({ account: acct, fetch }).send(fcmPush)).toEqual({
      error: 'invalid_token',
      status: 404,
    });
    expect(
      classifyFcmResponse(400, {
        error: { status: 'INVALID_ARGUMENT', details: [{ fieldViolations: [{ field: 'message.token' }] }] },
      }),
    ).toEqual({ kind: 'invalid_token' });
    expect(classifyFcmResponse(403, { error: { details: [{ errorCode: 'SENDER_ID_MISMATCH' }] } })).toEqual({
      kind: 'invalid_token',
    });
    // A bad payload is the message's fault, not the device's.
    expect(classifyFcmResponse(400, { error: { status: 'INVALID_ARGUMENT' } })).toEqual({
      kind: 'rejected',
      reason: 'invalid_argument',
    });
  });

  it('retries 429 and 5xx, with Retry-After', async () => {
    const q = recordedGoogle({
      sends: [
        { status: 429, body: { error: { status: 'RESOURCE_EXHAUSTED' } }, headers: { 'retry-after': '30' } },
      ],
    });
    expect(await fcmTransport({ account: acct, fetch: q.fetch }).send(fcmPush)).toEqual({
      error: 'retry',
      status: 429,
      retryAfterMs: 30_000,
    });
    const s = recordedGoogle({ sends: [{ status: 503, body: { error: { status: 'UNAVAILABLE' } } }] });
    expect(await fcmTransport({ account: acct, fetch: s.fetch }).send(fcmPush)).toEqual({
      error: 'retry',
      status: 503,
      retryAfterMs: null,
    });
  });

  it('fetches a fresh access token once on a 401', async () => {
    const { fetch, calls } = recordedGoogle({
      sends: [{ status: 401, body: { error: { status: 'UNAUTHENTICATED' } } }, { status: 200 }],
    });
    const r = await fcmTransport({ account: acct, fetch }).send(fcmPush);
    expect(r).toMatchObject({ providerMessageId: '0:123%abc' });
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(2);
  });

  it('a refused service account is a configuration problem, never the device’s', async () => {
    const { fetch } = recordedGoogle({
      sends: [],
      tokens: [{ status: 400, body: { error: 'invalid_grant' } }],
    });
    expect(await fcmTransport({ account: acct, fetch }).send(fcmPush)).toMatchObject({ error: 'rejected' });
  });

  it('normal urgency is a normal-priority message; a missing collapse id sets none', () => {
    const m = fcmMessage({ ...fcmPush, urgency: 'normal', topic: null });
    expect(m.android.priority).toBe('NORMAL');
    expect(m.android).not.toHaveProperty('collapse_key');
  });

  it('reads the key as JSON or base64, and refuses a non-https token endpoint', () => {
    expect(
      fcmConfigFromEnv({ FCM_SERVICE_ACCOUNT_JSON: Buffer.from(account).toString('base64') })?.projectId,
    ).toBe('yayatoh-test');
    expect(
      fcmConfigFromEnv({
        FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
          ...JSON.parse(account),
          token_uri: 'http://evil.test/token',
        }),
      }),
    ).toBeNull();
    expect(fcmConfigFromEnv({ FCM_SERVICE_ACCOUNT_JSON: '{"project_id":"x"}' })).toBeNull();
  });
});

describe('wiring: provider modes and routing', () => {
  it('apns and fcm follow providerMode like the others', () => {
    expect(pushProviders({ PUSH_PROVIDER: 'apns, fcm ,bogus' })).toEqual(['apns', 'fcm']);
    expect(providerMode('apns', {})).toBe('off');
    expect(missingEnv('apns', {})).toEqual([
      'APNS_KEY_ID',
      'APNS_TEAM_ID',
      'APNS_PRIVATE_KEY',
      'APNS_BUNDLE_ID',
    ]);
    expect(providerMode('apns', { ...apnsEnv, PUSH_PROVIDER: undefined })).toBe('ready');
    expect(providerMode('apns', apnsEnv)).toBe('live');
    expect(providerMode('fcm', { ...apnsEnv, FCM_SERVICE_ACCOUNT_JSON: account })).toBe('live');
    expect(
      providerMode('fcm', { ...apnsEnv, PUSH_PROVIDER: 'apns', FCM_SERVICE_ACCOUNT_JSON: account }),
    ).toBe('ready');
  });

  it('a live adapter takes its platform; the rest fall to the fallback (the dev mailbox in dev and CI)', async () => {
    const sent: string[] = [];
    const fallback: PushTransport = {
      name: 'dev',
      async send(m) {
        sent.push(`fallback:${m.platform}`);
        return { providerMessageId: 'dev' };
      },
    };
    const { http2, seen } = recordedApns({ status: 200 });
    const routed = nativePushTransport({ ...apnsEnv, PUSH_PROVIDER: 'apns' }, fallback, { http2 });
    if (!routed) throw new Error('routed');
    await routed.send(base);
    await routed.send({ ...base, platform: 'fcm', token: 'f'.repeat(40) });
    await routed.send({ ...base, platform: 'webpush', token: 'https://push.example/x' });
    expect(seen).toHaveLength(1);
    expect(sent).toEqual(['fallback:fcm', 'fallback:webpush']);
    // Nothing switched on: nothing changes.
    expect(nativePushTransport({}, fallback)).toBeNull();
    expect(nativePushTransport({ PUSH_PROVIDER: 'apns' }, fallback)).toBeNull();
  });

  it('liveTransports leaves push as the base has it until a native provider is live', () => {
    const push: PushTransport = { name: 'dev', send: async () => ({ providerMessageId: 'dev' }) };
    const email = { name: 'dev', send: async () => ({ providerMessageId: 'x' }) };
    const baseTransports = { email, push };
    expect(liveTransports({}, 'https://app.test', baseTransports)?.push).toBe(push);
    expect(liveTransports({}, 'https://app.test', baseTransports)).toEqual(baseTransports);
    const live = liveTransports({ ...apnsEnv, PUSH_PROVIDER: 'apns' }, 'https://app.test', baseTransports);
    expect(live?.push).toBeDefined();
    expect(live?.push).not.toBe(push);
  });
});
