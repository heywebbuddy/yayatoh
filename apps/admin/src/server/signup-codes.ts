import 'server-only';
import { getUsersByIds } from '@yayatoh/auth';
import { withPlatformReader } from '@yayatoh/db/platform';
import { hashSignupCode, randomSignupCode } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import type { Staff } from './staff.ts';

export type SignupCodeState = 'active' | 'used_up' | 'expired' | 'revoked';

/** One row of the signup-code list: an explicit allowlist (never the hash). */
export interface SignupCodeRow {
  readonly id: string;
  readonly note: string;
  readonly maxUses: number;
  readonly uses: number;
  readonly usesLeft: number;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly revokedAt: Date | null;
  readonly revokedBy: string | null;
  readonly state: SignupCodeState;
}

export function signupCodeState(
  r: { uses: number; maxUses: number; expiresAt: Date; revokedAt: Date | null },
  now: Date,
): SignupCodeState {
  if (r.revokedAt) return 'revoked';
  if (r.uses >= r.maxUses) return 'used_up';
  if (r.expiresAt <= now) return 'expired';
  return 'active';
}

/** `staff:<id>` → the staff member's name; anything else (`staff:cli`) as it is. */
export async function actorNames(actors: readonly string[]): Promise<Map<string, string>> {
  const id = (a: string) => /^staff:([0-9a-f-]{36})$/.exec(a)?.[1] ?? null;
  const users = await getUsersByIds(actors.map(id).filter((x): x is string => x !== null));
  return new Map(actors.map((a) => [a, users.get(id(a) ?? '')?.name ?? a]));
}

/** The latest codes (platform_reader through `platform.list_signup_codes`, audited). */
export async function listSignupCodes(staff: Staff, now = new Date()): Promise<SignupCodeRow[]> {
  const rows = await withPlatformReader(
    { actor: staff.actor, reason: 'staff console: list signup codes' },
    (tx) =>
      tx.execute<{
        id: string;
        max_uses: number;
        uses: number;
        expires_at: string;
        revoked_at: string | null;
        revoked_by: string | null;
        note: string;
        created_by: string;
        created_at: string;
      }>(sql`select * from platform.list_signup_codes(200)`),
  );
  const names = await actorNames([
    ...new Set(rows.flatMap((r) => [r.created_by, ...(r.revoked_by ? [r.revoked_by] : [])])),
  ]);
  return rows.map((r) => {
    const base = {
      uses: r.uses,
      maxUses: r.max_uses,
      expiresAt: new Date(r.expires_at),
      revokedAt: r.revoked_at ? new Date(r.revoked_at) : null,
    };
    return {
      ...base,
      id: r.id,
      note: r.note,
      usesLeft: Math.max(0, r.max_uses - r.uses),
      createdAt: new Date(r.created_at),
      createdBy: names.get(r.created_by) ?? r.created_by,
      revokedBy: r.revoked_by ? (names.get(r.revoked_by) ?? r.revoked_by) : null,
      state: signupCodeState(base, now),
    };
  });
}

/**
 * Create a code (the worker CLI's `createSignupCode`, from the console). Only the hash is stored;
 * the code is returned once and never shown again. Audited in the platform access log.
 */
export async function createSignupCode(
  staff: Staff,
  input: { maxUses: number; days: number; note: string },
): Promise<{ id: string; code: string; expiresAt: Date }> {
  const code = randomSignupCode();
  const expiresAt = new Date(Date.now() + input.days * 86_400_000);
  const [row] = await withPlatformReader(
    {
      actor: staff.actor,
      reason: `staff console: create signup code (${input.maxUses} uses, ${input.days} days): ${input.note}`,
    },
    (tx) =>
      tx.execute<{ id: string }>(
        sql`select platform.create_signup_code(${hashSignupCode(code)}, ${input.maxUses}, ${expiresAt.toISOString()}::timestamptz, ${input.note}, ${staff.actor}) as id`,
      ),
    { callsWritingFunctions: true },
  );
  if (!row) throw new Error('signup code not created');
  return { id: row.id, code, expiresAt };
}

/** Revoke a code (idempotent). True when this call revoked it. Audited in the access log. */
export async function revokeSignupCode(staff: Staff, id: string): Promise<boolean> {
  const [row] = await withPlatformReader(
    { actor: staff.actor, reason: `staff console: revoke signup code ${id}` },
    (tx) =>
      tx.execute<{ revoked: boolean }>(
        sql`select platform.revoke_signup_code(${id}::uuid, ${staff.actor}) as revoked`,
      ),
    { callsWritingFunctions: true },
  );
  return row?.revoked === true;
}
