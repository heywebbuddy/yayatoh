import { type TenantTx, withTenant } from '@yayatoh/db';
import { type Ctx, createCtx, DomainError, type DomainEvent, uuidv7 } from '@yayatoh/kernel';
import { appTokenSecret, defineSubscriber, type Notifier } from '@yayatoh/platform';
import type { RateLimiter, RateLimitSubject } from '@yayatoh/platform/security';
import { and, asc, desc, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import {
  checkPortalAccount,
  checkPortalCode,
  checkPortalLink,
  maskPortalEmail,
  newPortalCode,
  newPortalSecret,
  normalizePortalEmail,
  PORTAL_CODE_TTL_MS,
  PORTAL_LINK_TTL_MS,
  PORTAL_MAX_ATTEMPTS,
  type PortalAccountCheck,
  type PortalRole,
  type PortalSubjectKind,
  parsePortalLinkToken,
  parsePortalSessionToken,
  portalCodeHash,
  portalExpiresAt,
  portalLinkToken,
  portalResendAt,
  portalSecretHash,
  portalSessionExpiry,
  portalSessionToken,
  SUBJECT_OF_ROLE,
  signPortalInvite,
  signPortalSite,
  verifyPortalInvite,
  verifyPortalSite,
} from './domain/portal-auth.ts';
import { eventRoleAssignments, events } from './schema.ts';
import { portalAccounts, portalChallenges, portalSessions } from './schema-portal.ts';

/**
 * M5.3a portal accounts (P5-7): the shared foundation for speakers (M5.3a), exhibitor admins and
 * staff (M5.4a) and sponsor contacts. Higher-tier modules invite accounts for their own program
 * rows (they validate the subject) with `createPortalAccountTx`; the web app signs accounts in
 * with the M1.5f code + magic link rules and resolves `requirePortalPrincipal()` from the
 * session cookie; portal commands re-check the account with `portalPrincipalTx`.
 */
export interface PortalPrincipal {
  readonly orgId: string;
  readonly eventId: string;
  readonly eventRoleAssignmentId: string;
  readonly role: PortalRole;
  readonly subjectId: string;
  readonly subjectKind: PortalSubjectKind;
  readonly accountId: string;
  readonly email: string;
  /** The event's end + 90 days: the account stops working then. */
  readonly expiresAt: Date;
  /**
   * M5.6b: when this browser's session was signed in (code or magic link). A sign-in is a
   * re-authentication, so commands that need step-up pass for 10 minutes after it.
   */
  readonly signedInAt?: Date | null;
}

export interface PortalLimits {
  readonly limiter: RateLimiter;
  readonly subject: Pick<RateLimitSubject, 'device' | 'ip'>;
}

const DAY = 24 * 3_600_000;
const systemCtx = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: 'events.portal' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type AccountRow = typeof portalAccounts.$inferSelect;

/** An account with its event's end and its assignment's state (under the org's RLS). */
async function accountTx(tx: TenantTx, accountId: string) {
  const [row] = await tx
    .select({
      account: portalAccounts,
      eventEndsAt: events.endsAt,
      eventName: events.name,
      assignmentRole: eventRoleAssignments.role,
      assignmentExpiresAt: eventRoleAssignments.expiresAt,
    })
    .from(portalAccounts)
    .innerJoin(events, eq(events.id, portalAccounts.eventId))
    .innerJoin(eventRoleAssignments, eq(eventRoleAssignments.id, portalAccounts.assignmentId))
    .where(eq(portalAccounts.id, accountId));
  return row ?? null;
}

type AccountJoin = NonNullable<Awaited<ReturnType<typeof accountTx>>>;

function stateOf(r: AccountJoin, now: Date, presentedVersion: number | null = null): PortalAccountCheck {
  const check = checkPortalAccount(
    {
      inviteVersion: r.account.inviteVersion,
      revokedAt: r.account.revokedAt,
      expiresAt: portalExpiresAt(r.eventEndsAt),
    },
    now,
    presentedVersion,
  );
  if (check !== 'ok') return check;
  // The assignment is the grant: it must still be this role, bound to this account, and live.
  if (r.assignmentRole !== r.account.role) return 'revoked';
  if (r.assignmentExpiresAt && r.assignmentExpiresAt.getTime() <= now.getTime()) return 'revoked';
  return 'ok';
}

const toPrincipal = (r: AccountJoin): PortalPrincipal => ({
  orgId: r.account.orgId,
  eventId: r.account.eventId,
  eventRoleAssignmentId: r.account.assignmentId,
  role: r.account.role as PortalRole,
  subjectId: r.account.subjectId,
  subjectKind: r.account.subjectKind as PortalSubjectKind,
  accountId: r.account.id,
  email: r.account.email,
  expiresAt: portalExpiresAt(r.eventEndsAt),
});

/* ----------------------------------------------------------- organizer side (tx helpers) ---- */

/** `portal.account_invited@1`: the invite mailer emails the (signed) link; the event carries no token. */
export function portalAccountInvited(a: {
  id: string;
  eventId: string;
  role: string;
  inviteVersion: number;
}): DomainEvent {
  return {
    type: 'portal.account_invited',
    version: 1,
    aggregateType: 'portal_account',
    aggregateId: a.id,
    payload: { accountId: a.id, eventId: a.eventId, role: a.role, inviteVersion: a.inviteVersion },
  };
}

export const PortalAccountDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  role: z.string(),
  subjectKind: z.string(),
  subjectId: z.uuid(),
  email: z.string(),
  status: z.enum(['invited', 'active', 'revoked', 'expired']),
  invitedAt: z.date(),
  lastSignInAt: z.date().nullable(),
});
export type PortalAccountDto = z.infer<typeof PortalAccountDto>;

