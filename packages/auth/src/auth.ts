import { identityDatabase } from '@yayatoh/db/identity';
import { uuidv7 } from '@yayatoh/kernel';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthEndpoint, createAuthMiddleware } from 'better-auth/api';
import { deleteSessionCookie, setSessionCookie } from 'better-auth/cookies';
import { generateRandomString, symmetricDecrypt } from 'better-auth/crypto';
import { nextCookies } from 'better-auth/next-js';
import { bearer, emailOTP, magicLink, twoFactor } from 'better-auth/plugins';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  consumeHandoff,
  type HandoffRefusal,
  handoffExpired,
  normalizeHandoffHost,
  stateMatches,
} from './handoff.ts';
import { getImpersonation, isImpersonationActive } from './impersonation.ts';
import type { AuthMailer } from './mailer.ts';
import { hashPassword, needsRehash, verifyPassword } from './password.ts';
import { authSchema, securityEvents, twoFactors } from './schema.ts';
import { devPersonaTotpSecret, matchTotpStep } from './totp.ts';

/**
 * Envelope encryption for identity secrets (roadmap §10: KMS envelope encryption for TOTP seeds).
 * The apps pass the platform KeyVault (AWS KMS in production, LOCAL_KMS_KEY elsewhere).
 */
export interface SecretSealer {
  seal(plaintext: string): Promise<string>;
  open(sealed: string): Promise<string>;
}

export interface AuthOptions {
  /** Public origin of this host, e.g. https://app.yayatoh.com. Each host has its own session. */
  readonly baseURL: string;
  /** ≥32 random bytes from the secret store (BETTER_AUTH_SECRET). */
  readonly secret: string;
  readonly mailer: AuthMailer;
  readonly trustedOrigins?: readonly string[];
  /**
   * Distinct cookie names for a second app on the same host name (apps/admin on localhost:3001
   * next to the web on :3000: browsers share cookies across ports). Production hosts differ anyway.
   */
  readonly cookieNamespace?: string;
  /**
   * Seals TOTP seeds and backup codes at rest. Without it Better Auth's own encryption (a key
   * derived from BETTER_AUTH_SECRET) is the only layer; the apps always pass one.
   */
  readonly sealer?: SecretSealer;
  /** Where the sign-in page is, for a magic link that still needs the second step. */
  readonly signInPath?: string;
  /**
   * People whose authenticator codes may be used more than once (TOTP replay protection skips
   * them). Development only: the seeded personas share one derived secret across parallel test
   * sessions. Never set in production.
   */
  readonly totpReplayExempt?: (user: { id: string; email: string }, secret: string) => boolean;
}

/**
 * Development only: the seeded personas' authenticator secret is derived from the dev persona
 * password, and parallel e2e sessions answer challenges with it at the same moment, so replay
 * protection skips exactly those secrets. Off unless dev auth is on outside production.
 */
export function devPersonaReplayExempt(
  env: Record<string, string | undefined> = process.env,
): AuthOptions['totpReplayExempt'] {
  const password = env.DEV_PERSONA_PASSWORD;
  if (env.YAYATOH_DEV_AUTH !== '1' || env.VERCEL_ENV === 'production' || !password) return undefined;
  return (user, secret) => secret === devPersonaTotpSecret(user.email, password);
}

export const SESSION_COOKIE_BASENAME = 'yy.session';

/** How long a sign-in challenge (first factor done, code pending) stays open. */
const CHALLENGE_MAX_AGE_S = 600;

// biome-ignore lint/suspicious/noExplicitAny: Better Auth's adapter and middleware contexts are wide generic types.
type Any = any;

/**
 * Wrap the database adapter so the TOTP seed column is sealed on write and opened on read. Better
 * Auth encrypts the seed with its own key first; the KMS envelope is a second layer. Backup codes
 * use the plugin's own custom-storage option instead (its compare-and-swap reads the stored value).
 */
function sealTwoFactorSecrets(adapter: Any, sealer: SecretSealer): Any {
  const isTf = (model: string) => model === 'twoFactor';
  const sealIn = async (model: string, data: Any) => {
    if (!isTf(model) || !data || typeof data.secret !== 'string') return data;
    return { ...data, secret: await sealer.seal(data.secret) };
  };
  const openOut = async (model: string, row: Any) => {
    if (!isTf(model) || !row || typeof row.secret !== 'string') return row;
    return { ...row, secret: await sealer.open(row.secret) };
  };
  return {
    ...adapter,
    create: async (a: Any) =>
      openOut(a.model, await adapter.create({ ...a, data: await sealIn(a.model, a.data) })),
    update: async (a: Any) =>
      openOut(a.model, await adapter.update({ ...a, update: await sealIn(a.model, a.update) })),
    updateMany: async (a: Any) => adapter.updateMany({ ...a, update: await sealIn(a.model, a.update) }),
    incrementOne: async (a: Any) =>
      openOut(a.model, await adapter.incrementOne({ ...a, set: await sealIn(a.model, a.set) })),
    findOne: async (a: Any) => openOut(a.model, await adapter.findOne(a)),
    findMany: async (a: Any) => Promise.all((await adapter.findMany(a)).map((r: Any) => openOut(a.model, r))),
    consumeOne: async (a: Any) => openOut(a.model, await adapter.consumeOne(a)),
    transaction: (cb: Any) => adapter.transaction((trx: Any) => cb(sealTwoFactorSecrets(trx, sealer))),
  };
}

