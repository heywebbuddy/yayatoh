import { withoutTenant } from '@yayatoh/db';
import { DomainError, uuidv7 } from '@yayatoh/kernel';
import { appTokenSecret } from '@yayatoh/platform';
import type { RateLimiter, RateLimitSubject } from '@yayatoh/platform/security';
import { and, desc, eq, gt, isNull, lt, type SQL } from 'drizzle-orm';
import { guestChallenges, guestSessions } from '../schema.ts';
import {
  checkGuestCode,
  checkGuestLink,
  GUEST_CODE_TTL_MS,
  GUEST_LINK_TTL_MS,
  GUEST_MAX_ATTEMPTS,
  GUEST_SESSION_MS,
  type GuestPurpose,
  type GuestVerifyStatus,
  guestCodeHash,
  guestEmailHash,
  guestLinkToken,
  guestSecretHash,
  newGuestCode,
  newGuestSecret,
  normalizeGuestEmail,
  parseGuestLinkToken,
  resendAt,
} from './otp.ts';

/**
 * Guest email verification and attendee sessions (M1.5f). The rows are global (a guest proving
 * an address is nobody's tenant data yet, and marketplace sign-in spans orgs) and hold HMACs of
 * codes, links, browsers and session tokens, never the secrets. Per-device and per-address limits
 * go through the M1.14 limiter; each code also locks after five wrong tries.
 */
export interface GuestLimits {
  readonly limiter: RateLimiter;
  /** The request's device cookie (`yy_did`) and client IP. */
  readonly subject: Pick<RateLimitSubject, 'device' | 'ip'>;
}

const DAY = 24 * 3_600_000;
const scopeIs = (
  col: typeof guestChallenges.scopeOrgId | typeof guestSessions.scopeOrgId,
  org: string | null,
) => (org ? eq(col, org) : isNull(col));

export type GuestChallengeResult =
  | {
      readonly status: 'sent';
      readonly challengeId: string;
      /** For the caller to email right away; never stored. */
      readonly code: string;
      /** Sign-in only: the magic link token (`{challengeId}.{secret}`), bound to `browserState`. */
      readonly linkToken: string | null;
      readonly resendAt: Date;
    }
  | { readonly status: 'cooldown'; readonly challengeId: string; readonly resendAt: Date }
  | { readonly status: 'rate_limited'; readonly retryAfterMs: number };

/**
 * Make a new code for an address (and, with `browserState`, a magic link that only that browser
 * can use). Asking again within the cooldown sends nothing and points at the live code; past the
 * device or address budget the answer is `rate_limited`. A new code retires the address's older
 * ones for the same purpose and site, so only one code is ever guessable.
 */
export async function requestGuestChallenge(
  input: {
    readonly purpose: GuestPurpose;
    readonly scopeOrgId: string | null;
    readonly email: string;
    readonly browserState?: string | null;
  },
  limits: GuestLimits,
  now = new Date(),
): Promise<GuestChallengeResult> {
  const secret = appTokenSecret();
  const email = normalizeGuestEmail(input.email);
  if (!email || email.length > 254 || !email.includes('@'))
    throw new DomainError('validation_failed', 'Enter a valid email address', { reason: 'email' });
  const emailHash = guestEmailHash(secret, email);
  const same = and(
    eq(guestChallenges.emailHash, emailHash),
    eq(guestChallenges.purpose, input.purpose),
    scopeIs(guestChallenges.scopeOrgId, input.scopeOrgId),
  ) as SQL;
  const [last] = await withoutTenant((tx) =>
    tx
      .select({
        id: guestChallenges.id,
        createdAt: guestChallenges.createdAt,
        usedAt: guestChallenges.usedAt,
      })
      .from(guestChallenges)
      .where(same)
      .orderBy(desc(guestChallenges.createdAt))
      .limit(1),
  );
  const wait = last && !last.usedAt ? resendAt(last.createdAt, now) : null;
  if (last && wait) return { status: 'cooldown', challengeId: last.id, resendAt: wait };
  const decision = await limits.limiter.check(
    'guestCode',
    { ...limits.subject, identity: email },
    { now: now.getTime(), scope: input.purpose },
  );
  if (!decision.allowed) return { status: 'rate_limited', retryAfterMs: decision.retryAfterMs };

  const id = uuidv7();
  const code = newGuestCode();
  const linkSecret = input.browserState ? newGuestSecret() : null;
  await withoutTenant(async (tx) => {
    // Old rows go a day after they expire; older live codes for this address retire now.
    await tx.delete(guestChallenges).where(lt(guestChallenges.expiresAt, new Date(now.getTime() - DAY)));
    await tx
      .update(guestChallenges)
      .set({ expiresAt: now, linkExpiresAt: null, linkHash: null, browserHash: null })
      .where(and(same, isNull(guestChallenges.usedAt), gt(guestChallenges.expiresAt, now)));
    await tx.insert(guestChallenges).values({
      id,
      purpose: input.purpose,
      scopeOrgId: input.scopeOrgId,
      emailHash,
      email,
      codeHash: guestCodeHash(secret, id, code),
      expiresAt: new Date(now.getTime() + GUEST_CODE_TTL_MS),
      linkHash: linkSecret ? guestSecretHash(secret, 'link', linkSecret) : null,
      browserHash: input.browserState ? guestSecretHash(secret, 'browser', input.browserState) : null,
      linkExpiresAt: linkSecret ? new Date(now.getTime() + GUEST_LINK_TTL_MS) : null,
      createdAt: now,
    });
  });
  return {
    status: 'sent',
    challengeId: id,
    code,
    linkToken: linkSecret ? guestLinkToken(id, linkSecret) : null,
    resendAt: resendAt(now, now) ?? now,
  };
}

