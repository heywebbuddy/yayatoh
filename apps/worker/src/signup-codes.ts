import { withPlatformReader } from '@yayatoh/db/platform';
import { hashSignupCode, randomSignupCode } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';

/** The generator lives in tenancy (the staff console uses it too); re-exported for the CLI. */
export { randomSignupCode };

/**
 * Create a signup code (platform staff: this CLI; the staff console has its own screen, M1.3f). The code is
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
