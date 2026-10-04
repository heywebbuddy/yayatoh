import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed links of the live giving screen (M4.8d), like the M5.7a big-screen links: a token is
 * `{orgId}~{eventId}~{version}~{mac}` (HMAC-SHA256 under the app token secret). A projector needs
 * no sign-in; its org and event come from the signature (never a header), and replacing the link
 * (a new version) stops every earlier one. `~` keeps the path free of dots.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const mac = (secret: string, text: string) => createHmac('sha256', secret).update(text).digest('base64url');

export interface ScreenClaim {
  readonly orgId: string;
  readonly eventId: string;
  readonly version: number;
}

export function signScreenToken(claim: ScreenClaim, secret: string): string {
  const body = `${claim.orgId}~${claim.eventId}~${claim.version}`;
  return `${body}~${mac(secret, `donations.screen:${body}`)}`;
}

/** The claim of an authentic token, or null (constant-time compare). */
export function verifyScreenToken(token: string, secret: string): ScreenClaim | null {
  if (token.length > 200) return null;
  const parts = token.split('~');
  if (parts.length !== 4) return null;
  const [orgId = '', eventId = '', v = '', given = ''] = parts;
  if (!UUID.test(orgId) || !UUID.test(eventId) || !/^[1-9]\d{0,8}$/.test(v)) return null;
  const expected = Buffer.from(mac(secret, `donations.screen:${orgId}~${eventId}~${v}`));
  const g = Buffer.from(given);
  if (g.length !== expected.length || !timingSafeEqual(g, expected)) return null;
  return { orgId, eventId, version: Number(v) };
}
