import { createHmac, timingSafeEqual } from 'node:crypto';
import { appTokenSecret } from '@yayatoh/platform';
import { z } from 'zod';

/**
 * A signed upload ticket (M1.4e). The console page issues one per uploader to people allowed to
 * upload; it names the org, the target (owner and slot, optionally the image being replaced),
 * the user and an expiry. The upload endpoint accepts a body only with a valid ticket for the
 * signed-in user, and the command still authorizes the upload itself (a ticket never grants
 * a permission). Shaped like a presigned URL, so direct-to-R2 uploads can take its place later.
 */
export const UploadTicket = z.object({
  orgId: z.uuid(),
  ownerType: z.enum(['event', 'venue', 'org']),
  ownerId: z.uuid(),
  slot: z.enum(['cover', 'gallery', 'photo', 'logo', 'floorplan']),
  userId: z.string().min(1).max(100),
  /** Unix seconds. */
  expiresAt: z.number().int(),
});
export type UploadTicket = z.infer<typeof UploadTicket>;

export const UPLOAD_TICKET_TTL_SECONDS = 60 * 60;
const PURPOSE = 'media-upload/1';

const mac = (payload: string, secret: string) =>
  createHmac('sha256', secret).update(`${PURPOSE}:${payload}`).digest('base64url');

export function signUploadTicket(
  t: Omit<UploadTicket, 'expiresAt'>,
  now: Date = new Date(),
  secret = appTokenSecret(),
): string {
  const payload = Buffer.from(
    JSON.stringify({ ...t, expiresAt: Math.floor(now.getTime() / 1000) + UPLOAD_TICKET_TTL_SECONDS }),
  ).toString('base64url');
  return `${payload}.${mac(payload, secret)}`;
}

/** The ticket if authentic and unexpired, else null (constant-time compare). */
export function verifyUploadTicket(
  token: string,
  now: Date = new Date(),
  secret = appTokenSecret(),
): UploadTicket | null {
  const dot = token.indexOf('.');
  if (dot <= 0 || token.length > 2000) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(payload, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const t = UploadTicket.safeParse(parsed);
  if (!t.success || t.data.expiresAt * 1000 < now.getTime()) return null;
  return t.data;
}
