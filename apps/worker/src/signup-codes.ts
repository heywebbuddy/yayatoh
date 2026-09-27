import { randomBytes } from 'node:crypto';
import { withPlatformReader } from '@yayatoh/db/platform';
import { hashSignupCode } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A human-friendly code, e.g. YY-7KQ4-M2XR-P9TD (60 bits of randomness). */
export function randomSignupCode(): string {
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `YY-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

/**
 * Create a signup code (platform staff: the worker CLI now, apps/admin in M1.3e). The code is
 * returned once; only its hash is stored. Audited through the platform-reader sink.
 */
export async function createSignupCode(opts: {
  code?: string;
  maxUses: number;
  days: number;
  note: string;
  createdBy: string;
}): Promise<{ id: string; code: string; expiresAt: Date }> {
  const code = opts.code ?? randomSignupCode();
  const expiresAt = new Date(Date.now() + opts.days * 86_400_000);
  const [row] = await withPlatformReader(
    { actor: opts.createdBy, reason: `create signup code (${opts.maxUses} uses): ${opts.note}` },
    (tx) =>
      tx.execute<{ id: string }>(
        sql`select platform.create_signup_code(${hashSignupCode(code)}, ${opts.maxUses}, ${expiresAt.toISOString()}::timestamptz, ${opts.note}, ${opts.createdBy}) as id`,
      ),
    { callsWritingFunctions: true },
  );
  if (!row) throw new Error('signup code not created');
  return { id: row.id, code, expiresAt };
}
