import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CLOUDFLARE_BACKUP_INGEST_URL, cloudflareStreamProvider } from '../src/provider/cloudflare.ts';
import {
  FAKE_BACKUP_INGEST_URL,
  FAKE_CLOUDFLARE_INGEST_URL,
  fakePlaybackCheck,
  fakeVideoProvider,
} from '../src/provider/fake.ts';
import { VideoUnavailableError } from '../src/provider/port.ts';
import {
  configureVirtual,
  currentVideoProvider,
  verifyPlaybackAny,
  videoProvider,
  videoProviders,
  videoProvidersFromEnv,
} from '../src/provider/registry.ts';
import { zoomEventKey, zoomParticipantKey, zoomSegmentKey } from '../src/zoom-keys.ts';
import {
  pairStays,
  signZoomWebhook,
  verifyZoomSignature,
  ZOOM_WEBHOOK_TOLERANCE_MS,
  zoomWebhookSecretFromEnv,
} from '../src/zoom-webhook.ts';

/** M6.10a: providers v2 (Cloudflare Stream, the registry), Zoom webhook signatures and stays. */
const SEED = 'b'.repeat(64);
const ORG = '01900000-0000-7000-8000-000000000001';
const VIEW = '01900000-0000-7000-8000-000000000002';
const now = new Date('2026-10-03T12:00:30Z');
const later = (ms: number) => new Date(now.getTime() + ms);
const claims = (playbackId: string) => ({ playbackId, orgId: ORG, viewId: VIEW, expiresAt: later(60_000) });

const pem = () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
};

