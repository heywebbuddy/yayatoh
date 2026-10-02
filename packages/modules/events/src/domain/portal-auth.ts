import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Portal accounts (M5.3a, P5-7): the pure parts. Speakers, exhibitor admins and staff, and sponsor
 * contacts are not org members: each portal account is one event role at one event, reached by a
 * signed invitation link and proved by email under the M1.5f guest rules — a 6-digit code (10
 * minutes, single use, 5 wrong tries lock it, 30 s between codes) and a magic link (15 minutes,
 * once, only in the browser that asked). Nothing secret is stored: codes, links, browsers and
 * session tokens are kept as HMACs under APP_TOKEN_SECRET.
 */
export const PORTAL_ROLES = ['speaker', 'exhibitor_admin', 'exhibitor_staff', 'sponsor_contact'] as const;
export type PortalRole = (typeof PORTAL_ROLES)[number];
export const isPortalRole = (r: string): r is PortalRole => (PORTAL_ROLES as readonly string[]).includes(r);

/** What a portal account acts for: a speaker, an exhibitor or a sponsor row of the event's program. */
export const PORTAL_SUBJECT_KINDS = ['speaker', 'exhibitor', 'sponsor'] as const;
export type PortalSubjectKind = (typeof PORTAL_SUBJECT_KINDS)[number];
export const SUBJECT_OF_ROLE: Readonly<Record<PortalRole, PortalSubjectKind>> = {
  speaker: 'speaker',
  exhibitor_admin: 'exhibitor',
  exhibitor_staff: 'exhibitor',
  sponsor_contact: 'sponsor',
};

export const PORTAL_CODE_TTL_MS = 10 * 60_000;
export const PORTAL_LINK_TTL_MS = 15 * 60_000;
export const PORTAL_MAX_ATTEMPTS = 5;
export const PORTAL_RESEND_COOLDOWN_MS = 30_000;
/** Portal sessions last a week (like attendee sessions), never past the account's expiry. */
export const PORTAL_SESSION_MS = 7 * 24 * 3_600_000;
/** An invitation (and the account) expires this long after the event ends (P5-7: lead export window). */
export const PORTAL_GRACE_MS = 90 * 24 * 3_600_000;

/** When an account for an event ending at `eventEndsAt` stops working. */
export const portalExpiresAt = (eventEndsAt: Date) => new Date(eventEndsAt.getTime() + PORTAL_GRACE_MS);

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const mac = (secret: string, label: string, value: string, enc: 'hex' | 'base64url' = 'hex') =>
  createHmac('sha256', secret).update(`portal-${label}:${value}`).digest(enc);

export const newPortalCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const newPortalSecret = (): string => randomBytes(32).toString('base64url');
export const normalizePortalEmail = (email: string) => email.trim().toLowerCase();

export const portalCodeHash = (secret: string, challengeId: string, code: string) =>
  mac(secret, 'code', `${challengeId}:${code}`);
