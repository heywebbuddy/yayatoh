import { createECDH, createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pushOptions, pushRowOutcome } from '../src/dispatch.ts';
import {
  _derive,
  b64url,
  buildWebPushPayload,
  classifyPushResponse,
  decryptPayload,
  encryptPayload,
  generateVapidKeys,
  isAllowedPushEndpoint,
  MAX_PLAINTEXT_BYTES,
  normalizeSubscriptionKeys,
  pushHeaders,
  pushTopic,
  retryAfterMs,
  vapidAuthorization,
  vapidJwt,
  vapidPublicKeyOf,
  verifyVapidAuthorization,
} from '../src/web-push.ts';
import { routedPushTransport, vapidConfig, webPushTransport } from '../src/web-push-transport.ts';

// RFC 8291 Appendix A.
const V = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  ecdhSecret: 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs',
  ikm: 'S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg',
  prk: '09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc',
  cek: 'oIhVW04MRdy2XN9CiKLxTg',
  nonce: '4h_95klXJ5E_qnoN',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

function browserKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: b64url.encode(ecdh.getPublicKey()),
    privateKey: b64url.encode(ecdh.getPrivateKey()),
    auth: b64url.encode(Buffer.from('0123456789abcdef')),
  };
}

describe('RFC 8291 message encryption', () => {
  it('reproduces the Appendix A intermediate values', () => {
    const d = _derive({
      ecdhSecret: b64url.decode(V.ecdhSecret),
      authSecret: b64url.decode(V.auth),
      uaPublic: b64url.decode(V.uaPublic),
      asPublic: b64url.decode(V.asPublic),
      salt: b64url.decode(V.salt),
    });
    expect(b64url.encode(d.ikm)).toBe(V.ikm);
    expect(b64url.encode(d.prk)).toBe(V.prk);
    expect(b64url.encode(d.cek)).toBe(V.cek);
    expect(b64url.encode(d.nonce)).toBe(V.nonce);
  });

  it('encrypts the Appendix A message byte for byte', () => {
    const body = encryptPayload({
      payload: V.plaintext,
      p256dh: V.uaPublic,
      auth: V.auth,
      salt: b64url.decode(V.salt),
      asPrivateKey: V.asPrivate,
    });
    expect(b64url.encode(body)).toBe(V.body);
  });

  it('decrypts the Appendix A message as the browser does', () => {
    expect(
      decryptPayload({ body: b64url.decode(V.body), uaPrivateKey: V.uaPrivate, auth: V.auth }).toString(),
    ).toBe(V.plaintext);
  });

  it('round-trips random keys; header is salt, rs=4096, idlen=65, a fresh sender key', () => {
    const k = browserKeys();
    const a = encryptPayload({ payload: '{"title":"Hi"}', p256dh: k.p256dh, auth: k.auth });
    const b = encryptPayload({ payload: '{"title":"Hi"}', p256dh: k.p256dh, auth: k.auth });
    expect(a.equals(b)).toBe(false);
    expect(a.readUInt32BE(16)).toBe(4096);
    expect(a.readUInt8(20)).toBe(65);
    expect(a.readUInt8(21)).toBe(4);
    expect(decryptPayload({ body: a, uaPrivateKey: k.privateKey, auth: k.auth }).toString()).toBe(
      '{"title":"Hi"}',
    );
  });

  it('refuses tampering, wrong keys, oversize payloads and malformed keys', () => {
    const k = browserKeys();
    const body = encryptPayload({ payload: 'secret', p256dh: k.p256dh, auth: k.auth });
    const flipped = Buffer.from(body);
    flipped[flipped.length - 1] = (flipped.at(-1) ?? 0) ^ 1;
    expect(() => decryptPayload({ body: flipped, uaPrivateKey: k.privateKey, auth: k.auth })).toThrow();
    expect(() =>
      decryptPayload({ body, uaPrivateKey: k.privateKey, auth: b64url.encode(Buffer.alloc(16)) }),
    ).toThrow();
    expect(() =>
      encryptPayload({ payload: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1), p256dh: k.p256dh, auth: k.auth }),
    ).toThrow(/too large/);
    expect(
      encryptPayload({ payload: 'x'.repeat(MAX_PLAINTEXT_BYTES), p256dh: k.p256dh, auth: k.auth }).length,
    ).toBe(4096);
    expect(() => encryptPayload({ payload: 'x', p256dh: 'AAAA', auth: k.auth })).toThrow(/p256dh/);
    expect(() => encryptPayload({ payload: 'x', p256dh: k.p256dh, auth: 'AAAA' })).toThrow(/auth/);
  });

  it('normalises subscription keys and rejects points off the curve', () => {
    const k = browserKeys();
    expect(normalizeSubscriptionKeys({ p256dh: `${k.p256dh}=`, auth: `${k.auth}==` })).toEqual({
      p256dh: k.p256dh,
      auth: k.auth,
    });
    const bad = Buffer.alloc(65, 7);
    bad[0] = 4;
    expect(normalizeSubscriptionKeys({ p256dh: b64url.encode(bad), auth: k.auth })).toBeNull();
    expect(normalizeSubscriptionKeys({ p256dh: k.p256dh, auth: 'short' })).toBeNull();
  });
});

