import { type TenantTx, withTenant } from '@yayatoh/db';
import { createCtx, DomainError } from '@yayatoh/kernel';
import { appTokenSecret } from '@yayatoh/platform';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import {
  checkPortalAccount,
  newPortalSecret,
  portalExpiresAt,
  portalSecretHash,
  portalSessionExpiry,
} from './domain/portal-auth.ts';
import type { PortalPrincipal } from './portal.ts';
import { eventRoleAssignments, events } from './schema.ts';
import { portalAccounts, portalSessions } from './schema-portal.ts';

/**
 * M7.2e: the exhibitor portal session as bearer tokens, for the Staff app (P7-6: reps sign in by
 * email code, P5-7, then use their lead licence). The code is checked by `verifyPortalChallenge`
 * exactly as in the browser; this module only changes what a verified account gets: not a cookie
 * but an access token (`yyp_{org}~{secret}`, 15 minutes) and a rotating refresh token
 * (`yyr_{org}~{secret}`) in the shape of M1.2f's user tokens. Each refresh spends the refresh token
 * and returns a new pair; a spent one presented again ends the session. The session ends at the
 * earlier of a week from sign-in and the account's expiry (the event + 90 days); revoking the
 * account, or the event-role assignment, ends it at once because every request re-reads both.
 */
export const PORTAL_ACCESS_TTL_MS = 15 * 60_000;
export const PORTAL_BEARER_HOST = 'bearer';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ACCESS = new RegExp(`^yyp_(${UUID})~([A-Za-z0-9_-]{43})$`);
const REFRESH = new RegExp(`^yyr_(${UUID})~([A-Za-z0-9_-]{43})$`);

export const isPortalAccessToken = (token: string) => ACCESS.test(token);

const DAY = 24 * 3_600_000;
const systemCtx = (orgId: string) =>
  createCtx({ orgId, actor: { type: 'system', name: 'events.portal-bearer' } });
const hash = (label: 'session' | 'link' | 'browser', secret: string) =>
  portalSecretHash(appTokenSecret(), label, secret);

export interface PortalBearerTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
  readonly refreshExpiresAt: Date;
}

async function liveAccountTx(tx: TenantTx, accountId: string, now: Date) {
  const [r] = await tx
    .select({
      account: portalAccounts,
      eventEndsAt: events.endsAt,
      assignmentRole: eventRoleAssignments.role,
      assignmentExpiresAt: eventRoleAssignments.expiresAt,
    })
    .from(portalAccounts)
    .innerJoin(events, eq(events.id, portalAccounts.eventId))
    .innerJoin(eventRoleAssignments, eq(eventRoleAssignments.id, portalAccounts.assignmentId))
    .where(eq(portalAccounts.id, accountId));
  if (!r) return null;
  const check = checkPortalAccount(
    {
      inviteVersion: r.account.inviteVersion,
      revokedAt: r.account.revokedAt,
      expiresAt: portalExpiresAt(r.eventEndsAt),
    },
    now,
  );
  if (check !== 'ok') return null;
  if (r.assignmentRole !== r.account.role) return null;
  if (r.assignmentExpiresAt && r.assignmentExpiresAt.getTime() <= now.getTime()) return null;
  return r;
}

function mint(orgId: string, now: Date, sessionEnd: Date) {
  const access = newPortalSecret();
  const refresh = newPortalSecret();
  const expiresAt = new Date(Math.min(now.getTime() + PORTAL_ACCESS_TTL_MS, sessionEnd.getTime()));
  return {
    access,
    refresh,
    expiresAt,
    tokens: {
      accessToken: `yyp_${orgId}~${access}`,
      refreshToken: `yyr_${orgId}~${refresh}`,
      expiresAt,
      refreshExpiresAt: sessionEnd,
    } satisfies PortalBearerTokens,
  };
}

/**
 * Open a bearer session for an account whose email code was just verified. The caller (the `/v1`
 * route) has the verified `orgId` and `accountId` from `verifyPortalChallenge`.
 */
export async function createPortalBearerSession(
  input: { readonly orgId: string; readonly accountId: string },
  now = new Date(),
): Promise<PortalBearerTokens> {
  return withTenant(systemCtx(input.orgId), async (tx) => {
    const r = await liveAccountTx(tx, input.accountId, now);
    if (!r) throw new DomainError('forbidden');
    const end = portalSessionExpiry(now, portalExpiresAt(r.eventEndsAt));
    const t = mint(input.orgId, now, end);
    // Housekeeping: sessions long over (a bearer session lasts until its refresh window ends).
    await tx
      .delete(portalSessions)
      .where(
        or(
          and(eq(portalSessions.kind, 'cookie'), lt(portalSessions.expiresAt, new Date(now.getTime() - DAY))),
          and(
            eq(portalSessions.kind, 'bearer'),
            lt(portalSessions.refreshExpiresAt, new Date(now.getTime() - DAY)),
          ),
        ),
      );
    await tx.insert(portalSessions).values({
      orgId: input.orgId,
      accountId: input.accountId,
      tokenHash: hash('session', t.access),
      host: PORTAL_BEARER_HOST,
      expiresAt: t.expiresAt,
      kind: 'bearer',
      refreshHash: hash('session', t.refresh),
      refreshExpiresAt: end,
      // The sign-in time is the session's step-up moment, as for a browser session.
      createdAt: now,
    });
    await tx
      .update(portalAccounts)
      .set({ lastSignInAt: now, updatedAt: now })
      .where(eq(portalAccounts.id, input.accountId));
    return t.tokens;
  });
}

