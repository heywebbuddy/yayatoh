import { createPrivateKey, createPublicKey } from 'node:crypto';
import { signJwt, verifyJwt } from './jwt.ts';
import { type VideoProvider, VideoUnavailableError } from './port.ts';

/**
 * Mux adapter. Playback tokens are real: RS256 JWTs under the org's Mux signing key (signed
 * locally, no network), which Mux's CDN checks against the playback id. Creating streams and
 * reading stream keys call the Mux Video API, which is a **stub** until the owner's Mux account
 * exists (owner inbox): it refuses, and the console says streaming is unavailable.
 */
export const MUX_INGEST_URL = 'rtmps://global-live.mux.com:443/app';
/**
 * M6.10a RTMP overflow: Mux's plain-RTMP ingest on port 5222 (for networks that block 443), the
 * same stream and key. UNVERIFIED against the owner's account until it exists.
 */
export const MUX_BACKUP_INGEST_URL = 'rtmp://global-live.mux.com:5222/app';

export function muxVideoProvider(opts: {
  /** `MUX_SIGNING_KEY_ID`. */
  signingKeyId: string;
  /** `MUX_SIGNING_PRIVATE_KEY`: the base64 of the PEM Mux hands out. */
  signingPrivateKey: string;
}): VideoProvider {
  const pem = Buffer.from(opts.signingPrivateKey, 'base64').toString('utf8');
  const privateKey = createPrivateKey(pem);
  const signer = {
    alg: 'RS256' as const,
    kid: opts.signingKeyId,
    privateKey,
    publicKey: createPublicKey(privateKey),
  };
  const notYet = () =>
    new VideoUnavailableError('The Mux Video API is not enabled yet (owner inbox: Mux account)');
  return {
    name: 'mux',
    kind: 'mux',
    sandbox: false,
    async createLiveStream() {
      throw notYet();
    },
    async streamKey() {
      throw notYet();
    },
    signPlayback: (c) => signJwt(signer, c),
    verifyPlayback: (token, now) => verifyJwt(signer, token, now),
    playbackUrl: (playbackId, token) =>
      `https://stream.mux.com/${encodeURIComponent(playbackId)}.m3u8?token=${encodeURIComponent(token)}`,
  };
}