describe('RFC 8292 VAPID', () => {
  const keys = generateVapidKeys();
  const now = new Date('2026-09-28T12:00:00Z');

  it('signs an ES256 JWT with aud, exp (12 h) and sub that the push service verifies', () => {
    const jwt = vapidJwt({
      audience: 'https://fcm.googleapis.com',
      subject: 'mailto:ops@example.com',
      keys,
      now,
    });
    const [h, c, s] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(b64url.decode(h).toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(b64url.decode(c).toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now.getTime() / 1000 + 12 * 3600,
      sub: 'mailto:ops@example.com',
    });
    expect(b64url.decode(s)).toHaveLength(64);
    const header = vapidAuthorization({
      audience: 'https://fcm.googleapis.com',
      subject: 'mailto:ops@example.com',
      keys,
      now,
    });
    expect(header).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${keys.publicKey}$`));
    expect(
      verifyVapidAuthorization(header, {
        publicKey: keys.publicKey,
        audience: 'https://fcm.googleapis.com',
        now,
      }),
    ).toMatchObject({ sub: 'mailto:ops@example.com' });
  });

  it('the push service refuses another key, audience, an expired token or a forged signature', () => {
    const header = vapidAuthorization({
      audience: 'https://a.test',
      subject: 'https://yayatoh.com',
      keys,
      now,
    });
    const other = generateVapidKeys();
    expect(
      verifyVapidAuthorization(header, { publicKey: other.publicKey, audience: 'https://a.test', now }),
    ).toBeNull();
    expect(
      verifyVapidAuthorization(header, { publicKey: keys.publicKey, audience: 'https://b.test', now }),
    ).toBeNull();
    expect(
      verifyVapidAuthorization(header, {
        publicKey: keys.publicKey,
        audience: 'https://a.test',
        now: new Date(now.getTime() + 13 * 3600_000),
      }),
    ).toBeNull();
    const forged = vapidAuthorization({
      audience: 'https://a.test',
      subject: 'https://yayatoh.com',
      keys: other,
      now,
    }).replace(other.publicKey, keys.publicKey);
    expect(
      verifyVapidAuthorization(forged, { publicKey: keys.publicKey, audience: 'https://a.test', now }),
    ).toBeNull();
    expect(
      verifyVapidAuthorization(null, { publicKey: keys.publicKey, audience: 'https://a.test', now }),
    ).toBeNull();
  });

  it('requires a mailto: or https: subject', () => {
    expect(() => vapidJwt({ audience: 'https://a.test', subject: 'ops@example.com', keys, now })).toThrow();
  });

  it('config: explicit keys must match; dev derives a stable pair; production without keys is off', () => {
    expect(
      vapidConfig({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }),
    ).toMatchObject({
      keys,
      dev: false,
      subject: 'mailto:notifications@mail.yayatoh.com',
    });
    expect(() =>
      vapidConfig({ VAPID_PUBLIC_KEY: generateVapidKeys().publicKey, VAPID_PRIVATE_KEY: keys.privateKey }),
    ).toThrow(/does not match/);
    expect(() => vapidConfig({ VAPID_PRIVATE_KEY: keys.privateKey })).toThrow(/both/);
    expect(() => vapidConfig({ VAPID_SUBJECT: 'nobody' })).toThrow(/VAPID_SUBJECT/);
    const dev = vapidConfig({ APP_TOKEN_SECRET: 'a'.repeat(64) });
    expect(dev?.dev).toBe(true);
    expect(vapidConfig({ APP_TOKEN_SECRET: 'a'.repeat(64) })?.keys).toEqual(dev?.keys);
    expect(vapidPublicKeyOf(dev?.keys.privateKey ?? '')).toBe(dev?.keys.publicKey);
    expect(vapidConfig({ APP_TOKEN_SECRET: 'a'.repeat(64), VERCEL_ENV: 'production' })).toBeNull();
    expect(vapidConfig({})).toBeNull();
  });
});

describe('push request headers and responses', () => {
  it('TTL (clamped), Urgency, Topic, aes128gcm', () => {
    expect(
      pushHeaders({
        authorization: 'vapid t=x, k=y',
        ttlSeconds: 3600.7,
        urgency: 'high',
        topic: 'abc',
        contentLength: 120,
      }),
    ).toEqual({
      Authorization: 'vapid t=x, k=y',
      TTL: '3600',
      Urgency: 'high',
      Topic: 'abc',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Content-Length': '120',
    });
    expect(pushHeaders({ authorization: 'a', ttlSeconds: -5, urgency: 'low', contentLength: 1 }).TTL).toBe(
      '0',
    );
    expect(pushHeaders({ authorization: 'a', ttlSeconds: 1e9, urgency: 'low', contentLength: 1 }).TTL).toBe(
      String(28 * 86400),
    );
    expect(
      pushHeaders({ authorization: 'a', ttlSeconds: 1, urgency: 'low', contentLength: 1 }),
    ).not.toHaveProperty('Topic');
    expect(() =>
      pushHeaders({
        authorization: 'a',
        ttlSeconds: 1,
        urgency: 'low',
        topic: 'has space',
        contentLength: 1,
      }),
    ).toThrow();
  });

  it('a topic is 32 base64url characters, stable per message', () => {
    const t = pushTopic('0192-message');
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(pushTopic('0192-message')).toBe(t);
    expect(pushTopic('other')).not.toBe(t);
    expect(t).toBe(createHash('sha256').update('0192-message').digest('base64url').slice(0, 32));
  });

  it('201 sent; 404/410 prune; 429/5xx retry (Retry-After seconds or date); 400/403/413 rejected', () => {
    const h = (o: Record<string, string> = {}) => new Headers(o);
    const now = new Date('2026-09-28T12:00:00Z');
    expect(classifyPushResponse(201, h({ location: 'https://p/m/1' }))).toEqual({
      kind: 'sent',
      providerMessageId: 'https://p/m/1',
    });
    expect(classifyPushResponse(404, h())).toEqual({ kind: 'expired', status: 404 });
    expect(classifyPushResponse(410, h())).toEqual({ kind: 'expired', status: 410 });
    expect(classifyPushResponse(429, h({ 'retry-after': '120' }))).toEqual({
      kind: 'retry',
      status: 429,
      retryAfterMs: 120_000,
    });
    expect(classifyPushResponse(503, h({ 'retry-after': 'Mon, 28 Sep 2026 12:05:00 GMT' }), now)).toEqual({
      kind: 'retry',
      status: 503,
      retryAfterMs: 300_000,
    });
    for (const s of [400, 401, 403, 413])
      expect(classifyPushResponse(s, h())).toEqual({ kind: 'rejected', status: s });
    expect(retryAfterMs('nonsense')).toBeNull();
    expect(retryAfterMs('999999999')).toBe(86_400_000);
  });

  it('only known push services (or the dev fake service on our own origin) are contacted', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QGn1',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ])
      expect(isAllowedPushEndpoint(ok)).toBe(true);
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com.evil.test/x',
      'https://169.254.169.254/latest',
      'https://user:pw@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
      'http://localhost:3100/api/dev/push-service/abcdefgh',
      'not a url',
    ])
      expect(isAllowedPushEndpoint(bad)).toBe(false);
    const fakeOrigin = 'http://localhost:3100';
    expect(isAllowedPushEndpoint('http://localhost:3100/api/dev/push-service/abcdefgh', { fakeOrigin })).toBe(
      true,
    );
    expect(isAllowedPushEndpoint('http://localhost:3100/api/other/abcdefgh', { fakeOrigin })).toBe(false);
    expect(isAllowedPushEndpoint('http://localhost:3101/api/dev/push-service/abcdefgh', { fakeOrigin })).toBe(
      false,
    );
  });

  it('the payload is an allowlist: title, body, our-origin URL, tag, lang, dir', () => {
    const p = buildWebPushPayload({
      title: 'Doors at 7',
      body: 'x'.repeat(700),
      url: 'https://evil.test/phish',
      appOrigin: 'https://app.yayatoh.test',
      tag: 'abc',
      lang: 'ar',
      dir: 'rtl',
    });
    expect(Object.keys(p).sort()).toEqual(['body', 'dir', 'lang', 'tag', 'title', 'url']);
    expect(p.url).toBeNull();
    expect(p.body).toHaveLength(600);
    expect(
      buildWebPushPayload({
        title: 'T',
        body: 'B',
        url: '/messages/abc',
        appOrigin: 'https://app.yayatoh.test',
        tag: 't',
        lang: 'en',
        dir: 'ltr',
      }).url,
    ).toBe('https://app.yayatoh.test/messages/abc');
  });
});

describe('the web push adapter', () => {
  const vapid = { keys: generateVapidKeys(), subject: 'mailto:ops@example.com', dev: false };
  const k = browserKeys();
  const msg = {
    platform: 'webpush' as const,
    token: 'https://fcm.googleapis.com/fcm/send/device-1',
    keys: { p256dh: k.p256dh, auth: k.auth },
    title: 'Doors at 7',
    body: 'Lot B is closed.',
    url: 'https://app.yayatoh.test/messages/t',
    idempotencyKey: 'm:1',
    ttlSeconds: 86400,
    urgency: 'normal' as const,
    topic: pushTopic('m'),
  };

  it('POSTs an encrypted, VAPID-signed request and maps the status', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const t = webPushTransport({
      vapid,
      appOrigin: 'https://app.yayatoh.test',
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response(null, { status: 201, headers: { location: 'https://fcm.googleapis.com/m/9' } });
      },
    });
    expect(await t.send(msg)).toEqual({ providerMessageId: 'https://fcm.googleapis.com/m/9' });
    const [call] = calls;
    const headers = call?.init.headers as Record<string, string>;
    expect(call?.url).toBe(msg.token);
    expect(headers.TTL).toBe('86400');
    expect(headers.Urgency).toBe('normal');
    expect(headers.Topic).toBe(msg.topic);
    expect(
      verifyVapidAuthorization(headers.Authorization ?? null, {
        publicKey: vapid.keys.publicKey,
        audience: 'https://fcm.googleapis.com',
      }),
    ).not.toBeNull();
    const payload = JSON.parse(
      decryptPayload({
        body: call?.init.body as Uint8Array,
        uaPrivateKey: k.privateKey,
        auth: k.auth,
      }).toString(),
    );
    expect(payload).toEqual({
      title: 'Doors at 7',
      body: 'Lot B is closed.',
      url: 'https://app.yayatoh.test/messages/t',
      tag: msg.topic,
      lang: 'en',
      dir: 'ltr',
    });
  });

  it('410 → invalid_token, 429 → retry with Retry-After, 413 → rejected, network → retry', async () => {
    const answer = (status: number, headers: Record<string, string> = {}) =>
      webPushTransport({
        vapid,
        appOrigin: 'https://a.test',
        fetch: async () => new Response(null, { status, headers }),
      });
    expect(await answer(410).send(msg)).toEqual({ error: 'invalid_token', status: 410 });
    expect(await answer(429, { 'retry-after': '30' }).send(msg)).toEqual({
      error: 'retry',
      status: 429,
      retryAfterMs: 30_000,
    });
    expect(await answer(413).send(msg)).toMatchObject({ error: 'rejected', status: 413 });
    const down = webPushTransport({
      vapid,
      appOrigin: 'https://a.test',
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    expect(await down.send(msg)).toEqual({ error: 'retry', retryAfterMs: null });
  });

  it('never contacts an endpoint off the allowlist, or without keys', async () => {
    let called = false;
    const t = webPushTransport({
      vapid,
      appOrigin: 'https://a.test',
      fetch: async () => {
        called = true;
        return new Response(null, { status: 201 });
      },
    });
    expect(await t.send({ ...msg, token: 'https://169.254.169.254/x' })).toMatchObject({ error: 'rejected' });
    expect(await t.send({ ...msg, keys: null })).toMatchObject({ error: 'rejected' });
    expect(called).toBe(false);
  });

  it('routes by platform', async () => {
    const seen: string[] = [];
    const r = routedPushTransport(
      {
        webpush: {
          send: async () => {
            seen.push('web');
            return { providerMessageId: 'w' };
          },
        },
      },
      {
        send: async () => {
          seen.push('other');
          return { providerMessageId: 'o' };
        },
      },
    );
    await r.send(msg);
    await r.send({ ...msg, platform: 'fcm' });
    expect(seen).toEqual(['web', 'other']);
  });
});

describe('push rules for a message', () => {
  it('sent when any device got it; retry while one is rate limited; prune-only means no device', () => {
    expect(pushRowOutcome([{ status: 'sent', providerMessageId: 'a' }, { status: 'expired' }])).toEqual({
      kind: 'sent',
      providerMessageId: 'a',
    });
    expect(
      pushRowOutcome([
        { status: 'sent', providerMessageId: 'a' },
        { status: 'retrying', httpStatus: 429, retryAfterMs: 5000 },
        { status: 'retrying', httpStatus: 429, retryAfterMs: 60_000 },
      ]),
    ).toEqual({ kind: 'retry', status: 429, retryAfterMs: 60_000 });
    expect(pushRowOutcome([{ status: 'retrying', httpStatus: 503 }])).toEqual({
      kind: 'retry',
      status: 503,
      retryAfterMs: null,
    });
    expect(pushRowOutcome([{ status: 'rejected' }, { status: 'expired' }])).toEqual({ kind: 'rejected' });
    expect(pushRowOutcome([{ status: 'expired' }])).toEqual({ kind: 'none' });
    expect(pushRowOutcome([])).toEqual({ kind: 'none' });
  });

  it('TTL and urgency per kind', () => {
    expect(pushOptions('messaging.announcement')).toEqual({ ttlSeconds: 86_400, urgency: 'normal' });
    expect(pushOptions('sales.order_paid')).toEqual({ ttlSeconds: 4 * 3600, urgency: 'high' });
    expect(pushOptions('events.reminder')).toEqual({ ttlSeconds: 12 * 3600, urgency: 'normal' });
    expect(pushOptions('notifications.test')).toEqual({ ttlSeconds: 300, urgency: 'high' });
  });
});