export const portalSecretHash = (secret: string, label: 'link' | 'browser' | 'session', value: string) =>
  mac(secret, label, value);

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Constant-time comparison of two hex digests. */
export function samePortalDigest(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/* ------------------------------------------------------------------------ invitations ---- */

/**
 * The invitation link token: `{orgId}~{accountId}~{version}~{mac}`. The org comes from this signed
 * token (never a header); the version lets the organizer revoke a link by reissuing it, and the
 * account's own state (revoked, expired with the event) decides whether it still works.
 */
export function signPortalInvite(
  secret: string,
  i: { orgId: string; accountId: string; version: number },
): string {
  const body = `${i.orgId}~${i.accountId}~${i.version}`;
  return `${body}~${mac(secret, 'invite', body, 'base64url')}`;
}

export function verifyPortalInvite(
  secret: string,
  token: string,
): { orgId: string; accountId: string; version: number } | null {
  const m = new RegExp(`^(${UUID})~(${UUID})~([1-9][0-9]{0,5})~([A-Za-z0-9_-]{43})$`).exec(token);
  if (!m) return null;
  const body = `${m[1]}~${m[2]}~${m[3]}`;
  if (!sameText(m[4] as string, mac(secret, 'invite', body, 'base64url'))) return null;
  return { orgId: m[1] as string, accountId: m[2] as string, version: Number(m[3]) };
}

/**
 * A shareable per-event portal sign-in page (M5.4a, kept in the one sign-in flow at merge): the
 * token `{orgId}~{eventId}~{mac}` names the event (the org comes from it, never a header). It
 * grants nothing: it only lets someone ask for their own invitation link to be emailed again.
 */
export function signPortalSite(secret: string, s: { orgId: string; eventId: string }): string {
  const body = `${s.orgId}~${s.eventId}`;
  return `${body}~${mac(secret, 'site', body, 'base64url')}`;
}

export function verifyPortalSite(secret: string, token: string): { orgId: string; eventId: string } | null {
  const m = new RegExp(`^(${UUID})~(${UUID})~([A-Za-z0-9_-]{43})$`).exec(token);
  if (!m) return null;
  if (!sameText(m[3] as string, mac(secret, 'site', `${m[1]}~${m[2]}`, 'base64url'))) return null;
  return { orgId: m[1] as string, eventId: m[2] as string };
}

export interface PortalAccountState {
  readonly inviteVersion: number;
  readonly revokedAt: Date | null;
  /** The event's end + 90 days. */
  readonly expiresAt: Date;
}

export type PortalAccountCheck = 'ok' | 'revoked' | 'expired' | 'reissued';

/** Whether an account (and the invitation version presented, if any) still opens the portal. */
export function checkPortalAccount(
  row: PortalAccountState,
  now: Date,
  presentedVersion: number | null = null,
): PortalAccountCheck {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (presentedVersion !== null && presentedVersion !== row.inviteVersion) return 'reissued';
  return 'ok';
}

/* -------------------------------------------------------------------- codes and links ---- */

export interface PortalChallengeState {
  readonly id: string;
  readonly codeHash: string;
  readonly attempts: number;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
}

export type PortalCodeCheck =
  | { readonly status: 'ok' }
  | { readonly status: 'wrong'; readonly attemptsLeft: number }
  | { readonly status: 'locked' | 'expired' | 'used' };

/** One code attempt: used stays used, expired expired, locked locked (even with the right code). */
export function checkPortalCode(
  secret: string,
  row: PortalChallengeState,
  code: string,
  now: Date,
): PortalCodeCheck {
  if (row.usedAt) return { status: 'used' };
  if (row.expiresAt.getTime() <= now.getTime()) return { status: 'expired' };
  if (row.attempts >= PORTAL_MAX_ATTEMPTS) return { status: 'locked' };
  if (/^\d{6}$/.test(code) && samePortalDigest(portalCodeHash(secret, row.id, code), row.codeHash))
    return { status: 'ok' };
  const attempts = row.attempts + 1;
  return attempts >= PORTAL_MAX_ATTEMPTS
    ? { status: 'locked' }
    : { status: 'wrong', attemptsLeft: PORTAL_MAX_ATTEMPTS - attempts };
}

/** When the next code may be sent (null: now). */
export function portalResendAt(lastSentAt: Date | null, now: Date): Date | null {
  if (!lastSentAt) return null;
  const at = lastSentAt.getTime() + PORTAL_RESEND_COOLDOWN_MS;
  return at > now.getTime() ? new Date(at) : null;
}

/** Magic link token: `{orgId}~{challengeId}~{secret}`. */
export const portalLinkToken = (orgId: string, challengeId: string, secret: string) =>
  `${orgId}~${challengeId}~${secret}`;

export function parsePortalLinkToken(
  token: string,
): { orgId: string; challengeId: string; secret: string } | null {
  const m = new RegExp(`^(${UUID})~(${UUID})~([A-Za-z0-9_-]{43})$`).exec(token);
  return m ? { orgId: m[1] as string, challengeId: m[2] as string, secret: m[3] as string } : null;
}

export interface PortalLinkState {
  readonly linkHash: string | null;
  readonly browserHash: string | null;
  readonly linkExpiresAt: Date | null;
  readonly usedAt: Date | null;
  readonly attempts: number;
}

/** `ok` only in the browser that asked; a genuine link elsewhere is `other_browser`; else `invalid`. */
export function checkPortalLink(
  secret: string,
  row: PortalLinkState,
  linkSecret: string,
  browserState: string | null,
  now: Date,
): 'ok' | 'other_browser' | 'invalid' {
  if (!samePortalDigest(portalSecretHash(secret, 'link', linkSecret), row.linkHash)) return 'invalid';
  if (row.usedAt || !row.linkExpiresAt || row.linkExpiresAt.getTime() <= now.getTime()) return 'invalid';
  if (row.attempts >= PORTAL_MAX_ATTEMPTS) return 'invalid';
  if (browserState && samePortalDigest(portalSecretHash(secret, 'browser', browserState), row.browserHash))
    return 'ok';
  return 'other_browser';
}

/* ------------------------------------------------------------------------- sessions ---- */

/** The session cookie value: `{orgId}~{secret}`; the org comes from the (hashed-at-rest) session. */
export const portalSessionToken = (orgId: string, secret: string) => `${orgId}~${secret}`;

export function parsePortalSessionToken(
  token: string | null | undefined,
): { orgId: string; secret: string } | null {
  if (!token) return null;
  const m = new RegExp(`^(${UUID})~([A-Za-z0-9_-]{43})$`).exec(token);
  return m ? { orgId: m[1] as string, secret: m[2] as string } : null;
}

/** A session ends at the earlier of a week from sign-in and the account's expiry. */
export const portalSessionExpiry = (now: Date, accountExpiresAt: Date) =>
  new Date(Math.min(now.getTime() + PORTAL_SESSION_MS, accountExpiresAt.getTime()));

/** Mask an address for display on the sign-in page ("an•••@example.com"). */
export function maskPortalEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const keep = local.slice(0, Math.min(2, Math.max(1, local.length - 1)));
  return `${keep}${'•'.repeat(Math.max(1, Math.min(3, local.length - keep.length)))}@${domain}`;
}