/**
 * Better Auth's two-factor plugin challenges password sign-ins only. An emailed code or a magic
 * link is one factor as well, so the same challenge applies there: the session just created is
 * dropped and a short-lived, signed `two_factor` cookie carries the pending sign-in instead.
 */
async function startChallenge(ctx: Any, data: { session: { token: string }; user: { id: string } }) {
  deleteSessionCookie(ctx, true);
  await ctx.context.internalAdapter.deleteSession(data.session.token);
  ctx.context.setNewSession(null);
  const cookie = ctx.context.createAuthCookie('two_factor', { maxAge: CHALLENGE_MAX_AGE_S });
  const identifier = `2fa-${generateRandomString(20)}`;
  const expiresAt = new Date(Date.now() + CHALLENGE_MAX_AGE_S * 1000);
  await ctx.context.internalAdapter.createVerificationValue({ value: data.user.id, identifier, expiresAt });
  await ctx.context.internalAdapter.createVerificationValue({
    value: '0',
    identifier: `2fa-attempts-${identifier}`,
    expiresAt,
  });
  await ctx.setSignedCookie(cookie.name, identifier, ctx.context.secret, cookie.attributes);
}

async function audit(userId: string, action: string, data: Record<string, unknown>) {
  await identityDatabase().insert(securityEvents).values({ id: uuidv7(), userId, action, data });
}

/**
 * Replay protection (RFC 6238 §5.2): accept a TOTP code only for a time step after the last one
 * this person used. The update is the check: two requests can never both spend the same step.
 */
export async function consumeTotpStep(userId: string, step: number): Promise<boolean> {
  const rows = await identityDatabase()
    .update(twoFactors)
    .set({ lastUsedStep: step })
    .where(
      and(
        eq(twoFactors.userId, userId),
        or(isNull(twoFactors.lastUsedStep), lt(twoFactors.lastUsedStep, step)),
      ),
    )
    .returning({ id: twoFactors.id });
  return rows.length > 0;
}

/**
 * The pending sign-in challenge's person and the time step of the TOTP code in the request, or
 * null (no challenge, no TOTP, a wrong code: Better Auth refuses and counts those itself).
 */
async function challengeStep(
  ctx: Any,
  exempt: AuthOptions['totpReplayExempt'],
): Promise<{ userId: string; step: number } | null> {
  const cookie = ctx.context.createAuthCookie('two_factor');
  const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!identifier) return null;
  const pending = await ctx.context.internalAdapter.findVerificationValue(identifier);
  const userId: string | undefined = pending?.value;
  if (!userId) return null;
  const row = await ctx.context.adapter.findOne({
    model: 'twoFactor',
    where: [{ field: 'userId', value: userId }],
  });
  if (!row?.secret) return null;
  const secret = await symmetricDecrypt({ key: ctx.context.secretConfig, data: row.secret });
  const step = matchTotpStep(secret, String(ctx.body?.code ?? ''), Date.now());
  if (step === null) return null;
  if (exempt) {
    const user = await ctx.context.internalAdapter.findUserById(userId);
    if (user && exempt({ id: user.id, email: user.email }, secret)) return null;
  }
  return { userId, step };
}

const replayRefused = () =>
  new APIError('UNAUTHORIZED', { code: 'INVALID_CODE', message: 'Invalid two factor code' });

/**
 * Before Better Auth checks a sign-in challenge's TOTP code: a code whose time step this person
 * already used is refused (and audited). The step is spent only once the sign-in succeeds (after
 * hook), so a right code refused for another reason (a spent challenge) still works next time.
 */
async function refuseUsedTotp(ctx: Any, exempt: AuthOptions['totpReplayExempt']) {
  const hit = await challengeStep(ctx, exempt);
  if (!hit) return;
  const [row] = await identityDatabase()
    .select({ last: twoFactors.lastUsedStep })
    .from(twoFactors)
    .where(eq(twoFactors.userId, hit.userId));
  if (row?.last === null || row?.last === undefined || hit.step > row.last) return;
  await audit(hit.userId, 'two_factor.replay_refused', { purpose: 'sign_in' });
  throw replayRefused();
}