export type GuestVerifyResult = {
  readonly status: GuestVerifyStatus;
  readonly attemptsLeft: number | null;
  /** On `ok`: the verified address. */
  readonly email: string | null;
  readonly retryAfterMs?: number;
};

const gone: GuestVerifyResult = { status: 'expired', attemptsLeft: null, email: null };

/**
 * Check a code. A code only verifies the purpose, site and (when given) address it was made for;
 * anything else looks expired. Wrong codes count (the fifth locks it, even against the right
 * code); a right one is spent. Outcomes are returned, never thrown, so the count commits.
 */
export async function verifyGuestChallenge(
  input: {
    readonly challengeId: string;
    readonly code: string;
    readonly purpose: GuestPurpose;
    readonly scopeOrgId: string | null;
    /** Checkout: the address in the form must be the one the code was sent to. */
    readonly email?: string | null;
  },
  limits: GuestLimits,
  now = new Date(),
): Promise<GuestVerifyResult> {
  if (!/^[0-9a-f-]{36}$/.test(input.challengeId)) return gone;
  const secret = appTokenSecret();
  const match = and(
    eq(guestChallenges.id, input.challengeId),
    eq(guestChallenges.purpose, input.purpose),
    scopeIs(guestChallenges.scopeOrgId, input.scopeOrgId),
  ) as SQL;
  const [peek] = await withoutTenant((tx) =>
    tx.select({ email: guestChallenges.email }).from(guestChallenges).where(match),
  );
  if (!peek) return gone;
  if (input.email != null && normalizeGuestEmail(input.email) !== peek.email) return gone;
  const decision = await limits.limiter.check(
    'guestVerify',
    { ...limits.subject, identity: peek.email },
    { now: now.getTime(), scope: input.purpose },
  );
  if (!decision.allowed)
    return { status: 'rate_limited', attemptsLeft: null, email: null, retryAfterMs: decision.retryAfterMs };
  return withoutTenant(async (tx) => {
    const [row] = await tx.select().from(guestChallenges).where(match).for('update');
    if (!row) return gone;
    const r = checkGuestCode(secret, row, input.code.trim(), now);
    if (r.status === 'ok') {
      await tx.update(guestChallenges).set({ usedAt: now }).where(eq(guestChallenges.id, row.id));
      return { status: 'ok', attemptsLeft: null, email: row.email };
    }
    if (r.status === 'wrong' || (r.status === 'locked' && row.attempts < GUEST_MAX_ATTEMPTS)) {
      await tx
        .update(guestChallenges)
        .set({ attempts: row.attempts + 1 })
        .where(eq(guestChallenges.id, row.id));
    }
    return {
      status: r.status,
      attemptsLeft: r.status === 'wrong' ? r.attemptsLeft : r.status === 'locked' ? 0 : null,
      email: null,
    };
  });
}

export type GuestLinkResult =
  | { readonly status: 'ok'; readonly email: string; readonly challengeId: string }
  | { readonly status: 'other_browser'; readonly challengeId: string }
  | { readonly status: 'invalid' };

/**
 * Open a sign-in magic link. In the browser that asked for it the link is spent and the address
 * verified; anywhere else (a forwarded link, another device) nothing is spent and the caller asks
 * for the emailed code instead, so a forwarded link alone can't take over the account.
 */
