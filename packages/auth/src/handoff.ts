import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { identityDatabase } from '@yayatoh/db/identity';
import { uuidv7 } from '@yayatoh/kernel';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { handoffCodes } from './schema.ts';

/**
 * Central login (M1.2d, roadmap §4.2). Tenant hosts (custom domains, `{slug}.yayatoh.events`)
 * never sign people in themselves: the app host does, then hands the person back with a one-time
 * code that the tenant host redeems server-side for its own host-only session cookie.
 *
 * A code is 32 random bytes (base64url). Only its SHA-256 is stored. It is bound to one host and
 * one person, works once and lives 60 seconds; codes from a tenant's "Sign in" are also bound to
 * that browser (a state cookie on the tenant host), so nobody can sign someone else in.
 */
export const HANDOFF_TTL_MS = 60_000;

/** What a refused redemption was (audited; the person only ever sees one generic message). */
export type HandoffRefusal = 'unknown' | 'used' | 'expired' | 'wrong_host' | 'wrong_state' | 'ended';

const CODE = /^[A-Za-z0-9_-]{43}$/;

/** A new code (and state values for the tenant host's cookie): 256 random bits, base64url. */
export const newHandoffCode = (): string => randomBytes(32).toString('base64url');

/** Codes (and states) are stored as SHA-256 hex; the code itself never is. */
export const hashHandoffCode = (code: string): string => createHash('sha256').update(code).digest('hex');

/** The shape of a code (anything else is refused without a lookup). */
export const isHandoffCode = (value: string): boolean => CODE.test(value);

/** Past its 60 seconds (the moment it expires counts as expired). */
export const handoffExpired = (expiresAt: Date, now: Date): boolean => now.getTime() >= expiresAt.getTime();

/** A Host header as codes store it: lowercased, no trailing dot, port kept (null if malformed). */
export function normalizeHandoffHost(host: string | null | undefined): string | null {
  const h = (host ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.(?=:\d+$|$)/, '');
  return /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::\d{1,5})?$/.test(h) ? h : null;
}

/** A same-host path to land on after the handoff (never another origin); `/` otherwise. */
export function safeReturnPath(path: string | null | undefined): string {
  const p = path ?? '';
  if (!p.startsWith('/') || p.startsWith('//') || p.includes('\\') || p.length > 2048) return '/';
  for (let i = 0; i < p.length; i++) {
    const c = p.charCodeAt(i);
    if (c < 32 || c === 127) return '/';
  }
  return p;
}

/** Whether a state value matches the stored hash (constant time). */
export function stateMatches(state: string | null | undefined, stateHash: string): boolean {
  if (!state || !CODE.test(state)) return false;
  const a = Buffer.from(hashHandoffCode(state));
  const b = Buffer.from(stateHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface IssueHandoffInput {
  readonly userId: string;
  /** The host that may redeem it (see normalizeHandoffHost). */
  readonly host: string;
  readonly returnPath: string;
  /** The tenant host's sign-in state (its cookie holds the same value); null for staff codes. */
  readonly state?: string | null;
  readonly impersonationId?: string | null;
  readonly now?: Date;
}

/** Issue a code (the app host, after sign-in; or the staff console for an impersonation). */
export async function issueHandoff(input: IssueHandoffInput): Promise<{ code: string; expiresAt: Date }> {
  const host = normalizeHandoffHost(input.host);
  if (!host) throw new Error('Invalid handoff host');
  const now = input.now ?? new Date();
  const code = newHandoffCode();
  const expiresAt = new Date(now.getTime() + HANDOFF_TTL_MS);
  await identityDatabase()
    .insert(handoffCodes)
    .values({
      id: uuidv7(),
      codeHash: hashHandoffCode(code),
      userId: input.userId,
      host,
      returnPath: safeReturnPath(input.returnPath),
      stateHash: input.state ? hashHandoffCode(input.state) : null,
      impersonationId: input.impersonationId ?? null,
      expiresAt,
      createdAt: now,
    });
  return { code, expiresAt };
}

export type ConsumedHandoff = typeof handoffCodes.$inferSelect;

/**
 * Spend a code: marks it used in the same statement that finds it, so two requests can never
 * both redeem it. Any attempt spends it, even one that is then refused (wrong host, expired).
 * Returns the row, or `{ refused: 'used' | 'unknown' }` with the owner when one exists.
 */
export async function consumeHandoff(
  code: string,
  now: Date,
): Promise<{ row: ConsumedHandoff } | { refused: 'used' | 'unknown'; userId: string | null }> {
  if (!isHandoffCode(code)) return { refused: 'unknown', userId: null };
  const codeHash = hashHandoffCode(code);
  const db = identityDatabase();
  const [row] = await db
    .update(handoffCodes)
    .set({ usedAt: now })
    .where(and(eq(handoffCodes.codeHash, codeHash), isNull(handoffCodes.usedAt)))
    .returning();
  if (row) return { row };
  const [seen] = await db
    .select({ userId: handoffCodes.userId })
    .from(handoffCodes)
    .where(eq(handoffCodes.codeHash, codeHash));
  return seen ? { refused: 'used', userId: seen.userId } : { refused: 'unknown', userId: null };
}

/** Housekeeping: codes older than a day are gone (used or not). */
export async function purgeHandoffCodes(now: Date = new Date()): Promise<number> {
  const rows = await identityDatabase()
    .delete(handoffCodes)
    .where(lt(handoffCodes.expiresAt, new Date(now.getTime() - 86_400_000)))
    .returning({ id: handoffCodes.id });
  return rows.length;
}
