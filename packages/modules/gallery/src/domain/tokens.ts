import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The gallery's signed strings (M4.5b), all HMAC-SHA256 under the app secret with a purpose
 * prefix, compared in constant time:
 *
 * - **uploader** (`{uploaderId}.{mac}`): a guest's cookie for one event's gallery, so their quota
 *   and "your photos" follow them. Bound to the event; it never grants access by itself (the
 *   guest-site password still does).
 * - **file** (`?e={day}&s={mac}`): a photo file URL for a viewer the gallery already authorized
 *   (a host, or a guest past the password). Valid until the end of the next UTC day, so URLs stay
 *   stable (and cacheable) for a day and stop working soon after a photo is removed or the
 *   password changes.
 * - **direct upload** (`{payload}.{mac}`): the dev/CI stand-in for a presigned PUT, naming the
 *   org, the staging key, the exact size and the expiry.
 */
const mac = (purpose: string, payload: string, secret: string) =>
  createHmac('sha256', secret).update(`${purpose}:${payload}`).digest('base64url');

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function signUploader(eventId: string, uploaderId: string, secret: string): string {
  return `${uploaderId}.${mac('gallery.uploader/1', `${eventId}:${uploaderId}`, secret)}`;
}

/** The uploader id of a valid token for this event, else null. */
export function verifyUploader(
  token: string | null | undefined,
  eventId: string,
  secret: string,
): string | null {
  if (!token || token.length > 120) return null;
  const dot = token.indexOf('.');
  const id = token.slice(0, dot);
  if (dot <= 0 || !UUID.test(id)) return null;
  return same(token.slice(dot + 1), mac('gallery.uploader/1', `${eventId}:${id}`, secret)) ? id : null;
}

const DAY_MS = 86_400_000;

/** The `e` (expiry day number) and `s` (signature) of a photo file URL. */
export function signFile(
  orgId: string,
  itemId: string,
  fileName: string,
  now: Date,
  secret: string,
): { e: number; s: string } {
  const e = Math.floor(now.getTime() / DAY_MS) + 2;
  return { e, s: mac('gallery.file/1', `${orgId}/${itemId}/${fileName}:${e}`, secret) };
}

export function verifyFile(
  orgId: string,
  itemId: string,
  fileName: string,
  e: string | null,
  s: string | null,
  now: Date,
  secret: string,
): boolean {
  if (!e || !s || !/^\d{1,8}$/.test(e) || s.length > 64) return false;
  if (Number(e) * DAY_MS <= now.getTime()) return false;
  return same(s, mac('gallery.file/1', `${orgId}/${itemId}/${fileName}:${e}`, secret));
}

export interface DirectUpload {
  readonly orgId: string;
  readonly key: string;
  readonly bytes: number;
  /** Unix seconds. */
  readonly exp: number;
}

export function signDirectUpload(d: DirectUpload, secret: string): string {
  const payload = Buffer.from(JSON.stringify(d)).toString('base64url');
  return `${payload}.${mac('gallery.direct-upload/1', payload, secret)}`;
}

export function verifyDirectUpload(token: string, now: Date, secret: string): DirectUpload | null {
  const dot = token.indexOf('.');
  if (dot <= 0 || token.length > 1000) return null;
  const payload = token.slice(0, dot);
  if (!same(token.slice(dot + 1), mac('gallery.direct-upload/1', payload, secret))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as DirectUpload;
    if (
      typeof d.orgId !== 'string' ||
      typeof d.key !== 'string' ||
      !Number.isSafeInteger(d.bytes) ||
      d.bytes <= 0 ||
      !Number.isSafeInteger(d.exp) ||
      d.exp * 1000 < now.getTime()
    )
      return null;
    return { orgId: d.orgId, key: d.key, bytes: d.bytes, exp: d.exp };
  } catch {
    return null;
  }
}
