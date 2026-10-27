import { createHash, randomUUID } from 'node:crypto';
import { sniff } from './pipeline/sniff.ts';
import { mediaStore } from './storage/config.ts';

/**
 * Uploaded videos (hero backgrounds, "Video" sections). They are not images: no variants, no
 * quota rows. A video and its poster are two objects under one `{org}/{video}/` prefix in the media
 * store, named by content hash, served by the app's own `/video/…` route (same origin, so
 * `media-src 'self'` covers them) with range requests.
 */
export const VIDEO_MAX_BYTES_DEFAULT = 200 * 1024 * 1024;
export const POSTER_MAX_BYTES = 5 * 1024 * 1024;

/** The largest accepted video: `MEDIA_VIDEO_MAX_BYTES` (1 MB to 1 GB), else 200 MB. */
export function videoMaxBytes(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const n = Number(env.MEDIA_VIDEO_MAX_BYTES);
  return Number.isFinite(n) && n >= 1024 * 1024 && n <= 1024 * 1024 * 1024 ? n : VIDEO_MAX_BYTES_DEFAULT;
}

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** `mp4` (ISO-BMFF with a video brand) or `webm` (EBML with the `webm` doctype); else null. */
export function sniffVideo(b: Uint8Array): 'mp4' | 'webm' | null {
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12);
    if (['avif', 'avis', 'heic', 'heix', 'mif1', 'msf1', 'M4A ', 'crx '].includes(brand)) return null;
    return 'mp4';
  }
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    const n = Math.min(b.length, 64);
    return ascii(b, 0, n).includes('webm') ? 'webm' : null;
  }
  return null;
}

export type VideoUploadError = 'unsupported' | 'too_large' | 'poster_required' | 'bad_poster';

export interface StoredVideo {
  /** `/video/{org}/{id}/v-{hash}.mp4`: what the page and the design store. */
  readonly videoPath: string;
  readonly posterPath: string;
  readonly bytes: number;
}

const POSTER_EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' } as const;
const POSTER_TYPE = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;
const VIDEO_TYPE = { mp4: 'video/mp4', webm: 'video/webm' } as const;
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex').slice(0, 32);

/**
 * Store an uploaded video and its poster. The poster is the organizer's image (JPEG, PNG or WebP,
 * checked by its bytes) or, when the server has a way to take a frame, `framePoster(video)`.
 */
export async function storeVideo(
  orgId: string,
  input: {
    readonly video: Uint8Array;
    readonly poster: Uint8Array | null;
    readonly framePoster?: (video: Uint8Array) => Promise<Uint8Array | null>;
    readonly maxBytes?: number;
  },
): Promise<{ ok: true; value: StoredVideo } | { ok: false; error: VideoUploadError }> {
  const kind = sniffVideo(input.video);
  if (!kind) return { ok: false, error: 'unsupported' };
  if (input.video.byteLength > (input.maxBytes ?? videoMaxBytes())) return { ok: false, error: 'too_large' };
  let poster = input.poster && input.poster.byteLength > 0 ? input.poster : null;
  if (!poster && input.framePoster) poster = await input.framePoster(input.video);
  if (!poster) return { ok: false, error: 'poster_required' };
  const type = sniff(poster);
  if (poster.byteLength > POSTER_MAX_BYTES || (type !== 'jpeg' && type !== 'png' && type !== 'webp'))
    return { ok: false, error: 'bad_poster' };
  const id = randomUUID();
  const ext = POSTER_EXT[type];
  const videoName = `v-${hash(input.video)}.${kind}`;
  const posterName = `p-${hash(poster)}.${ext}`;
  const store = mediaStore();
  await store.put(orgId, `${orgId}/${id}/${videoName}`, input.video, VIDEO_TYPE[kind]);
  await store.put(orgId, `${orgId}/${id}/${posterName}`, poster, POSTER_TYPE[ext]);
  return {
    ok: true,
    value: {
      videoPath: `/video/${orgId}/${id}/${videoName}`,
      posterPath: `/video/${orgId}/${id}/${posterName}`,
      bytes: input.video.byteLength,
    },
  };
}

const FILE = /^(v-[0-9a-f]{32}\.(mp4|webm)|p-[0-9a-f]{32}\.(jpg|png|webp))$/;

/** The bytes and content type of a stored video or poster, or null. */
export async function readVideoObject(
  orgId: string,
  id: string,
  file: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!FILE.test(file)) return null;
  const bytes = await mediaStore().get(orgId, `${orgId}/${id}/${file}`);
  if (!bytes) return null;
  const ext = file.slice(file.lastIndexOf('.') + 1) as keyof typeof VIDEO_TYPE & keyof typeof POSTER_TYPE;
  return { bytes, contentType: file.startsWith('v-') ? VIDEO_TYPE[ext] : POSTER_TYPE[ext] };
}
