import { createPrivateKey, createPublicKey } from 'node:crypto';
import { signJwt, verifyJwt } from './jwt.ts';
import { type VideoProvider, VideoUnavailableError } from './port.ts';

/**
 * Cloudflare Stream adapter (M6.10a, decision P6-9: the second provider). Playback tokens are real:
 * RS256 JWTs under the account's Stream signing key (`kid`, `sub` = the video uid, `exp`), signed
 * locally without a network call, as Cloudflare documents for self-signed tokens. Creating live
 * inputs and reading their keys call the Stream API, which is a **stub** until the owner's
 * Cloudflare account exists (owner inbox): it refuses, and the console says the provider is
 * unavailable. Ingest addresses are UNVERIFIED against a live account.
 */
export const CLOUDFLARE_INGEST_URL = 'rtmps://live.cloudflare.com:443/live/';
/** M6.10a RTMP overflow: plain RTMP to the same live input (UNVERIFIED). */
export const CLOUDFLARE_BACKUP_INGEST_URL = 'rtmp://live.cloudflare.com:1935/live/';

export function cloudflareStreamProvider(opts: {
  /** `CLOUDFLARE_STREAM_SIGNING_KEY_ID`. */
  signingKeyId: string;
  /** `CLOUDFLARE_STREAM_SIGNING_PRIVATE_KEY`: the base64 of the PEM the Stream API hands out. */
  signingPrivateKey: string;
  /** `CLOUDFLARE_STREAM_CUSTOMER_CODE`: the `customer-<code>` playback subdomain. */
  customerCode: string;
}): VideoProvider {
  if (!/^[a-z0-9]{6,64}$/.test(opts.customerCode))
    throw new Error('cloudflare stream: the customer code must be lowercase letters and digits');
  const pem = Buffer.from(opts.signingPrivateKey, 'base64').toString('utf8');
  const privateKey = createPrivateKey(pem);
  const signer = {
    alg: 'RS256' as const,
    kid: opts.signingKeyId,
    privateKey,
    publicKey: createPublicKey(privateKey),
  };
  const notYet = () =>
    new VideoUnavailableError(
      'The Cloudflare Stream API is not enabled yet (owner inbox: Cloudflare Stream account)',
    );
  return {
    name: 'cloudflare',
    kind: 'cloudflare',
    sandbox: false,
    async createLiveStream() {
      throw notYet();
    },
    async streamKey() {
      throw notYet();
    },
    signPlayback: (c) => signJwt(signer, c),
    verifyPlayback: (token, now) => verifyJwt(signer, token, now),
    // The signed token takes the video uid's place in the URL.
    playbackUrl: (_playbackId, token) =>
      `https://customer-${opts.customerCode}.cloudflarestream.com/${encodeURIComponent(token)}/manifest/video.m3u8`,
  };
}
