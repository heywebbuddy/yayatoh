import { createHmac } from 'node:crypto';
import { signJwt, verifyJwt } from './jwt.ts';
import type { VideoProvider } from './port.ts';

/**
 * The fake video provider (dev, CI and previews): no account and no network. Ids are derived
 * from the seed and the idempotency key, so a retried create (in any process) gets the same stream
 * back, like Mux with an idempotency key. Tokens are HS256 JWTs under the seed. Its "CDN" is
 * `fakePlaybackCheck`, which the web's dev route answers with: the stream plays only with an
 * authentic, unexpired token for that very playback id.
 */
export const FAKE_INGEST_URL = 'rtmps://live.fake-video.test:443/app';
export const FAKE_KID = 'fake-signing-key';

const hex = (seed: string, text: string, n: number) =>
  createHmac('sha256', seed).update(text).digest('hex').slice(0, n);

export function fakeVideoProvider(opts: { seed: string; playbackBase?: string }): VideoProvider {
  if (opts.seed.length < 32) throw new Error('fake video provider: seed must be at least 32 characters');
  const signer = { alg: 'HS256' as const, kid: FAKE_KID, secret: hex(opts.seed, 'video.signing', 64) };
  const base = opts.playbackBase ?? '/api/dev/video';
  return {
    name: 'fake',
    async createLiveStream({ orgId, sessionId, idempotencyKey }) {
      const k = `${orgId}:${sessionId}:${idempotencyKey}`;
      return {
        providerStreamId: `fake_${hex(opts.seed, `stream:${k}`, 24)}`,
        playbackId: `fk${hex(opts.seed, `playback:${k}`, 30)}`,
        ingestUrl: FAKE_INGEST_URL,
      };
    },
    async streamKey(providerStreamId) {
      return `fake-sk-${hex(opts.seed, `key:${providerStreamId}`, 32)}`;
    },
    signPlayback: (c) => signJwt(signer, c),
    verifyPlayback: (token, now) => verifyJwt(signer, token, now),
    playbackUrl: (playbackId, token) =>
      `${base}/${encodeURIComponent(playbackId)}?token=${encodeURIComponent(token)}`,
  };
}

/** What the fake CDN answers for a playback request. */
export function fakePlaybackCheck(
  provider: VideoProvider,
  playbackId: string,
  token: string,
  now: Date,
): 'ok' | 'forbidden' {
  const c = provider.verifyPlayback(token, now);
  return c && c.playbackId === playbackId ? 'ok' : 'forbidden';
}
