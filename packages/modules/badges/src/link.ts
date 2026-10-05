import { createHmac, timingSafeEqual } from 'node:crypto';
import { appTokenSecret } from '@yayatoh/platform';

/** How long a download link works. Short: the link is the credential. */
export const LINK_TTL_MS = 15 * 60_000;
const PURPOSE = 'badges.batch-file';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const mac = (body: string, secret: string) =>
  createHmac('sha256', secret).update(`${PURPOSE}:${body}`).digest('base64url');

/**
 * A signed, expiring link to a finished batch PDF: `{org}~{batch}~{expiry (s, base 36)}~{hmac}`.
 * The org travels in the token (MAC-protected), so the download runs under that org's RLS
 * without a session; nothing is stored, and the batch's own state (done, not expired) still
 * decides whether the file is served.
 */
export function signBatchLink(
  orgId: string,
  batchId: string,
  now: Date,
  secret = appTokenSecret(),
): { token: string; expiresAt: Date } {
  const expiresAt = new Date(now.getTime() + LINK_TTL_MS);
  const body = `${orgId}~${batchId}~${Math.floor(expiresAt.getTime() / 1000).toString(36)}`;
  return { token: `${body}~${mac(body, secret)}`, expiresAt };
}

/** The org and batch of an authentic, unexpired link, else null (constant-time compare). */
export function verifyBatchLink(
  token: string,
  now: Date,
  secret = appTokenSecret(),
): { orgId: string; batchId: string } | null {
  const parts = token.split('~');
  if (parts.length !== 4) return null;
  const [orgId = '', batchId = '', exp = '', sig = ''] = parts;
  if (!UUID.test(orgId) || !UUID.test(batchId) || !/^[0-9a-z]{1,10}$/.test(exp)) return null;
  const given = Buffer.from(sig);
  const expected = Buffer.from(mac(`${orgId}~${batchId}~${exp}`, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (Number.parseInt(exp, 36) * 1000 <= now.getTime()) return null;
  return { orgId, batchId };
}