/**
 * After a successful challenge: spend the step. If a concurrent request spent it first, the
 * session just made is dropped again: one code, one sign-in.
 */
async function spendTotpStep(ctx: Any, exempt: AuthOptions['totpReplayExempt']) {
  const fresh = ctx.context.newSession;
  if (!fresh) return;
  // The challenge is consumed by now: recompute from the person and the code instead.
  const row = await ctx.context.adapter.findOne({
    model: 'twoFactor',
    where: [{ field: 'userId', value: fresh.user.id }],
  });
  if (!row?.secret) return;
  const secret = await symmetricDecrypt({ key: ctx.context.secretConfig, data: row.secret });
  const step = matchTotpStep(secret, String(ctx.body?.code ?? ''), Date.now());
  if (step === null) return;
  if (exempt?.({ id: fresh.user.id, email: fresh.user.email }, secret)) return;
  if (await consumeTotpStep(fresh.user.id, step)) return;
  deleteSessionCookie(ctx, true);
  await ctx.context.internalAdapter.deleteSession(fresh.session.token);
  ctx.context.setNewSession(null);
  await audit(fresh.user.id, 'two_factor.replay_refused', { purpose: 'sign_in' });
  throw replayRefused();
}

const RedeemBody = z.object({
  code: z.string().max(100),
  host: z.string().max(300),
  state: z.string().max(100).nullish(),
});

/**
 * Central login (M1.2d): a tenant host (or the app host, for staff impersonation) redeems a
 * handoff code for its own session, created here and bound to that host. Server-only: the
 * endpoint is closed over HTTP (the app's route calls it in-process). Every refusal is audited.
 */
function handoffPlugin() {
  return {
    id: 'yy-handoff',
    endpoints: {
      redeemHandoff: createAuthEndpoint(
        '/handoff/redeem',
        { method: 'POST', body: RedeemBody },
        async (ctx) => {
          const now = new Date();
          const host = normalizeHandoffHost(ctx.body.host);
          const refuse = async (reason: HandoffRefusal, userId: string | null): Promise<never> => {
            if (userId) await audit(userId, 'handoff.refused', { reason, host });
            throw new APIError('BAD_REQUEST', { code: 'HANDOFF_REFUSED', message: reason });
          };
          const spent = await consumeHandoff(ctx.body.code, now);
          if ('refused' in spent) return refuse(spent.refused, spent.userId);
          const row = spent.row;
          if (handoffExpired(row.expiresAt, now)) return refuse('expired', row.userId);
          if (!host || host !== row.host) return refuse('wrong_host', row.userId);
          if (row.stateHash && !stateMatches(ctx.body.state, row.stateHash))
            return refuse('wrong_state', row.userId);
          let impersonation: Awaited<ReturnType<typeof getImpersonation>> = null;
          if (row.impersonationId) {
            impersonation = await getImpersonation(row.impersonationId);
            if (!impersonation || !isImpersonationActive(impersonation, now))
              return refuse('ended', row.userId);
          }
          const user = await ctx.context.internalAdapter.findUserById(row.userId);
          if (!user) return refuse('unknown', null);
          // An impersonation's session ends with it (at most an hour) and is never refreshed.
          const session = await ctx.context.internalAdapter.createSession(
            row.userId,
            Boolean(impersonation),
            {
              host,
              impersonationId: impersonation?.id ?? null,
              ...(impersonation ? { expiresAt: impersonation.expiresAt } : {}),
            },
            true,
          );
          await setSessionCookie(ctx, { session, user }, Boolean(impersonation));
          await audit(row.userId, 'handoff.redeemed', { host, impersonation: Boolean(impersonation) });
          return ctx.json({ returnPath: row.returnPath, userId: row.userId });
        },
      ),
    },
  } as const;
}

/**
 * Identity for one host (ADR 0010). Sessions use a `__Host-` cookie on HTTPS: Secure, Path=/,
 * no Domain, so a session is valid only on the host that issued it. Passwords hash with
 * Argon2id; migrated Laravel `$2y$` hashes verify and are rehashed on first sign-in.
 */