function accountDto(a: AccountRow, eventEndsAt: Date, now: Date): PortalAccountDto {
  const status = a.revokedAt
    ? 'revoked'
    : portalExpiresAt(eventEndsAt).getTime() <= now.getTime()
      ? 'expired'
      : a.lastSignInAt
        ? 'active'
        : 'invited';
  return PortalAccountDto.parse({ ...a, status });
}

/**
 * Invite (or re-invite) someone to the portal for one program row. The caller — a higher-tier
 * command that authorized the organizer and checked the subject belongs to `eventId` — emits the
 * returned event so the invitation is emailed. An existing account for the same address is
 * reissued (older links stop working) and un-revoked.
 */
export async function createPortalAccountTx(
  tx: TenantTx,
  ctx: Ctx,
  a: { eventId: string; role: PortalRole; subjectId: string; email: string },
): Promise<{ account: PortalAccountDto; event: DomainEvent }> {
  const orgId = ctx.orgId;
  if (!orgId) throw new DomainError('forbidden', 'Tenant context required');
  const email = normalizePortalEmail(a.email);
  const [ev] = await tx.select({ endsAt: events.endsAt }).from(events).where(eq(events.id, a.eventId));
  if (!ev) throw new DomainError('not_found');
  const expiresAt = portalExpiresAt(ev.endsAt);
  if (expiresAt.getTime() <= ctx.now.getTime())
    throw new DomainError('invalid_state', 'The event is over', { reason: 'event_over' });
  const [existing] = await tx
    .select()
    .from(portalAccounts)
    .where(
      and(
        eq(portalAccounts.eventId, a.eventId),
        eq(portalAccounts.role, a.role),
        eq(portalAccounts.subjectId, a.subjectId),
        eq(portalAccounts.email, email),
      ),
    );
  let row: AccountRow | undefined;
  if (existing) {
    [row] = await tx
      .update(portalAccounts)
      .set({
        inviteVersion: existing.inviteVersion + 1,
        revokedAt: null,
        invitedAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(eq(portalAccounts.id, existing.id))
      .returning();
    await tx
      .update(eventRoleAssignments)
      .set({ expiresAt, updatedAt: ctx.now })
      .where(eq(eventRoleAssignments.id, existing.assignmentId));
  } else {
    const accountId = uuidv7();
    const [grant] = await tx
      .insert(eventRoleAssignments)
      .values({ orgId, eventId: a.eventId, userId: accountId, role: a.role, expiresAt })
      .returning({ id: eventRoleAssignments.id });
    if (!grant) throw new DomainError('internal');
    [row] = await tx
      .insert(portalAccounts)
      .values({
        id: accountId,
        orgId,
        eventId: a.eventId,
        assignmentId: grant.id,
        role: a.role,
        subjectKind: SUBJECT_OF_ROLE[a.role],
        subjectId: a.subjectId,
        email,
        invitedAt: ctx.now,
      })
      .returning();
  }
  if (!row) throw new DomainError('internal');
  return { account: accountDto(row, ev.endsAt, ctx.now), event: portalAccountInvited(row) };
}

/**
 * Revoke an account: its links, codes and sessions stop at once and its event-role assignment
 * ends. Scoped to the subject the caller manages; unknown ids are `not_found`.
 */
export async function revokePortalAccountTx(
  tx: TenantTx,
  ctx: Ctx,
  a: { eventId: string; accountId: string; subjectKind: PortalSubjectKind },
): Promise<PortalAccountDto> {
  const [row] = await tx
    .update(portalAccounts)
    .set({ revokedAt: ctx.now, updatedAt: ctx.now })
    .where(
      and(
        eq(portalAccounts.id, a.accountId),
        eq(portalAccounts.eventId, a.eventId),
        eq(portalAccounts.subjectKind, a.subjectKind),
      ),
    )
    .returning();
  if (!row) throw new DomainError('not_found');
  await tx
    .update(eventRoleAssignments)
    .set({ expiresAt: ctx.now, updatedAt: ctx.now })
    .where(eq(eventRoleAssignments.id, row.assignmentId));
  await tx
    .update(portalSessions)
    .set({ revokedAt: ctx.now })
    .where(and(eq(portalSessions.accountId, row.id), isNull(portalSessions.revokedAt)));
  await tx
    .update(portalChallenges)
    .set({ expiresAt: ctx.now, linkExpiresAt: null, linkHash: null, browserHash: null })
    .where(and(eq(portalChallenges.accountId, row.id), isNull(portalChallenges.usedAt)));
  const [ev] = await tx.select({ endsAt: events.endsAt }).from(events).where(eq(events.id, row.eventId));
  return accountDto(row, ev?.endsAt ?? ctx.now, ctx.now);
}

/** The portal accounts of one kind of subject at an event (the organizer's lists). */
export async function portalAccountsTx(
  tx: TenantTx,
  eventId: string,
  subjectKind: PortalSubjectKind,
  now: Date,
): Promise<PortalAccountDto[]> {
  const rows = await tx
    .select({ a: portalAccounts, endsAt: events.endsAt })
    .from(portalAccounts)
    .innerJoin(events, eq(events.id, portalAccounts.eventId))
    .where(and(eq(portalAccounts.eventId, eventId), eq(portalAccounts.subjectKind, subjectKind)))
    .orderBy(asc(portalAccounts.createdAt));
  return rows.map((r) => accountDto(r.a, r.endsAt, now));
}

/** Live accounts (not revoked, not expired) of some subjects: who can be emailed for them. */
export async function livePortalAccountsTx(
  tx: TenantTx,
  eventId: string,
  subjectKind: PortalSubjectKind,
  subjectIds: readonly string[],
  now: Date,
): Promise<PortalAccountDto[]> {
  if (subjectIds.length === 0) return [];
  const rows = await tx
    .select({ a: portalAccounts, endsAt: events.endsAt })
    .from(portalAccounts)
    .innerJoin(events, eq(events.id, portalAccounts.eventId))
    .where(
      and(
        eq(portalAccounts.eventId, eventId),
        eq(portalAccounts.subjectKind, subjectKind),
        inArray(portalAccounts.subjectId, [...subjectIds]),
        isNull(portalAccounts.revokedAt),
      ),
    );
  return rows
    .map((r) => accountDto(r.a, r.endsAt, now))
    .filter((a) => a.status === 'invited' || a.status === 'active');
}

/* -------------------------------------------------------------- handler-side check ---- */

/**
 * The portal principal of a command's context, re-read inside its transaction: the actor must be
 * a portal account of this org that is live (not revoked, event + 90 days not passed, its
 * assignment still granted). Anything else is `forbidden`.
 */
export async function portalPrincipalTx(tx: TenantTx, ctx: Ctx): Promise<PortalPrincipal> {
  if (ctx.actor.type !== 'portal') throw new DomainError('forbidden');
  const r = await accountTx(tx, ctx.actor.accountId);
  if (!r || stateOf(r, ctx.now) !== 'ok' || r.account.role !== ctx.actor.role)
    throw new DomainError('forbidden');
  return toPrincipal(r);
}

/** A context for a signed-in portal principal (the web app builds its commands' ctx with it). */
export const portalCtx = (p: PortalPrincipal, locale = 'en', now = new Date()): Ctx =>
  createCtx({
    orgId: p.orgId,
    actor: { type: 'portal', accountId: p.accountId, role: p.role },
    locale,
    now,
    stepUpAt: p.signedInAt ?? null,
  });

/* --------------------------------------------------------------------- invitations ---- */

export const portalInviteToken = (orgId: string, accountId: string, version: number) =>
  signPortalInvite(appTokenSecret(), { orgId, accountId, version });

export interface PortalInvite {
  readonly orgId: string;
  readonly accountId: string;
  readonly status: PortalAccountCheck;
  readonly eventName: string;
  readonly role: PortalRole;
  readonly maskedEmail: string;
}

/** What an invitation link opens (the sign-in page). Forged or unknown links are null. */
export async function portalInviteByToken(token: string, now = new Date()): Promise<PortalInvite | null> {
  const t = verifyPortalInvite(appTokenSecret(), token);
  if (!t) return null;
  const r = await withTenant(systemCtx(t.orgId), (tx) => accountTx(tx, t.accountId));
  if (!r) return null;
  return {
    orgId: t.orgId,
    accountId: t.accountId,
    status: stateOf(r, now, t.version),
    eventName: r.eventName,
    role: r.account.role as PortalRole,
    maskedEmail: maskPortalEmail(r.account.email),
  };
}

/* --------------------------------------------------------- the event's sign-in page ---- */

/** The token of an event's shareable portal sign-in page (the organizer copies its link). */
export const portalSiteToken = (orgId: string, eventId: string) =>
  signPortalSite(appTokenSecret(), { orgId, eventId });

/** The event a sign-in page token names (its name for the page), or null when forged or gone. */
export async function portalSiteByToken(token: string): Promise<{ orgId: string; eventName: string } | null> {
  const t = verifyPortalSite(appTokenSecret(), token);
  if (!t) return null;
  const [ev] = await withTenant(systemCtx(t.orgId), (tx) =>
    tx.select({ name: events.name }).from(events).where(eq(events.id, t.eventId)),
  );
  return ev ? { orgId: t.orgId, eventName: ev.name } : null;
}

export type PortalResendResult =
  | {
      readonly status: 'ok';
      /** Whom to email which invitation (empty when the address has no live account here). */
      readonly invites: readonly {
        readonly email: string;
        readonly url: string;
        readonly eventName: string;
        readonly role: PortalRole;
      }[];
      readonly orgId: string;
    }
  | { readonly status: 'rate_limited'; readonly retryAfterMs: number }
  | { readonly status: 'refused' };

/**
 * "Email me my invitation again" on an event's sign-in page: the current invitation link of every
 * live account of that address at the event, to email to that address only. The caller shows the
 * same answer whether or not there were any (no enumeration); the M1.14 limiter (`guestCode`,
 * portal scope) applies per device, IP and address. The invitation then signs in as usual
 * (emailed code or magic link): there is one sign-in flow for every portal role.
 */
export async function resendPortalInvitations(
  input: {
    readonly siteToken: string;
    readonly email: string;
    readonly appOrigin: string;
    readonly locale: string;
  },
  limits: PortalLimits,
  now = new Date(),
): Promise<PortalResendResult> {
  const t = verifyPortalSite(appTokenSecret(), input.siteToken);
  if (!t) return { status: 'refused' };
  const email = normalizePortalEmail(input.email);
  const decision = await limits.limiter.check(
    'guestCode',
    { ...limits.subject, identity: email },
    { now: now.getTime(), scope: 'portal' },
  );
  if (!decision.allowed) return { status: 'rate_limited', retryAfterMs: decision.retryAfterMs };
  const rows = await withTenant(systemCtx(t.orgId), async (tx) => {
    const ids = await tx
      .select({ id: portalAccounts.id })
      .from(portalAccounts)
      .where(
        and(
          eq(portalAccounts.eventId, t.eventId),
          eq(portalAccounts.email, email),
          isNull(portalAccounts.revokedAt),
        ),
      );
    const out: AccountJoin[] = [];
    for (const { id } of ids) {
      const r = await accountTx(tx, id);
      if (r && stateOf(r, now) === 'ok') out.push(r);
    }
    return out;
  });
  return {
    status: 'ok',
    orgId: t.orgId,
    invites: rows.map((r) => ({
      email: r.account.email,
      url: portalInviteUrl(
        input.appOrigin,
        portalInviteToken(t.orgId, r.account.id, r.account.inviteVersion),
        input.locale,
      ),
      eventName: r.eventName,
      role: r.account.role as PortalRole,
    })),
  };
}

/* ---------------------------------------------------------------- codes and links ---- */

export type PortalChallengeResult =
  | {
      readonly status: 'sent';
      readonly challengeId: string;
      readonly code: string;
      readonly linkToken: string;
      readonly email: string;
      readonly eventName: string;
      readonly resendAt: Date;
    }
  | { readonly status: 'cooldown'; readonly challengeId: string; readonly resendAt: Date }
  | { readonly status: 'rate_limited'; readonly retryAfterMs: number }
  | { readonly status: 'refused' };

/**
 * Email a sign-in code and a magic link (bound to `browserState`) for an invitation. Only a live
 * account and the current invitation version get one; the cooldown and the M1.14 limiter
 * (`guestCode` policy, portal scope) apply per device and per address. A new code retires older ones.
 */
export async function requestPortalChallenge(
  input: { readonly inviteToken: string; readonly browserState: string },
  limits: PortalLimits,
  now = new Date(),
): Promise<PortalChallengeResult> {
  const secret = appTokenSecret();
  const t = verifyPortalInvite(secret, input.inviteToken);
  if (!t) return { status: 'refused' };
  const ctx = systemCtx(t.orgId);
  const r = await withTenant(ctx, (tx) => accountTx(tx, t.accountId));
  if (!r || stateOf(r, now, t.version) !== 'ok') return { status: 'refused' };
  const [last] = await withTenant(ctx, (tx) =>
    tx
      .select({
        id: portalChallenges.id,
        createdAt: portalChallenges.createdAt,
        usedAt: portalChallenges.usedAt,
      })
      .from(portalChallenges)
      .where(eq(portalChallenges.accountId, t.accountId))
      .orderBy(desc(portalChallenges.createdAt))
      .limit(1),
  );
  const wait = last && !last.usedAt ? portalResendAt(last.createdAt, now) : null;
  if (last && wait) return { status: 'cooldown', challengeId: last.id, resendAt: wait };
  const decision = await limits.limiter.check(
    'guestCode',
    { ...limits.subject, identity: r.account.email },
    { now: now.getTime(), scope: 'portal' },
  );
  if (!decision.allowed) return { status: 'rate_limited', retryAfterMs: decision.retryAfterMs };

  const id = uuidv7();
  const code = newPortalCode();
  const linkSecret = newPortalSecret();
  await withTenant(ctx, async (tx) => {
    await tx.delete(portalChallenges).where(lt(portalChallenges.expiresAt, new Date(now.getTime() - DAY)));
    await tx
      .update(portalChallenges)
      .set({ expiresAt: now, linkExpiresAt: null, linkHash: null, browserHash: null })
      .where(
        and(
          eq(portalChallenges.accountId, t.accountId),
          isNull(portalChallenges.usedAt),
          gt(portalChallenges.expiresAt, now),
        ),
      );
    await tx.insert(portalChallenges).values({
      id,
      orgId: t.orgId,
      accountId: t.accountId,
      codeHash: portalCodeHash(secret, id, code),
      expiresAt: new Date(now.getTime() + PORTAL_CODE_TTL_MS),
      linkHash: portalSecretHash(secret, 'link', linkSecret),
      browserHash: portalSecretHash(secret, 'browser', input.browserState),
      linkExpiresAt: new Date(now.getTime() + PORTAL_LINK_TTL_MS),
      createdAt: now,
    });
  });
  return {
    status: 'sent',
    challengeId: id,
    code,
    linkToken: portalLinkToken(t.orgId, id, linkSecret),
    email: r.account.email,
    eventName: r.eventName,
    resendAt: new Date(now.getTime() + 30_000),
  };
}

export type PortalVerifyResult =
  | { readonly status: 'ok'; readonly orgId: string; readonly accountId: string }
  | { readonly status: 'wrong'; readonly attemptsLeft: number }
  | { readonly status: 'locked' | 'expired' | 'used' | 'refused' }
  | { readonly status: 'rate_limited'; readonly retryAfterMs: number };

/**
 * Check a code for an invitation's account. Wrong codes count (the fifth locks it, even against the
 * right code); a right one is spent. Outcomes are returned, never thrown, so the count commits.
 */
export async function verifyPortalChallenge(
  input: { readonly inviteToken: string; readonly challengeId: string; readonly code: string },
  limits: PortalLimits,
  now = new Date(),
): Promise<PortalVerifyResult> {
  const secret = appTokenSecret();
  const t = verifyPortalInvite(secret, input.inviteToken);
  if (!t || !UUID.test(input.challengeId)) return { status: 'refused' };
  const ctx = systemCtx(t.orgId);
  const r = await withTenant(ctx, (tx) => accountTx(tx, t.accountId));
  if (!r || stateOf(r, now, t.version) !== 'ok') return { status: 'refused' };
  const decision = await limits.limiter.check(
    'guestVerify',
    { ...limits.subject, identity: r.account.email },
    { now: now.getTime(), scope: 'portal' },
  );
  if (!decision.allowed) return { status: 'rate_limited', retryAfterMs: decision.retryAfterMs };
  return withTenant(ctx, async (tx): Promise<PortalVerifyResult> => {
    const [row] = await tx
      .select()
      .from(portalChallenges)
      .where(and(eq(portalChallenges.id, input.challengeId), eq(portalChallenges.accountId, t.accountId)))
      .for('update');
    if (!row) return { status: 'expired' };
    const c = checkPortalCode(secret, row, input.code.trim(), now);
    if (c.status === 'ok') {
      await tx.update(portalChallenges).set({ usedAt: now }).where(eq(portalChallenges.id, row.id));
      return { status: 'ok', orgId: t.orgId, accountId: t.accountId };
    }
    if (c.status === 'wrong' || (c.status === 'locked' && row.attempts < PORTAL_MAX_ATTEMPTS))
      await tx
        .update(portalChallenges)
        .set({ attempts: row.attempts + 1 })
        .where(eq(portalChallenges.id, row.id));
    return c;
  });
}

export type PortalLinkResult =
  | { readonly status: 'ok'; readonly orgId: string; readonly accountId: string }
  | {
      readonly status: 'other_browser';
      readonly orgId: string;
      readonly challengeId: string;
      readonly inviteToken: string;
    }
  | { readonly status: 'invalid' };

/**
 * Open a sign-in magic link. In the browser that asked, it is spent and the account signed in;
 * anywhere else nothing is spent and the page asks for the emailed code (with the invitation it
 * came from). `spend: false` only says what opening it would do (mail scanners spend nothing).
 */
export async function consumePortalLink(
  input: { readonly token: string; readonly browserState: string | null; readonly spend?: boolean },
  now = new Date(),
): Promise<PortalLinkResult> {
  const parsed = parsePortalLinkToken(input.token);
  if (!parsed) return { status: 'invalid' };
  const secret = appTokenSecret();
  return withTenant(systemCtx(parsed.orgId), async (tx): Promise<PortalLinkResult> => {
    const [row] = await tx
      .select()
      .from(portalChallenges)
      .where(eq(portalChallenges.id, parsed.challengeId))
      .for('update');
    if (!row) return { status: 'invalid' };
    const acct = await accountTx(tx, row.accountId);
    if (!acct || stateOf(acct, now) !== 'ok') return { status: 'invalid' };
    const r = checkPortalLink(secret, row, parsed.secret, input.browserState, now);
    if (r === 'invalid') return { status: 'invalid' };
    if (r === 'other_browser')
      return {
        status: 'other_browser',
        orgId: parsed.orgId,
        challengeId: row.id,
        inviteToken: portalInviteToken(parsed.orgId, row.accountId, acct.account.inviteVersion),
      };
    if (input.spend !== false)
      await tx.update(portalChallenges).set({ usedAt: now }).where(eq(portalChallenges.id, row.id));
    return { status: 'ok', orgId: parsed.orgId, accountId: row.accountId };
  });
}

/* ------------------------------------------------------------------------ sessions ---- */

/** Open a portal session on this host for a verified account; returns the cookie value. */
export async function createPortalSession(
  input: { readonly orgId: string; readonly accountId: string; readonly host: string },
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const secret = newPortalSecret();
  return withTenant(systemCtx(input.orgId), async (tx) => {
    const r = await accountTx(tx, input.accountId);
    if (!r || stateOf(r, now) !== 'ok') throw new DomainError('forbidden');
    const expiresAt = portalSessionExpiry(now, portalExpiresAt(r.eventEndsAt));
    await tx.delete(portalSessions).where(lt(portalSessions.expiresAt, new Date(now.getTime() - DAY)));
    await tx.insert(portalSessions).values({
      orgId: input.orgId,
      accountId: input.accountId,
      tokenHash: portalSecretHash(appTokenSecret(), 'session', secret),
      host: input.host.toLowerCase(),
      expiresAt,
      // The sign-in time is the session's step-up moment (M5.6b): the caller's clock.
      createdAt: now,
    });
    await tx
      .update(portalAccounts)
      .set({ lastSignInAt: now, updatedAt: now })
      .where(eq(portalAccounts.id, input.accountId));
    return { token: portalSessionToken(input.orgId, secret), expiresAt };
  });
}

/**
 * The principal behind a portal session cookie, only on the host that issued it and only while
 * the session and the account are live. The org comes from the cookie; a wrong org finds nothing.
 */
export async function portalPrincipalBySession(
  token: string | null | undefined,
  host: string,
  now = new Date(),
): Promise<PortalPrincipal | null> {
  const t = parsePortalSessionToken(token);
  if (!t) return null;
  return withTenant(systemCtx(t.orgId), async (tx) => {
    const [s] = await tx
      .select({ accountId: portalSessions.accountId, createdAt: portalSessions.createdAt })
      .from(portalSessions)
      .where(
        and(
          eq(portalSessions.tokenHash, portalSecretHash(appTokenSecret(), 'session', t.secret)),
          eq(portalSessions.host, host.toLowerCase()),
          isNull(portalSessions.revokedAt),
          gt(portalSessions.expiresAt, now),
        ),
      );
    if (!s) return null;
    const r = await accountTx(tx, s.accountId);
    return r && stateOf(r, now) === 'ok' ? { ...toPrincipal(r), signedInAt: s.createdAt } : null;
  });
}

/** Sign this browser out. */
export async function endPortalSession(token: string | null | undefined, now = new Date()): Promise<void> {
  const t = parsePortalSessionToken(token);
  if (!t) return;
  await withTenant(systemCtx(t.orgId), (tx) =>
    tx
      .update(portalSessions)
      .set({ revokedAt: now })
      .where(eq(portalSessions.tokenHash, portalSecretHash(appTokenSecret(), 'session', t.secret))),
  );
}

/* ------------------------------------------------------------------------- mailer ---- */

// The locale came from the organizer's request; only a well-formed tag goes into a URL.
const localePrefix = (locale: string) =>
  locale !== 'en' && /^[a-z]{2}(-[A-Z]{2})?$/.test(locale) ? `/${locale}` : '';

export const portalInviteUrl = (appOrigin: string, token: string, locale = 'en') =>
  `${appOrigin}${localePrefix(locale)}/event-portal/invite/${token}`;

/** An account's current invitation link (for reminders): it signs in, or opens the portal. */
export async function portalAccountLinkTx(
  tx: TenantTx,
  accountId: string,
  appOrigin: string,
): Promise<string | null> {
  const [a] = await tx
    .select({ orgId: portalAccounts.orgId, v: portalAccounts.inviteVersion })
    .from(portalAccounts)
    .where(eq(portalAccounts.id, accountId));
  return a ? portalInviteUrl(appOrigin, portalInviteToken(a.orgId, accountId, a.v)) : null;
}

const InvitedPayload = z.object({
  accountId: z.uuid(),
  eventId: z.uuid(),
  role: z.string(),
  inviteVersion: z.number().int(),
});

/**
 * Emails portal invitations (`portal.invite`, transactional). The link is signed here from the
 * account and its version; events never carry tokens. A reissue has a new version, so a new message.
 */
export function portalInviteMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'events.portal-invite-mailer',
    events: ['portal.account_invited@1'],
    handle: async (tx, event) => {
      const p = InvitedPayload.parse(event.payload);
      const r = await accountTx(tx, p.accountId);
      // Revoked or reissued since: the newer invitation (if any) sends its own message.
      if (!r || r.account.inviteVersion !== p.inviteVersion || stateOf(r, new Date()) !== 'ok') return;
      const [ev] = await tx
        .select({ timezone: events.timezone })
        .from(events)
        .where(eq(events.id, r.account.eventId));
      await deps.notifier.enqueue(tx, {
        kind: 'portal.invite',
        to: { email: r.account.email, timeZone: ev?.timezone ?? null },
        params: {
          url: portalInviteUrl(deps.appOrigin, portalInviteToken(event.orgId, r.account.id, p.inviteVersion)),
          eventName: r.eventName,
          role: r.account.role,
        },
        dedupeKey: `portal-invite:${r.account.id}:${p.inviteVersion}`,
        eventId: r.account.eventId,
      });
    },
  });
}
