import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { identityDatabase } from '@yayatoh/db/identity';
import { uuidv7 } from '@yayatoh/kernel';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { desc, eq } from 'drizzle-orm';
import { type Auth, consumeTotpStep } from './auth.ts';
import type { AuthMailer } from './mailer.ts';
import { securityEvents, twoFactors } from './schema.ts';
import {
  generateBackupCodes,
  generateTotpSecret,
  matchTotpStep,
  normalizeBackupCode,
  otpauthUri,
  setupKey,
} from './totp.ts';

/**
 * Two-step verification (TOTP) for people, on Better Auth's `two_factors` table so its sign-in
 * challenge (`/two-factor/verify-totp`, `/verify-backup-code`) reads what we enrol. Everything
 * else goes through here rather than Better Auth's management endpoints (closed over HTTP): the
 * app's rules differ (turning off needs a current code, step-up instead of a password to begin,
 * rate limits on every code, an audit row for every change).
 */
export type TwoFactorErrorCode =
  | 'invalid_code'
  | 'invalid_password'
  | 'rate_limited'
  | 'not_enabled'
  | 'already_enabled'
  | 'not_pending';

export class TwoFactorError extends Error {
  readonly code: TwoFactorErrorCode;
  constructor(code: TwoFactorErrorCode) {
    super(code);
    this.name = 'TwoFactorError';
    this.code = code;
  }
}

export const isTwoFactorError = (e: unknown): e is TwoFactorError => e instanceof TwoFactorError;

/** How a person confirms it's them: their authenticator (if set up), else their password, else an emailed code. */
export type StepUpMethod = 'totp' | 'password' | 'email';

export type StepUpProof =
  | { readonly method: 'totp'; readonly code: string }
  | { readonly method: 'password'; readonly password: string }
  | { readonly method: 'email'; readonly code: string };

export type SecurityAction =
  | 'two_factor.setup_started'
  | 'two_factor.enabled'
  | 'two_factor.disabled'
  | 'two_factor.backup_codes_regenerated'
  | 'two_factor.backup_code_used'
  | 'two_factor.challenge_passed'
  | 'two_factor.replay_refused'
  | 'step_up.confirmed'
  | 'step_up.failed'
  | 'sessions.revoked_all';

export interface TwoFactorStatus {
  readonly enabled: boolean;
  /** Set up started (secret issued) but not confirmed with a code yet. */
  readonly pending: boolean;
  readonly backupCodesLeft: number;
  readonly method: StepUpMethod;
}

/** Failed codes per person before a pause, and the pause (every code: set up, turn off, step-up). */
export const CODE_ATTEMPTS = 5;
export const CODE_ATTEMPT_WINDOW_MS = 15 * 60_000;
const EMAIL_CODE_TTL_MS = 10 * 60_000;

interface TwoFactorRow {
  id: string;
  userId: string;
  secret: string;
  backupCodes: string;
  verified: boolean | null;
}

