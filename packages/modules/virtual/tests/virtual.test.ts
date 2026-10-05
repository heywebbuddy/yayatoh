import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defaultAccess, effectiveAccess, mayWatch } from '../src/domain/access.ts';
import { beatVerdict, MINUTE_MS, minuteOf, splitMinutes } from '../src/domain/watch.ts';
import { FAKE_INGEST_URL, fakePlaybackCheck, fakeVideoProvider } from '../src/provider/fake.ts';
import { muxVideoProvider } from '../src/provider/mux.ts';
import { VideoUnavailableError } from '../src/provider/port.ts';
import { videoProviderFromEnv } from '../src/provider/registry.ts';

const SEED = 'a'.repeat(64);
const ORG = '01900000-0000-7000-8000-000000000001';
const VIEW = '01900000-0000-7000-8000-000000000002';
const now = new Date('2026-10-03T12:00:30Z');
const later = (ms: number) => new Date(now.getTime() + ms);

describe('access modes', () => {
  it('in-person events never stream, whatever the ticket type says', () => {
    for (const a of ['in_person', 'virtual', 'both', null] as const)
      expect(effectiveAccess('in_person', a)).toBe('in_person');
  });
  it('defaults: online tickets are virtual, hybrid tickets in person', () => {
    expect(defaultAccess('online')).toBe('virtual');
    expect(defaultAccess('hybrid')).toBe('in_person');
    expect(effectiveAccess('hybrid', null)).toBe('in_person');
    expect(effectiveAccess('online', null)).toBe('virtual');
  });
  it('an explicit choice wins on online and hybrid events', () => {
    expect(effectiveAccess('hybrid', 'both')).toBe('both');
    expect(effectiveAccess('hybrid', 'virtual')).toBe('virtual');
    expect(effectiveAccess('online', 'in_person')).toBe('in_person');
  });
  it('only virtual and both may watch', () => {
    expect(mayWatch('in_person')).toBe(false);
    expect(mayWatch('virtual')).toBe(true);
    expect(mayWatch('both')).toBe(true);
  });
});

describe('watch time', () => {
  it('counts the minute the server received the heartbeat in', () => {
    expect(minuteOf(new Date('2026-10-03T12:00:59.999Z')).toISOString()).toBe('2026-10-03T12:00:00.000Z');
    expect(minuteOf(new Date('2026-10-03T12:01:00.000Z')).toISOString()).toBe('2026-10-03T12:01:00.000Z');
  });
  it('a sequence not above the last accepted one is a replay; an expired viewing counts nothing', () => {
    const view = { beatSeq: 3, expiresAt: later(MINUTE_MS) };
    expect(beatVerdict(view, 4, now)).toBe('count');
    expect(beatVerdict(view, 9, now)).toBe('count');
    expect(beatVerdict(view, 3, now)).toBe('replayed');
    expect(beatVerdict(view, 1, now)).toBe('replayed');
    expect(beatVerdict(view, 4, later(MINUTE_MS))).toBe('expired');
  });
  it('splits minutes for display', () => {
    expect(splitMinutes(65)).toEqual({ hours: 1, minutes: 5 });
    expect(splitMinutes(0)).toEqual({ hours: 0, minutes: 0 });
  });
});