export function createAuth(opts: AuthOptions) {
  if (opts.secret.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');
  const secure = opts.baseURL.startsWith('https://');
  const sealer = opts.sealer;
  const signInPath = opts.signInPath ?? '/sign-in';
  const database = drizzleAdapter(identityDatabase(), { provider: 'pg', schema: authSchema });
  return betterAuth({
    appName: 'Yayatoh',
    baseURL: opts.baseURL,
    secret: opts.secret,
    trustedOrigins: [...(opts.trustedOrigins ?? [])],
    telemetry: { enabled: false },
    database: sealer ? (options: Any) => sealTwoFactorSecrets(database(options), sealer) : database,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 10,
      additionalFields: {
        // Set by a step-up ("Confirm it's you"); never by a client.
        stepUpAt: { type: 'date', required: false, input: false },
        // The host the session belongs to (M1.2d) and the impersonation behind it (M1.2e).
        host: { type: 'string', required: false, input: false },
        impersonationId: { type: 'string', required: false, input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Every session is bound to the host it was created on (the Host of the sign-in request).
          before: async (session, context) => {
            if ((session as { host?: unknown }).host) return { data: session };
            const headers = (context as { headers?: Headers } | null)?.headers;
            return { data: { ...session, host: normalizeHandoffHost(headers?.get('host')) } };
          },
        },
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      // Sign-in and emailed codes are limited in front of Better Auth by the platform limiter
      // (M1.14a: per device, per email and a per-IP ceiling), which tolerates shared IPs; Better
      // Auth's per-IP bucket (one global bucket when no IP is known) would lock out a whole venue.
      customRules: { '/sign-in/*': false, '/email-otp/send-verification-otp': false },
    },
    advanced: {
      // Better Auth would prefix `__Secure-`, which hides the `__Host-` prefix from browsers.
      // Set Secure explicitly and name the session cookie `__Host-…` ourselves instead.
      useSecureCookies: false,
      cookiePrefix: `${secure ? '__Host-' : ''}yy${opts.cookieNamespace ? `-${opts.cookieNamespace}` : ''}`,
      cookies: {
        session_token: {
          name: `${secure ? '__Host-' : ''}${SESSION_COOKIE_BASENAME}${opts.cookieNamespace ? `.${opts.cookieNamespace}` : ''}`,
        },
      },
      defaultCookieAttributes: { sameSite: 'lax', path: '/', secure },
      database: { generateId: () => uuidv7() },
    },
    hooks: {
      // Two-step verification is managed through packages/auth (the app's rules and audit), and
      // the sign-in challenge through the app's server actions: closed over HTTP.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.request && (ctx.path.startsWith('/two-factor/') || ctx.path.startsWith('/handoff/')))
          throw new APIError('NOT_FOUND');
        if (ctx.path === '/two-factor/verify-totp') await refuseUsedTotp(ctx, opts.totpReplayExempt);
      }),
      after: createAuthMiddleware(async (ctx) => {
        const fresh = ctx.context.newSession;
        // Rehash migrated Laravel bcrypt passwords to Argon2id after a successful sign-in.
        if (ctx.path === '/sign-in/email') {
          const password = (ctx.body as { password?: unknown } | undefined)?.password;
          if (!fresh || typeof password !== 'string') return;
          const accounts = await ctx.context.internalAdapter.findAccounts(fresh.user.id);
          const credential = accounts.find((a) => a.providerId === 'credential');
          if (credential?.password && needsRehash(credential.password)) {
            await ctx.context.internalAdapter.updatePassword(fresh.user.id, await hashPassword(password));
          }
          return;
        }
        // Emailed code or magic link: the second step is still due for people with 2FA on.
        if ((ctx.path === '/sign-in/email-otp' || ctx.path === '/magic-link/verify') && fresh) {
          if (!(fresh.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled) return;
          await startChallenge(ctx, fresh);
          if (ctx.path === '/magic-link/verify') throw ctx.redirect(`${signInPath}?challenge=1`);
          return ctx.json({ twoFactorRedirect: true, twoFactorMethods: ['totp'] });
        }
        // Replay protection: the authenticator code's time step is spent with the sign-in.
        if (ctx.path === '/two-factor/verify-totp' && fresh) await spendTotpStep(ctx, opts.totpReplayExempt);
        // Audit: a sign-in challenge passed (with the authenticator or a backup code).
        if (
          (ctx.path === '/two-factor/verify-totp' || ctx.path === '/two-factor/verify-backup-code') &&
          fresh
        ) {
          const backup = ctx.path === '/two-factor/verify-backup-code';
          if (backup) await audit(fresh.user.id, 'two_factor.backup_code_used', { purpose: 'sign_in' });
          await audit(fresh.user.id, 'two_factor.challenge_passed', {
            method: backup ? 'backup_code' : 'totp',
          });
        }
      }),
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        sendVerificationOTP: ({ email, otp, type }) => opts.mailer.sendOtp(email, otp, type),
      }),
      magicLink({ expiresIn: 900, sendMagicLink: ({ email, url }) => opts.mailer.sendMagicLink(email, url) }),
      twoFactor({
        issuer: 'Yayatoh',
        twoFactorCookieMaxAge: CHALLENGE_MAX_AGE_S,
        backupCodeOptions: {
          storeBackupCodes: sealer ? { encrypt: sealer.seal, decrypt: sealer.open } : 'encrypted',
        },
      }),
      bearer(),
      handoffPlugin(),
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
