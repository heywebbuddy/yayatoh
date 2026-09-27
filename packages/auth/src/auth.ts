import { identityDatabase } from '@yayatoh/db/identity';
import { uuidv7 } from '@yayatoh/kernel';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { bearer, emailOTP, magicLink, twoFactor } from 'better-auth/plugins';
import type { AuthMailer } from './mailer.ts';
import { hashPassword, needsRehash, verifyPassword } from './password.ts';
import { authSchema } from './schema.ts';

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
}

export const SESSION_COOKIE_BASENAME = 'yy.session';

/**
 * Identity for one host (ADR 0010). Sessions use a `__Host-` cookie on HTTPS: Secure, Path=/,
 * no Domain, so a session is valid only on the host that issued it. Passwords hash with
 * Argon2id; migrated Laravel `$2y$` hashes verify and are rehashed on first sign-in.
 */
export function createAuth(opts: AuthOptions) {
  if (opts.secret.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');
  const secure = opts.baseURL.startsWith('https://');
  return betterAuth({
    appName: 'Yayatoh',
    baseURL: opts.baseURL,
    secret: opts.secret,
    trustedOrigins: [...(opts.trustedOrigins ?? [])],
    telemetry: { enabled: false },
    database: drizzleAdapter(identityDatabase(), { provider: 'pg', schema: authSchema }),
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
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: { '/sign-in/*': { window: 60, max: 10 } },
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
      // Rehash migrated Laravel bcrypt passwords to Argon2id after a successful sign-in.
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') return;
        const userId = ctx.context.newSession?.user.id;
        const password = (ctx.body as { password?: unknown } | undefined)?.password;
        if (!userId || typeof password !== 'string') return;
        const accounts = await ctx.context.internalAdapter.findAccounts(userId);
        const credential = accounts.find((a) => a.providerId === 'credential');
        if (credential?.password && needsRehash(credential.password)) {
          await ctx.context.internalAdapter.updatePassword(userId, await hashPassword(password));
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
      twoFactor({ issuer: 'Yayatoh' }),
      bearer(),
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
