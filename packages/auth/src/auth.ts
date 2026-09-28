import { identityDatabase } from '@yayatoh/db/identity';
import { uuidv7 } from '@yayatoh/kernel';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { deleteSessionCookie } from 'better-auth/cookies';
import { generateRandomString } from 'better-auth/crypto';
import { nextCookies } from 'better-auth/next-js';
import { bearer, emailOTP, magicLink, twoFactor } from 'better-auth/plugins';
import type { AuthMailer } from './mailer.ts';
import { hashPassword, needsRehash, verifyPassword } from './password.ts';
import { authSchema, securityEvents } from './schema.ts';

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
      // Set by a step-up ("Confirm it's you"); never by a client.
      additionalFields: { stepUpAt: { type: 'date', required: false, input: false } },
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
        if (ctx.request && ctx.path.startsWith('/two-factor/')) throw new APIError('NOT_FOUND');
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
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