describe('the fake Cloudflare Stream', () => {
  const mux = fakeVideoProvider({ seed: SEED });
  const cf = fakeVideoProvider({ seed: SEED, kind: 'cloudflare' });

  it('is its own provider: other ids, ingest, backup and signing key', async () => {
    expect(cf).toMatchObject({ name: 'fake_cloudflare', kind: 'cloudflare', sandbox: true });
    expect(mux).toMatchObject({ name: 'fake', kind: 'mux', sandbox: true });
    const a = await mux.createLiveStream({ orgId: ORG, sessionId: VIEW, idempotencyKey: 'k' });
    const b = await cf.createLiveStream({ orgId: ORG, sessionId: VIEW, idempotencyKey: 'k' });
    expect(b.playbackId).not.toBe(a.playbackId);
    expect(b.playbackId).toMatch(/^fc[0-9a-f]{30}$/);
    expect(b.ingestUrl).toBe(FAKE_CLOUDFLARE_INGEST_URL);
    expect(a.backupIngestUrl).toBe(FAKE_BACKUP_INGEST_URL);
    expect(b.backupIngestUrl).toMatch(/^rtmp:\/\//);
    // Retried with the same key: the same stream (idempotent like the real APIs).
    expect(await cf.createLiveStream({ orgId: ORG, sessionId: VIEW, idempotencyKey: 'k' })).toEqual(b);
    expect(await cf.streamKey(b.providerStreamId)).toMatch(/^fake-cf-sk-[0-9a-f]{32}$/);
  });

  it('one fake never accepts the other’s tokens', () => {
    const t = cf.signPlayback(claims('fc0123456789abcdef'));
    expect(cf.verifyPlayback(t, now)?.viewId).toBe(VIEW);
    expect(mux.verifyPlayback(t, now)).toBeNull();
    expect(fakePlaybackCheck(cf, 'fc0123456789abcdef', t, now)).toBe('ok');
    expect(fakePlaybackCheck(mux, 'fc0123456789abcdef', t, now)).toBe('forbidden');
  });
});

describe('the Cloudflare Stream adapter', () => {
  const cf = cloudflareStreamProvider({
    signingKeyId: 'cfkey123',
    signingPrivateKey: pem(),
    customerCode: 'abc123def',
  });

  it('signs RS256 playback tokens locally and builds the signed manifest URL', () => {
    const t = cf.signPlayback(claims('0123456789abcdef0123456789abcdef'));
    expect(JSON.parse(Buffer.from(t.split('.')[0] as string, 'base64url').toString())).toMatchObject({
      alg: 'RS256',
      kid: 'cfkey123',
    });
    expect(cf.verifyPlayback(t, now)?.playbackId).toBe('0123456789abcdef0123456789abcdef');
    expect(cf.verifyPlayback(t, later(120_000))).toBeNull();
    expect(cf.playbackUrl('ignored', t)).toBe(
      `https://customer-abc123def.cloudflarestream.com/${encodeURIComponent(t)}/manifest/video.m3u8`,
    );
    expect(CLOUDFLARE_BACKUP_INGEST_URL).toMatch(/^rtmp:\/\//);
  });

  it('the Stream API is a stub until the owner account exists (no network call)', async () => {
    await expect(
      cf.createLiveStream({ orgId: ORG, sessionId: VIEW, idempotencyKey: 'k' }),
    ).rejects.toBeInstanceOf(VideoUnavailableError);
    await expect(cf.streamKey('s')).rejects.toBeInstanceOf(VideoUnavailableError);
  });

  it('refuses a malformed customer code', () => {
    expect(() =>
      cloudflareStreamProvider({ signingKeyId: 'k', signingPrivateKey: pem(), customerCode: 'Bad.Code' }),
    ).toThrow();
  });
});

describe('the provider registry', () => {
  it('registers both fakes outside production; real ones only with their keys', () => {
    expect(videoProvidersFromEnv({ APP_TOKEN_SECRET: SEED }).map((p) => p.name)).toEqual([
      'fake',
      'fake_cloudflare',
    ]);
    expect(videoProvidersFromEnv({ NODE_ENV: 'production', APP_TOKEN_SECRET: SEED })).toEqual([]);
    expect(videoProvidersFromEnv({ VIDEO_PROVIDER: 'cloudflare' })).toEqual([]);
    const cfEnv = {
      CLOUDFLARE_STREAM_SIGNING_KEY_ID: 'cfkey',
      CLOUDFLARE_STREAM_SIGNING_PRIVATE_KEY: pem(),
      CLOUDFLARE_STREAM_CUSTOMER_CODE: 'abc123def',
    };
    expect(videoProvidersFromEnv({ VIDEO_PROVIDER: 'cloudflare', ...cfEnv }).map((p) => p.name)).toEqual([
      'cloudflare',
    ]);
    const both = videoProvidersFromEnv({
      VIDEO_PROVIDER: 'mux',
      MUX_SIGNING_KEY_ID: 'muxkey',
      MUX_SIGNING_PRIVATE_KEY: pem(),
      ...cfEnv,
    });
    expect(both.map((p) => p.name)).toEqual(['mux', 'cloudflare']);
  });

  it('finds a provider by name and verifies a token with whichever provider signed it', () => {
    const mux = fakeVideoProvider({ seed: SEED });
    const cf = fakeVideoProvider({ seed: SEED, kind: 'cloudflare' });
    configureVirtual({ provider: mux, providers: [cf, mux] });
    expect(videoProviders().map((p) => p.name)).toEqual(['fake', 'fake_cloudflare']);
    expect(currentVideoProvider()?.name).toBe('fake');
    expect(videoProvider('fake_cloudflare')).toBe(cf);
    expect(() => videoProvider('cloudflare')).toThrow(/not available/);
    const t = cf.signPlayback(claims('fc0123456789abcdef'));
    expect(verifyPlaybackAny(t, now)?.provider.name).toBe('fake_cloudflare');
    expect(verifyPlaybackAny('x.y.z', now)).toBeNull();
    configureVirtual({});
    expect(() => videoProvider()).toThrow(/not available/);
  });
});

describe('Zoom webhook signatures', () => {
  const secret = 'z'.repeat(40);
  const body = '{"event":"webinar.participant_joined"}';

  it('accepts Zoom’s v0 signature within five minutes, nothing else', () => {
    const h = new Headers(signZoomWebhook(secret, body, now));
    expect(h.get('x-zm-signature')).toMatch(/^v0=[0-9a-f]{64}$/);
    expect(verifyZoomSignature(secret, body, h, now)).toBe(true);
    expect(verifyZoomSignature(secret, body, h, later(ZOOM_WEBHOOK_TOLERANCE_MS - 1000))).toBe(true);
    expect(verifyZoomSignature(secret, body, h, later(ZOOM_WEBHOOK_TOLERANCE_MS + 1000))).toBe(false);
    expect(verifyZoomSignature(secret, `${body} `, h, now)).toBe(false);
    expect(verifyZoomSignature('y'.repeat(40), body, h, now)).toBe(false);
    expect(verifyZoomSignature(secret, body, new Headers(), now)).toBe(false);
    const bad = new Headers({ 'x-zm-request-timestamp': 'abc', 'x-zm-signature': 'v0=00' });
    expect(verifyZoomSignature(secret, body, bad, now)).toBe(false);
  });

  it('the secret: the app’s token, else a fake one outside production', () => {
    expect(zoomWebhookSecretFromEnv({ ZOOM_WEBHOOK_SECRET_TOKEN: 's'.repeat(24) })).toBe('s'.repeat(24));
    expect(zoomWebhookSecretFromEnv({ APP_TOKEN_SECRET: SEED })).toMatch(/^[0-9a-f]{64}$/);
    expect(zoomWebhookSecretFromEnv({ APP_TOKEN_SECRET: SEED, VERCEL_ENV: 'production' })).toBeNull();
    expect(zoomWebhookSecretFromEnv({ APP_TOKEN_SECRET: SEED, NODE_ENV: 'production' })).toBeNull();
    expect(zoomWebhookSecretFromEnv({})).toBeNull();
  });
});

describe('Zoom stays and keys', () => {
  const at = (s: number) => new Date(now.getTime() + s * 1000);

  it('pairs each join with the next leave, whatever order they arrived in', () => {
    const stays = pairStays([
      { kind: 'left', at: at(20), email: null },
      { kind: 'joined', at: at(0), email: 'a@x.test' },
      { kind: 'joined', at: at(40), email: 'a@x.test' },
      { kind: 'left', at: at(80), email: 'a@x.test' },
      { kind: 'joined', at: at(90), email: 'a@x.test' },
    ]);
    expect(stays).toEqual([
      { joinedAt: at(0), leftAt: at(20), email: 'a@x.test' },
      { joinedAt: at(40), leftAt: at(80), email: 'a@x.test' },
    ]);
    // A leave without a join (Zoom lost it) makes no stay.
    expect(pairStays([{ kind: 'left', at: at(5), email: 'a@x.test' }])).toEqual([]);
  });

  it('keys are sha256, case-insensitive on addresses, second-precise on joins', () => {
    expect(zoomSegmentKey('A@X.test', new Date(now.getTime() + 400))).toBe(zoomSegmentKey('a@x.test', now));
    expect(zoomSegmentKey('a@x.test', at(1))).not.toBe(zoomSegmentKey('a@x.test', now));
    expect(zoomParticipantKey('81234567890', 'P1')).toMatch(/^[0-9a-f]{64}$/);
    expect(zoomEventKey('e1')).not.toBe(zoomEventKey('e2'));
  });
});
