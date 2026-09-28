import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Guest email verification (M1.5f): the pure parts. A code is six random digits, stored only as
 * an HMAC bound to its challenge id; it works once, for ten minutes, and locks after five wrong
 * tries. The sign-in email also carries a magic link (15 minutes, single use) that only works in
 * the browser that asked for it; opened anywhere else, the page asks for the code instead.
 */
export const GUEST_CODE_TTL_MS = 10 * 60_000;
export const GUEST_LINK_TTL_MS = 15 * 60_000;
export const GUEST_MAX_ATTEMPTS = 5;
/** A new code for the same address and purpose is refused this soon after the last one. */
export const GUEST_RESEND_COOLDOWN_MS = 30_000;
/** How long a verified address skips checkout verification in this browser (pending owner). */
export const GUEST_VERIFIED_MS = 30 * 60_000;
/** Attendee ("My tickets") sessions last this long, then sign in again (pending owner). */
export const GUEST_SESSION_MS = 7 * 24 * 3_600_000;

export const GUEST_PURPOSES = ['checkout', 'sign_in'] as const;
export type GuestPurpose = (typeof GUEST_PURPOSES)[number];

export const GUEST_VERIFY_STATUSES = ['ok', 'wrong', 'locked', 'expired', 'used', 'rate_limited'] as const;
export type GuestVerifyStatus = (typeof GUEST_VERIFY_STATUSES)[number];

export const normalizeGuestEmail = (email: string) => email.trim().toLowerCase();

const mac = (secret: string, label: string, value: string) =>
  createHmac('sha256', secret).update(`${label}:${value}`).digest('hex');

/** Six random digits (uniform; leading zeros kept). */
export const newGuestCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** A random secret for magic links, session cookies and browser binding (base64url, 256 bits). */
export const newGuestSecret = (): string => randomBytes(32).toString('base64url');

export const guestEmailHash = (secret: string, email: string) =>
  mac(secret, 'guest-email', normalizeGuestEmail(email));
export const guestCodeHash = (secret: string, challengeId: string, code: string) =>
  mac(secret, 'guest-code', `${challengeId}:${code}`);
export const guestSecretHash = (secret: string, label: 'link' | 'browser' | 'session', value: string) =>
  mac(secret, `guest-${label}`, value);

/** Constant-time comparison of two hex digests. */
export function sameDigest(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export interface ChallengeState {
  readonly id: string;
  readonly codeHash: string;
  readonly attempts: number;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
}

export type CodeCheck =
  | { readonly status: 'ok' }
  | { readonly status: 'wrong'; readonly attempts: number; readonly attemptsLeft: number }
  | { readonly status: 'locked' | 'expired' | 'used' };

/**
 * The outcome of one code attempt. Order matters: a used code stays used, an expired one
 * expired, a locked one locked even against the right code; only then is the code compared.
 */
export function checkGuestCode(secret: string, row: ChallengeState, code: string, now: Date): CodeCheck {
  if (row.usedAt) return { status: 'used' };
  if (row.expiresAt.getTime() <= now.getTime()) return { status: 'expired' };
  if (row.attempts >= GUEST_MAX_ATTEMPTS) return { status: 'locked' };
  if (/^\d{6}$/.test(code) && sameDigest(guestCodeHash(secret, row.id, code), row.codeHash))
    return { status: 'ok' };
  const attempts = row.attempts + 1;
  return attempts >= GUEST_MAX_ATTEMPTS
    ? { status: 'locked' }
    : { status: 'wrong', attempts, attemptsLeft: GUEST_MAX_ATTEMPTS - attempts };
}

/** When the next code may be sent, given the last one's time (null: now). */
export function resendAt(lastSentAt: Date | null, now: Date): Date | null {
  if (!lastSentAt) return null;
  const at = lastSentAt.getTime() + GUEST_RESEND_COOLDOWN_MS;
  return at > now.getTime() ? new Date(at) : null;
}

/** Magic link token: `{challengeId}~{secret}` (no dot: the path must not look like a file). */
export const guestLinkToken = (challengeId: string, secret: string) => `${challengeId}~${secret}`;

export function parseGuestLinkToken(token: string): { challengeId: string; secret: string } | null {
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})~([A-Za-z0-9_-]{43})$/.exec(
    token,
  );
  return m ? { challengeId: m[1] as string, secret: m[2] as string } : null;
}

export interface LinkState {
  readonly linkHash: string | null;
  readonly browserHash: string | null;
  readonly linkExpiresAt: Date | null;
  readonly usedAt: Date | null;
  readonly attempts: number;
}

export type LinkCheck = 'ok' | 'other_browser' | 'invalid';

/**
 * A magic link opened in a browser: `ok` only in the browser that asked for it (its state cookie
 * matches). A genuine link opened elsewhere is `other_browser` (ask for the code); anything else
 * — forged, used, expired or locked — is `invalid`.
 */
export function checkGuestLink(
  secret: string,
  row: LinkState,
  linkSecret: string,
  browserState: string | null,
  now: Date,
): LinkCheck {
  if (!sameDigest(guestSecretHash(secret, 'link', linkSecret), row.linkHash)) return 'invalid';
  if (row.usedAt || !row.linkExpiresAt || row.linkExpiresAt.getTime() <= now.getTime()) return 'invalid';
  if (row.attempts >= GUEST_MAX_ATTEMPTS) return 'invalid';
  if (browserState && sameDigest(guestSecretHash(secret, 'browser', browserState), row.browserHash))
    return 'ok';
  return 'other_browser';
}