interface BackupCodeCodec {
  encrypt(json: string): Promise<string>;
  decrypt(stored: string): Promise<string>;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const sameHex = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export interface TwoFactorServiceOptions {
  readonly mailer: AuthMailer;
  readonly issuer?: string;
  readonly now?: () => Date;
  /** Development only: people whose codes may be reused (see AuthOptions.totpReplayExempt). */
  readonly totpReplayExempt?: (user: { id: string; email: string }, secret: string) => boolean;
}

export function twoFactorService(auth: Auth, opts: TwoFactorServiceOptions) {
  const issuer = opts.issuer ?? 'Yayatoh';
  const now = opts.now ?? (() => new Date());
  const context = () => auth.$context;

  /** The backup-code storage Better Auth's plugin is configured with (the KMS sealer, or its own key). */
  async function codec(): Promise<BackupCodeCodec> {
    const c = await context();
    const store = (
      c.getPlugin('two-factor')?.options as { backupCodeOptions?: { storeBackupCodes?: unknown } } | undefined
    )?.backupCodeOptions?.storeBackupCodes;
    if (store && typeof store === 'object' && 'encrypt' in store && 'decrypt' in store)
      return store as BackupCodeCodec;
    return {
      encrypt: (json) => symmetricEncrypt({ key: c.secretConfig, data: json }),
      decrypt: (stored) => symmetricDecrypt({ key: c.secretConfig, data: stored }),
    };
  }

  async function row(userId: string): Promise<TwoFactorRow | null> {
    const c = await context();
    return c.adapter.findOne<TwoFactorRow>({
      model: 'twoFactor',
      where: [{ field: 'userId', value: userId }],
    });
  }

  async function secretOf(r: TwoFactorRow): Promise<string> {
    const c = await context();
    return symmetricDecrypt({ key: c.secretConfig, data: r.secret });
  }

  async function backupCodesOf(r: TwoFactorRow): Promise<string[]> {
    try {
      const parsed: unknown = JSON.parse(await (await codec()).decrypt(r.backupCodes));
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  async function enabled(userId: string): Promise<boolean> {
    const c = await context();
    const user = await c.internalAdapter.findUserById(userId);
    return Boolean((user as { twoFactorEnabled?: boolean | null } | null)?.twoFactorEnabled);
  }

  async function record(userId: string, action: SecurityAction, data: Record<string, unknown> = {}) {
    await identityDatabase()
      .insert(securityEvents)
      .values({ id: uuidv7(), userId, action, data, createdAt: now() });
  }

  // Rate limit: a failure counter per person in the verifications table, reset by a success.
  const limiterKey = (userId: string) => `yy-code-failures:${userId}`;
  async function assertNotLimited(userId: string) {
    const c = await context();
    const v = await c.internalAdapter.findVerificationValue(limiterKey(userId));
    if (v && v.expiresAt > now() && Number(v.value) >= CODE_ATTEMPTS)
      throw new TwoFactorError('rate_limited');
  }
  async function failed(userId: string, code: TwoFactorErrorCode): Promise<never> {
    const c = await context();
    const key = limiterKey(userId);
    const v = await c.internalAdapter.findVerificationValue(key);
    if (v && v.expiresAt > now()) {
      await c.internalAdapter.updateVerificationByIdentifier(key, { value: String(Number(v.value) + 1) });
    } else {
      if (v) await c.internalAdapter.deleteVerificationByIdentifier(key);
      await c.internalAdapter.createVerificationValue({
        identifier: key,
        value: '1',
        expiresAt: new Date(now().getTime() + CODE_ATTEMPT_WINDOW_MS),
      });
    }
    throw new TwoFactorError(code);
  }
  async function succeeded(userId: string) {
    const c = await context();
    await c.internalAdapter.deleteVerificationByIdentifier(limiterKey(userId));
  }

  /**
   * A TOTP code whose time step hasn't been used yet (replay protection: each code works once,
   * even inside its window). A reused code is refused and audited.
   */
  async function totpAccepted(r: TwoFactorRow, input: string, purpose: string): Promise<boolean | null> {
    const secret = await secretOf(r);
    const step = matchTotpStep(secret, input, now().getTime());
    if (step === null) return null;
    if (opts.totpReplayExempt) {
      const c = await context();
      const user = await c.internalAdapter.findUserById(r.userId);
      if (user && opts.totpReplayExempt({ id: user.id, email: user.email }, secret)) return true;
    }
    if (await consumeTotpStep(r.userId, step)) return true;
    await record(r.userId, 'two_factor.replay_refused', { purpose });
    return false;
  }

  /** A TOTP code, or a backup code (spent on use). Returns which one matched, or null. */
  async function checkCode(
    r: TwoFactorRow,
    input: string,
    purpose: string,
  ): Promise<'totp' | 'backup_code' | null> {
    const totpOk = await totpAccepted(r, input, purpose);
    if (totpOk) return 'totp';
    if (totpOk === false) return null;
    const backup = normalizeBackupCode(input);
    if (!backup) return null;
    const codes = await backupCodesOf(r);
    if (!codes.includes(backup)) return null;
    const c = await context();
    // Compare-and-swap on the stored value: two requests cannot spend the same code.
    const spent = await c.adapter.incrementOne({
      model: 'twoFactor',
      where: [
        { field: 'id', value: r.id },
        { field: 'backupCodes', value: r.backupCodes },
      ],
      increment: {},
      set: { backupCodes: await (await codec()).encrypt(JSON.stringify(codes.filter((x) => x !== backup))) },
    });
    return spent ? 'backup_code' : null;
  }

  async function method(userId: string): Promise<StepUpMethod> {
    if (await enabled(userId)) return 'totp';
    const c = await context();
    const credential = await c.internalAdapter.findCredentialAccount(userId);
    return credential?.password ? 'password' : 'email';
  }

  return {
    record,

    /** Whether the person has two-step verification on, a pending set-up, and codes left. */
    async status(userId: string): Promise<TwoFactorStatus> {
      const [on, r, m] = await Promise.all([enabled(userId), row(userId), method(userId)]);
      return {
        enabled: on && Boolean(r?.verified),
        pending: Boolean(r && r.verified === false),
        backupCodesLeft: r && on ? (await backupCodesOf(r)).length : 0,
        method: m,
      };
    },

    /** How this person confirms it's them (for the step-up dialog). */
    method,

    /**
     * Start set-up: a new secret (replacing any unconfirmed one). Returns the setup key and the
     * otpauth URI for the QR code; nothing is on until `confirm` gets a valid code. `secret` is
     * for the dev seed and tests only.
     */
    async begin(userId: string, email: string, seed?: { secret: string }) {
      if (await enabled(userId)) throw new TwoFactorError('already_enabled');
      const c = await context();
      const secret = seed?.secret ?? generateTotpSecret();
      const data = {
        secret: await symmetricEncrypt({ key: c.secretConfig, data: secret }),
        backupCodes: await (await codec()).encrypt('[]'),
        verified: false,
        failedVerificationCount: 0,
        lockedUntil: null,
      };
      const existing = await row(userId);
      if (existing)
        await c.adapter.update({
          model: 'twoFactor',
          where: [{ field: 'id', value: existing.id }],
          update: data,
        });
      else await c.adapter.create({ model: 'twoFactor', data: { ...data, userId } });
      // A new secret starts with no used codes.
      await identityDatabase()
        .update(twoFactors)
        .set({ lastUsedStep: null })
        .where(eq(twoFactors.userId, userId));
      await record(userId, 'two_factor.setup_started');
      return { setupKey: setupKey(secret), uri: otpauthUri({ issuer, account: email, secret }) };
    },

    /** Confirm set-up with a code from the app: turns it on and returns fresh backup codes (shown once). */
    async confirm(userId: string, code: string): Promise<{ backupCodes: string[] }> {
      await assertNotLimited(userId);
      const r = await row(userId);
      if (r?.verified !== false) throw new TwoFactorError('not_pending');
      if (!(await totpAccepted(r, code, 'setup'))) return failed(userId, 'invalid_code');
      const c = await context();
      const backupCodes = generateBackupCodes();
      await c.adapter.update({
        model: 'twoFactor',
        where: [{ field: 'id', value: r.id }],
        update: {
          verified: true,
          backupCodes: await (await codec()).encrypt(JSON.stringify(backupCodes)),
        },
      });
      await c.internalAdapter.updateUser(userId, { twoFactorEnabled: true });
      await succeeded(userId);
      await record(userId, 'two_factor.enabled');
      return { backupCodes };
    },

    /** Turn it off with a current code (TOTP or a backup code). The caller checks role requirements first. */
    async disable(userId: string, code: string) {
      await assertNotLimited(userId);
      const r = await row(userId);
      if (!r || !(await enabled(userId))) throw new TwoFactorError('not_enabled');
      const used = await checkCode(r, code, 'disable');
      if (!used) return failed(userId, 'invalid_code');
      const c = await context();
      await c.adapter.delete({ model: 'twoFactor', where: [{ field: 'userId', value: userId }] });
      await c.internalAdapter.updateUser(userId, { twoFactorEnabled: false });
      await succeeded(userId);
      if (used === 'backup_code') await record(userId, 'two_factor.backup_code_used', { purpose: 'disable' });
      await record(userId, 'two_factor.disabled', { method: used });
    },

    /** Replace the backup codes (the old ones stop working). The caller requires a step-up. */
    async regenerateBackupCodes(userId: string): Promise<string[]> {
      const r = await row(userId);
      if (!r || !(await enabled(userId))) throw new TwoFactorError('not_enabled');
      const c = await context();
      const backupCodes = generateBackupCodes();
      await c.adapter.update({
        model: 'twoFactor',
        where: [{ field: 'id', value: r.id }],
        update: { backupCodes: await (await codec()).encrypt(JSON.stringify(backupCodes)) },
      });
      await record(userId, 'two_factor.backup_codes_regenerated');
      return backupCodes;
    },

    /** Email a one-time code for step-up (people with neither an authenticator nor a password). */
    async sendStepUpEmail(userId: string, email: string) {
      const c = await context();
      const key = `yy-step-up-email:${userId}`;
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await c.internalAdapter.deleteVerificationByIdentifier(key);
      await c.internalAdapter.createVerificationValue({
        identifier: key,
        value: sha256(code),
        expiresAt: new Date(now().getTime() + EMAIL_CODE_TTL_MS),
      });
      await opts.mailer.sendOtp(email, code, 'step-up');
    },

    /**
     * Check a step-up proof and mark the session stepped up (the fresh window restarts). The
     * method must be the person's own: an authenticator user cannot fall back to a password.
     */
    async stepUp(input: { userId: string; sessionToken: string; proof: StepUpProof }): Promise<Date> {
      const { userId, proof } = input;
      await assertNotLimited(userId);
      const expected = await method(userId);
      if (proof.method !== expected) throw new TwoFactorError('invalid_code');
      const c = await context();
      let used: string;
      if (proof.method === 'totp') {
        const r = await row(userId);
        const matched = r ? await checkCode(r, proof.code, 'step_up') : null;
        if (!matched) {
          await record(userId, 'step_up.failed', { method: 'totp' });
          return failed(userId, 'invalid_code');
        }
        if (matched === 'backup_code')
          await record(userId, 'two_factor.backup_code_used', { purpose: 'step_up' });
        used = matched;
      } else if (proof.method === 'password') {
        const credential = await c.internalAdapter.findCredentialAccount(userId);
        const ok =
          proof.password.length > 0 &&
          proof.password.length <= 128 &&
          credential?.password !== undefined &&
          credential?.password !== null &&
          (await c.password.verify({ hash: credential.password, password: proof.password }));
        if (!ok) {
          await record(userId, 'step_up.failed', { method: 'password' });
          return failed(userId, 'invalid_password');
        }
        used = 'password';
      } else {
        const key = `yy-step-up-email:${userId}`;
        const v = await c.internalAdapter.findVerificationValue(key);
        const code = proof.code.replace(/\s/g, '');
        if (!v || v.expiresAt <= now() || !/^\d{6}$/.test(code) || !sameHex(v.value, sha256(code))) {
          await record(userId, 'step_up.failed', { method: 'email' });
          return failed(userId, 'invalid_code');
        }
        await c.internalAdapter.deleteVerificationByIdentifier(key);
        used = 'email';
      }
      const at = now();
      await c.internalAdapter.updateSession(input.sessionToken, { stepUpAt: at });
      await succeeded(userId);
      await record(userId, 'step_up.confirmed', { method: used });
      return at;
    },

    /**
     * Sign out everywhere: every session of this person on every host (the app, tenant sites,
     * API clients) ends, including the current one. Audited.
     */
    async signOutEverywhere(userId: string): Promise<void> {
      const c = await context();
      await c.internalAdapter.deleteUserSessions(userId);
      await record(userId, 'sessions.revoked_all');
    },

    /**
     * Development tools only (`/api/dev/*`, 404 outside dev auth): forget which authenticator
     * codes this person used, as if their last one was long ago. Test accounts are enrolled and
     * signed in by the tools with the same current code the test then types.
     */
    async forgetUsedCodes(userId: string): Promise<void> {
      await identityDatabase()
        .update(twoFactors)
        .set({ lastUsedStep: null })
        .where(eq(twoFactors.userId, userId));
    },

    /** Recent security events for a person (newest first). */
    async events(userId: string, limit = 20) {
      return identityDatabase()
        .select({
          action: securityEvents.action,
          data: securityEvents.data,
          createdAt: securityEvents.createdAt,
        })
        .from(securityEvents)
        .where(eq(securityEvents.userId, userId))
        .orderBy(desc(securityEvents.createdAt), desc(securityEvents.id))
        .limit(limit);
    },
  };
}

export type TwoFactorService = ReturnType<typeof twoFactorService>;

export type ChallengeError = 'invalid_code' | 'too_many_attempts' | 'locked' | 'expired';

/**
 * The second step of a sign-in (password, emailed code or magic link done; a code pending):
 * checks a TOTP or a backup code against the signed `two_factor` cookie in `headers` and, on
 * success, Better Auth sets the session cookie. Wrong codes are limited per challenge (5, then
 * sign in again) and per account (10 in a row lock it for 15 minutes).
 */
export async function verifySignInChallenge(
  auth: Auth,
  headers: Headers,
  input: { kind: 'totp' | 'backup_code'; code: string },
): Promise<{ ok: true; userId: string } | { ok: false; error: ChallengeError }> {
  try {
    if (input.kind === 'backup_code') {
      const code = normalizeBackupCode(input.code);
      if (!code) return { ok: false, error: 'invalid_code' };
      const r = await auth.api.verifyBackupCode({ body: { code }, headers });
      return { ok: true, userId: r.user.id };
    }
    const r = await auth.api.verifyTOTP({ body: { code: input.code.replace(/\s/g, '') }, headers });
    return { ok: true, userId: r.user.id };
  } catch (err) {
    const code = (err as { body?: { code?: string } } | null)?.body?.code;
    if (code === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE') return { ok: false, error: 'too_many_attempts' };
    if (code === 'ACCOUNT_TEMPORARILY_LOCKED') return { ok: false, error: 'locked' };
    if (code === 'INVALID_TWO_FACTOR_COOKIE' || code === 'TOTP_NOT_ENABLED')
      return { ok: false, error: 'expired' };
    if (code === 'INVALID_CODE' || code === 'INVALID_BACKUP_CODE')
      return { ok: false, error: 'invalid_code' };
    throw err;
  }
}
