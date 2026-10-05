import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed big-screen links and participant keys (M5.7a).
 *
 * A display token is `{orgId}~{sessionId}~{version}~{mac}` (HMAC-SHA256 under the app token
 * secret): the screen needs no sign-in, its org comes from the signed token (never a header), and
 * rotating the session's display version revokes every earlier link. `~` keeps the path free of
 * dots (the locale proxy treats those as files).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const mac = (secret: string, text: string) => createHmac('sha256', secret).update(text).digest('base64url');

export interface DisplayClaim {
  readonly orgId: string;
  readonly sessionId: string;
  readonly version: number;
}

export function signDisplayToken(claim: DisplayClaim, secret: string): string {
  const body = `${claim.orgId}~${claim.sessionId}~${claim.version}`;
  return `${body}~${mac(secret, `engagement.display:${body}`)}`;
}

/** The claim of an authentic token, or null (constant-time compare). */
export function verifyDisplayToken(token: string, secret: string): DisplayClaim | null {
  if (token.length > 200) return null;
  const parts = token.split('~');
  if (parts.length !== 4) return null;
  const [orgId = '', sessionId = '', v = '', given = ''] = parts;
  if (!UUID.test(orgId) || !UUID.test(sessionId) || !/^[1-9]\d{0,8}$/.test(v)) return null;
  const expected = Buffer.from(mac(secret, `engagement.display:${orgId}~${sessionId}~${v}`));
  const g = Buffer.from(given);
  if (g.length !== expected.length || !timingSafeEqual(g, expected)) return null;
  return { orgId, sessionId, version: Number(v) };
}

/**
 * A participant's key within one session: an HMAC of who they are (an account id or a device
 * cookie) and the session, so keys can't be linked across sessions and say nothing by themselves.
 */
export function participantKey(secret: string, sessionId: string, who: string): string {
  return mac(secret, `engagement.participant:${sessionId}:${who}`);
}

export const PARTICIPANT_KEY = /^[A-Za-z0-9_-]{43}$/;