describe('fake video provider', () => {
  const p = fakeVideoProvider({ seed: SEED });

  it('reuses the stream for the same idempotency key, and gives another session another one', async () => {
    const a = await p.createLiveStream({ orgId: ORG, sessionId: VIEW, idempotencyKey: 'k1' });
    const b = await p.createLiveStream({ orgId: ORG, sessionId: VIEW, idempotencyKey: 'k1' });
    const c = await p.createLiveStream({ orgId: ORG, sessionId: VIEW, idempotencyKey: 'k2' });
    expect(a).toEqual(b);
    expect(c.playbackId).not.toBe(a.playbackId);
    expect(a.ingestUrl).toBe(FAKE_INGEST_URL);
    expect(a.playbackId).toMatch(/^[A-Za-z0-9_]{8,64}$/);
    expect(await p.streamKey(a.providerStreamId)).toMatch(/^fake-sk-[0-9a-f]{32}$/);
  });

  it('a playback token round-trips and plays only its own playback id until it expires', async () => {
    const s = await p.createLiveStream({ orgId: ORG, sessionId: VIEW, idempotencyKey: 'k1' });
    const other = await p.createLiveStream({ orgId: ORG, sessionId: VIEW, idempotencyKey: 'k2' });
    const token = p.signPlayback({
      playbackId: s.playbackId,
      orgId: ORG,
      viewId: VIEW,
      expiresAt: later(60_000),
    });
    expect(p.verifyPlayback(token, now)).toEqual({
      playbackId: s.playbackId,
      orgId: ORG,
      viewId: VIEW,
      expiresAt: new Date(Math.floor(later(60_000).getTime() / 1000) * 1000),
    });
    expect(fakePlaybackCheck(p, s.playbackId, token, now)).toBe('ok');
    expect(fakePlaybackCheck(p, other.playbackId, token, now)).toBe('forbidden');
    expect(fakePlaybackCheck(p, s.playbackId, token, later(60_000))).toBe('forbidden');
    expect(p.verifyPlayback(token, later(60_000))).toBeNull();
    expect(p.playbackUrl(s.playbackId, token)).toContain(encodeURIComponent(token));
  });

  it('refuses tampered, foreign and malformed tokens', () => {
    const token = p.signPlayback({
      playbackId: 'fkabcdef12',
      orgId: ORG,
      viewId: VIEW,
      expiresAt: later(60_000),
    });
    const [h, body, sig] = token.split('.');
    const forged = JSON.parse(Buffer.from(body ?? '', 'base64url').toString());
    forged.yy.vid = '01900000-0000-7000-8000-000000000009';
    const tampered = `${h}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`;
    expect(p.verifyPlayback(tampered, now)).toBeNull();
    const elsewhere = fakeVideoProvider({ seed: 'b'.repeat(64) });
    expect(elsewhere.verifyPlayback(token, now)).toBeNull();
    for (const bad of ['', 'a.b', 'a.b.c', `${token}x`, 'x'.repeat(2000)])
      expect(p.verifyPlayback(bad, now)).toBeNull();
  });

  it('needs a long seed', () => {
    expect(() => fakeVideoProvider({ seed: 'short' })).toThrow();
  });
});

describe('Mux adapter', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const mux = muxVideoProvider({
    signingKeyId: 'kid123',
    signingPrivateKey: Buffer.from(pem).toString('base64'),
  });

  it('signs RS256 playback tokens with the signing key id and Mux claims, locally', () => {
    const token = mux.signPlayback({
      playbackId: 'abcDEF123456',
      orgId: ORG,
      viewId: VIEW,
      expiresAt: later(60_000),
    });
    const [h, b] = token.split('.');
    expect(JSON.parse(Buffer.from(h ?? '', 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
      kid: 'kid123',
    });
    const claims = JSON.parse(Buffer.from(b ?? '', 'base64url').toString());
    expect(claims).toMatchObject({ sub: 'abcDEF123456', aud: 'v', kid: 'kid123' });
    expect(mux.verifyPlayback(token, now)?.viewId).toBe(VIEW);
    expect(mux.verifyPlayback(token, later(60_000))).toBeNull();
    expect(mux.playbackUrl('abcDEF123456', token)).toBe(
      `https://stream.mux.com/abcDEF123456.m3u8?token=${encodeURIComponent(token)}`,
    );
  });

  it('refuses a token signed by another key', () => {
    const fake = fakeVideoProvider({ seed: SEED });
    const t = fake.signPlayback({
      playbackId: 'abcDEF123456',
      orgId: ORG,
      viewId: VIEW,
      expiresAt: later(60_000),
    });
    expect(mux.verifyPlayback(t, now)).toBeNull();
  });

  it('the Video API is a stub until the owner account exists (no network call)', async () => {
    await expect(
      mux.createLiveStream({ orgId: ORG, sessionId: VIEW, idempotencyKey: 'k' }),
    ).rejects.toBeInstanceOf(VideoUnavailableError);
    await expect(mux.streamKey('s')).rejects.toBeInstanceOf(VideoUnavailableError);
  });
});

describe('videoProviderFromEnv', () => {
  it('fake by default outside production; off in production without Mux', () => {
    expect(videoProviderFromEnv({ APP_TOKEN_SECRET: SEED })?.name).toBe('fake');
    expect(videoProviderFromEnv({})).toBeNull();
    expect(videoProviderFromEnv({ NODE_ENV: 'production', APP_TOKEN_SECRET: SEED })).toBeNull();
    expect(
      videoProviderFromEnv({ NODE_ENV: 'production', YAYATOH_DEV_AUTH: '1', APP_TOKEN_SECRET: SEED })?.name,
    ).toBe('fake');
    expect(
      videoProviderFromEnv({ VIDEO_PROVIDER: 'fake', VERCEL_ENV: 'production', APP_TOKEN_SECRET: SEED }),
    ).toBeNull();
    expect(videoProviderFromEnv({ VIDEO_PROVIDER: 'mux' })).toBeNull();
  });
});
