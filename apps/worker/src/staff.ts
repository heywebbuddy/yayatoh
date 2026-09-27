import { withPlatformReader } from '@yayatoh/db/platform';
import { STAFF_ROLES } from '@yayatoh/platform';
import { sql } from 'drizzle-orm';

export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * Add, change or revoke (role null) a platform staff member by email. Staff come only from the
 * owner-approved list (roadmap D10); the person must already have an account. Audited.
 */
export async function setStaff(opts: { email: string; role: StaffRole | null; by: string }): Promise<string> {
  if (opts.role !== null && !STAFF_ROLES.includes(opts.role)) throw new Error(`unknown role ${opts.role}`);
  const [row] = await withPlatformReader(
    {
      actor: opts.by,
      reason: `${opts.role ? `set staff role ${opts.role}` : 'revoke staff'}: ${opts.email}`,
    },
    (tx) =>
      tx.execute<{ id: string }>(
        sql`select platform.set_staff(${opts.email}, ${opts.role}, ${opts.by}) as id`,
      ),
    { callsWritingFunctions: true },
  );
  if (!row) throw new Error('staff not set');
  return row.id;
}
