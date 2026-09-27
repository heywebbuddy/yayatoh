import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Invitation tokens are `<invitationId>~<hmac>` (`~` keeps the path free of dots, which the
 * locale proxy treats as static files): HMAC-SHA256 of the id under APP_TOKEN_SECRET.
 * Nothing secret is stored, the outbox payload carries only the id, and revoking or accepting
 * the invitation row makes the token useless.
 */
function mac(invitationId: string, secret: string): string {
  return createHmac('sha256', secret).update(`invitation:${invitationId}`).digest('base64url');
}

export function signInvitation(invitationId: string, secret: string): string {
  return `${invitationId}~${mac(invitationId, secret)}`;
}

/** Returns the invitation id if the token is authentic, else null. */
export function verifyInvitationToken(token: string, secret: string): string | null {
  const dot = token.indexOf('~');
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(id, secret));
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

export function appTokenSecret(): string {
  const s = process.env.APP_TOKEN_SECRET;
  if (!s || s.length < 32) throw new Error('APP_TOKEN_SECRET (≥32 chars) is not set (see .env.example)');
  return s;
}