export async function consumeGuestLink(
  input: {
    readonly token: string;
    readonly browserState: string | null;
    readonly scopeOrgId: string | null;
    /** false: only say what opening it would do (the page before its Continue button). */
    readonly spend?: boolean;
  },
  now = new Date(),
): Promise<GuestLinkResult> {
  const parsed = parseGuestLinkToken(input.token);
  if (!parsed) return { status: 'invalid' };
  const secret = appTokenSecret();
  return withoutTenant(async (tx) => {
    const [row] = await tx
      .select()
      .from(guestChallenges)
      .where(
        and(
          eq(guestChallenges.id, parsed.challengeId),
          eq(guestChallenges.purpose, 'sign_in'),
          scopeIs(guestChallenges.scopeOrgId, input.scopeOrgId),
        ),
      )
      .for('update');
    if (!row) return { status: 'invalid' as const };
    const r = checkGuestLink(secret, row, parsed.secret, input.browserState, now);
    if (r === 'invalid') return { status: 'invalid' as const };
    if (r === 'other_browser') return { status: 'other_browser' as const, challengeId: row.id };
    if (input.spend === false) return { status: 'ok' as const, email: row.email, challengeId: row.id };
    await tx.update(guestChallenges).set({ usedAt: now }).where(eq(guestChallenges.id, row.id));
    return { status: 'ok' as const, email: row.email, challengeId: row.id };
  });
}

// ─── Attendee sessions ──────────────────────────────────────────────────────────────────────

export interface GuestSession {
  readonly id: string;
  readonly email: string;
  readonly scopeOrgId: string | null;
  readonly expiresAt: Date;
}

const sessionTokenOk = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);

/** Open an attendee session for a verified address on this host; returns the cookie token. */
export async function createGuestSession(
  input: { readonly email: string; readonly scopeOrgId: string | null; readonly host: string },
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const secret = appTokenSecret();
  const email = normalizeGuestEmail(input.email);
  const token = newGuestSecret();
  const expiresAt = new Date(now.getTime() + GUEST_SESSION_MS);
  await withoutTenant(async (tx) => {
    await tx.delete(guestSessions).where(lt(guestSessions.expiresAt, new Date(now.getTime() - DAY)));
    await tx.insert(guestSessions).values({
      tokenHash: guestSecretHash(secret, 'session', token),
      scopeOrgId: input.scopeOrgId,
      host: input.host.toLowerCase(),
      emailHash: guestEmailHash(secret, email),
      email,
      expiresAt,
      createdAt: now,
    });
  });
  return { token, expiresAt };
}

/** The live session behind a cookie token, only on the host and site that issued it. */
export async function guestSessionByToken(
  token: string | null | undefined,
  where: { readonly scopeOrgId: string | null; readonly host: string },
  now = new Date(),
): Promise<GuestSession | null> {
  if (!token || !sessionTokenOk(token)) return null;
  const [row] = await withoutTenant((tx) =>
    tx
      .select()
      .from(guestSessions)
      .where(
        and(
          eq(guestSessions.tokenHash, guestSecretHash(appTokenSecret(), 'session', token)),
          eq(guestSessions.host, where.host.toLowerCase()),
          scopeIs(guestSessions.scopeOrgId, where.scopeOrgId),
          isNull(guestSessions.revokedAt),
          gt(guestSessions.expiresAt, now),
        ),
      ),
  );
  return row ? { id: row.id, email: row.email, scopeOrgId: row.scopeOrgId, expiresAt: row.expiresAt } : null;
}

/** Sign out this browser. */
export async function endGuestSession(token: string | null | undefined, now = new Date()): Promise<void> {
  if (!token || !sessionTokenOk(token)) return;
  await withoutTenant((tx) =>
    tx
      .update(guestSessions)
      .set({ revokedAt: now })
      .where(eq(guestSessions.tokenHash, guestSecretHash(appTokenSecret(), 'session', token))),
  );
}

/** Sign out everywhere: revoke every live session of this address for this site. */
export async function revokeGuestSessions(
  email: string,
  scopeOrgId: string | null,
  now = new Date(),
): Promise<number> {
  const rows = await withoutTenant((tx) =>
    tx
      .update(guestSessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(guestSessions.emailHash, guestEmailHash(appTokenSecret(), email)),
          scopeIs(guestSessions.scopeOrgId, scopeOrgId),
          isNull(guestSessions.revokedAt),
        ),
      )
      .returning({ id: guestSessions.id }),
  );
  return rows.length;
}

/**
 * Development and e2e only: expire an address's live codes and links now, so browser tests can
 * see the expired-code message without waiting ten minutes. Refused outside dev personas.
 */
export async function devExpireGuestChallenges(email: string): Promise<number> {
  if (process.env.YAYATOH_DEV_AUTH !== '1' || process.env.VERCEL_ENV === 'production')
    throw new DomainError('forbidden', 'Development only');
  const now = new Date();
  const rows = await withoutTenant((tx) =>
    tx
      .update(guestChallenges)
      .set({
        expiresAt: new Date(now.getTime() - 1000),
        linkExpiresAt: null,
        linkHash: null,
        browserHash: null,
      })
      .where(
        and(
          eq(guestChallenges.emailHash, guestEmailHash(appTokenSecret(), email)),
          isNull(guestChallenges.usedAt),
          gt(guestChallenges.expiresAt, now),
        ),
      )
      .returning({ id: guestChallenges.id }),
  );
  return rows.length;
}