export type PortalRefreshResult =
  | { readonly ok: true; readonly tokens: PortalBearerTokens }
  | { readonly ok: false; readonly reason: 'invalid' | 'expired' | 'reused' };

/**
 * Spend a refresh token for a new pair. The previous access token ends with it. A refresh token
 * that was already spent ends the whole session (`reused`); an unknown or malformed one, or one
 * of a revoked account, is `invalid`; one past the session's end is `expired`.
 */
export async function refreshPortalBearerSession(
  refreshToken: string,
  now = new Date(),
): Promise<PortalRefreshResult> {
  const m = REFRESH.exec(refreshToken);
  if (!m) return { ok: false, reason: 'invalid' };
  const orgId = m[1] as string;
  const presented = hash('session', m[2] as string);
  // Outcomes are returned, never thrown, so a reuse's revocation commits.
  return withTenant(systemCtx(orgId), async (tx): Promise<PortalRefreshResult> => {
    const [row] = await tx
      .select()
      .from(portalSessions)
      .where(
        and(
          eq(portalSessions.kind, 'bearer'),
          or(eq(portalSessions.refreshHash, presented), eq(portalSessions.previousRefreshHash, presented)),
        ),
      )
      .for('update');
    if (!row || row.revokedAt) return { ok: false, reason: 'invalid' };
    if (row.refreshHash !== presented) {
      await tx.update(portalSessions).set({ revokedAt: now }).where(eq(portalSessions.id, row.id));
      return { ok: false, reason: 'reused' };
    }
    const end = row.refreshExpiresAt;
    if (!end || end.getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
    const r = await liveAccountTx(tx, row.accountId, now);
    if (!r) return { ok: false, reason: 'invalid' };
    const t = mint(orgId, now, end);
    await tx
      .update(portalSessions)
      .set({
        tokenHash: hash('session', t.access),
        expiresAt: t.expiresAt,
        refreshHash: hash('session', t.refresh),
        previousRefreshHash: presented,
      })
      .where(eq(portalSessions.id, row.id));
    return { ok: true, tokens: t.tokens };
  });
}

/**
 * The principal behind an access token, only while the session is live (not revoked, access token
 * unexpired) and the account is: revoking an account or its assignment ends its sessions at the
 * next request. `signedInAt` is the session's start (step-up moment), as for a browser session.
 */
export async function portalPrincipalByBearer(
  accessToken: string | null | undefined,
  now = new Date(),
): Promise<PortalPrincipal | null> {
  const m = accessToken ? ACCESS.exec(accessToken) : null;
  if (!m) return null;
  const orgId = m[1] as string;
  return withTenant(systemCtx(orgId), async (tx) => {
    const [s] = await tx
      .select({ accountId: portalSessions.accountId, createdAt: portalSessions.createdAt })
      .from(portalSessions)
      .where(
        and(
          eq(portalSessions.kind, 'bearer'),
          eq(portalSessions.tokenHash, hash('session', m[2] as string)),
          isNull(portalSessions.revokedAt),
          gt(portalSessions.expiresAt, now),
        ),
      );
    if (!s) return null;
    const r = await liveAccountTx(tx, s.accountId, now);
    if (!r) return null;
    return {
      orgId: r.account.orgId,
      eventId: r.account.eventId,
      eventRoleAssignmentId: r.account.assignmentId,
      role: r.account.role as PortalPrincipal['role'],
      subjectId: r.account.subjectId,
      subjectKind: r.account.subjectKind as PortalPrincipal['subjectKind'],
      accountId: r.account.id,
      email: r.account.email,
      expiresAt: portalExpiresAt(r.eventEndsAt),
      signedInAt: s.createdAt,
    };
  });
}

/** Sign out: the session ends, access and refresh token both. Unknown tokens do nothing. */
export async function endPortalBearerSession(token: string, now = new Date()): Promise<void> {
  const m = REFRESH.exec(token) ?? ACCESS.exec(token);
  if (!m) return;
  const orgId = m[1] as string;
  const h = hash('session', m[2] as string);
  await withTenant(systemCtx(orgId), (tx) =>
    tx
      .update(portalSessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(portalSessions.kind, 'bearer'),
          or(
            eq(portalSessions.tokenHash, h),
            eq(portalSessions.refreshHash, h),
            eq(portalSessions.previousRefreshHash, h),
          ),
        ),
      ),
  );
}
