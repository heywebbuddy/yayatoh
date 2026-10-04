import { mediaStore } from '@yayatoh/media';
import { appTokenSecret } from '@yayatoh/platform';
import sharp from 'sharp';
import { GALLERY_LIMITS } from './domain/limits.ts';
import { signDirectUpload } from './domain/tokens.ts';

/* ---------------------------------------------------------------------------- HEIC decoding ---- */

/**
 * Decodes a HEIC/HEIF photo to PNG or JPEG bytes for the re-encoding pipeline (M4.5b), or null
 * when it can't. The prebuilt image library has no HEVC decoder (patents), so production needs an
 * adapter with one (a libheif build with libde265, or an image service): owner inbox.
 */
export interface HeicDecoder {
  readonly kind: string;
  decode(bytes: Uint8Array): Promise<Uint8Array | null>;
}

/** The box a test HEIC carries its picture in (the fake adapter's format; see `fakeHeic`). */
export const FAKE_HEIC_BOX = 'yyfk';

function fakePayload(b: Uint8Array): Uint8Array | null {
  let at = 0;
  while (at + 8 <= b.length) {
    const size = ((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0);
    const type = String.fromCharCode(...b.subarray(at + 4, at + 8));
    if (size < 8 || at + size > b.length) return null;
    if (type === FAKE_HEIC_BOX) return b.subarray(at + 8, at + size);
    at += size;
  }
  return null;
}

/**
 * Development and CI: the image library first (it decodes HEIC where the system's libvips has
 * HEVC), then the fake container tests use (an `ftyp heic` box followed by a `yyfk` box holding a
 * JPEG or PNG). Anything else is undecodable, and the upload is refused with `heic_unsupported`.
 */
export function devHeicDecoder(): HeicDecoder {
  return {
    kind: 'dev',
    async decode(bytes) {
      try {
        const out = await sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000 }).png().toBuffer();
        return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
      } catch {
        return fakePayload(bytes);
      }
    },
  };
}

let heic: HeicDecoder | undefined;
export function setHeicDecoder(d: HeicDecoder): void {
  heic = d;
}
export function heicDecoder(): HeicDecoder {
  heic ??= devHeicDecoder();
  return heic;
}

/* ------------------------------------------------------------------------------ upload slots ---- */

export interface UploadSlot {
  readonly url: string;
  readonly method: 'PUT';
  /** Headers the browser must send as they are (the signed ones). */
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

/**
 * Where a browser sends a photo (M4.5b): straight to storage. With R2 that is a presigned PUT for
 * exactly the declared size; the Postgres store (dev, CI) can't sign one, so the app's own route
 * `/api/gallery/direct/{token}` takes the bytes as they are and stores them unread.
 */
export function uploadSlot(orgId: string, key: string, bytes: number, now: Date): UploadSlot {
  const expiresAt = new Date(now.getTime() + GALLERY_LIMITS.uploadSlotSeconds * 1000);
  const store = mediaStore();
  if (store.presignPut) {
    const signed = store.presignPut(orgId, key, {
      bytes,
      expiresInSeconds: GALLERY_LIMITS.uploadSlotSeconds,
    });
    return { url: signed.url, method: 'PUT', headers: { ...signed.headers }, expiresAt };
  }
  const token = signDirectUpload(
    { orgId, key, bytes, exp: Math.floor(expiresAt.getTime() / 1000) },
    appTokenSecret(),
  );
  return { url: `/api/gallery/direct/${token}`, method: 'PUT', headers: {}, expiresAt };
}

/* ------------------------------------------------------------------------------- video host ---- */

/**
 * Hosted video (P4-5): links only for now. A Cloudflare Stream adapter waits behind this port
 * until the owner opens the account (owner inbox); until then `uploads` is false and the gallery
 * offers YouTube and Vimeo links only.
 */
export interface VideoHost {
  readonly kind: 'links' | 'cloudflare_stream';
  readonly uploads: boolean;
  /** A one-time direct upload URL for a video (Stream). */
  createDirectUpload(input: { orgId: string; maxSeconds: number }): Promise<{ url: string; uid: string }>;
}

export const linksOnlyVideoHost: VideoHost = {
  kind: 'links',
  uploads: false,
  async createDirectUpload() {
    throw new Error('Video uploads are not available: the gallery takes YouTube and Vimeo links');
  },
};

/** The stub: configured only with the owner's account id and token, and not wired up yet. */
export function cloudflareStreamVideoHost(cfg: { accountId: string; apiToken: string }): VideoHost {
  if (!cfg.accountId || !cfg.apiToken)
    throw new Error('Cloudflare Stream needs an account id and an API token');
  return {
    kind: 'cloudflare_stream',
    uploads: false,
    async createDirectUpload() {
      throw new Error('The Cloudflare Stream adapter is a stub until the owner opens the account (P4-5)');
    },
  };
}

export function videoHostFromEnv(env: Readonly<Record<string, string | undefined>>): VideoHost {
  if (env.VIDEO_HOST === 'cloudflare_stream')
    return cloudflareStreamVideoHost({
      accountId: env.CLOUDFLARE_STREAM_ACCOUNT_ID ?? '',
      apiToken: env.CLOUDFLARE_STREAM_API_TOKEN ?? '',
    });
  return linksOnlyVideoHost;
}
