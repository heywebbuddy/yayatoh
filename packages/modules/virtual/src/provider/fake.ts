import { createHmac } from 'node:crypto';
import { signJwt, verifyJwt } from './jwt.ts';
import type { VideoProvider, VideoProviderKind } from './port.ts';

/**
 * The fake video provider (dev, CI and previews): no account and no network. Ids are derived
 * from the seed and the idempotency key, so a retried create (in any process) gets the same stream
 * back, like Mux with an idempotency key. Tokens are HS256 JWTs under the seed. Its "CDN" is
 * `fakePlaybackCheck`, which the web's dev route answers with: the stream plays only with an
 * authentic, unexpired token for that very playback id.
 */
export const FAKE_INGEST_URL = 'rtmps://live.fake-video.test:443/app';
export const FAKE_KID = 'fake-signing-key';
/** M6.10a: the fake Cloudflare Stream's ingest and key id. */
export const FAKE_CLOUDFLARE_INGEST_URL = 'rtmps://live.fake-stream.test:443/live/';
export const FAKE_CLOUDFLARE_KID = 'fake-cloudflare-signing-key';
/** M6.10a RTMP overflow: each fake's backup ingest (plain RTMP on another host and port). */
export const FAKE_BACKUP_INGEST_URL = 'rtmp://backup.fake-video.test:5222/app';
export const FAKE_CLOUDFLARE_BACKUP_INGEST_URL = 'rtmp://backup.fake-stream.test:1935/live/';

const hex = (seed: string, text: string, n: number) =>
  createHmac('sha256', seed).update(text).digest('hex').slice(0, n);

export function fakeVideoProvider(opts: {
  seed: string;
  playbackBase?: string;
  /** M6.10a: which service it stands in for (Mux by default, as in M6.9a). */
  kind?: VideoProviderKind;
}): VideoProvider {
  if (opts.seed.length < 32) throw new Error('fake video provider: seed must be at least 32 characters');
  const cf = opts.kind === 'cloudflare';
  // Each fake signs with its own key, so one never accepts the other's tokens (like two vendors).
  const signer = {
    alg: 'HS256' as const,
    kid: cf ? FAKE_CLOUDFLARE_KID : FAKE_KID,
    secret: hex(opts.seed, cf ? 'video.signing.cloudflare' : 'video.signing', 64),
  };
  const base = opts.playbackBase ?? '/api/dev/video';
  const tag = cf ? 'cf' : '';
  return {
    name: cf ? 'fake_cloudflare' : 'fake',
    kind: cf ? 'cloudflare' : 'mux',
    sandbox: true,
    async createLiveStream({ orgId, sessionId, idempotencyKey }) {
      const k = `${tag}${orgId}:${sessionId}:${idempotencyKey}`;
      return {
        providerStreamId: `${cf ? 'fakecf' : 'fake'}_${hex(opts.seed, `stream:${k}`, 24)}`,
        playbackId: `${cf ? 'fc' : 'fk'}${hex(opts.seed, `playback:${k}`, 30)}`,
        ingestUrl: cf ? FAKE_CLOUDFLARE_INGEST_URL : FAKE_INGEST_URL,
        backupIngestUrl: cf ? FAKE_CLOUDFLARE_BACKUP_INGEST_URL : FAKE_BACKUP_INGEST_URL,
      };
    },
    async streamKey(providerStreamId) {
      return `${cf ? 'fake-cf-sk' : 'fake-sk'}-${hex(opts.seed, `key:${providerStreamId}`, 32)}`;
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
