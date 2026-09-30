import 'server-only';
import { databaseAuditSink, setPlatformAuditSink, withPlatformReader } from '@yayatoh/db/platform';
import { type Ctx, createCtx } from '@yayatoh/kernel';
import { sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getAuth } from './auth.ts';
import { type StaffAction, type StaffRole, staffCan } from './staff-roles.ts';

// Every platform_reader use from the console lands in platform.access_log before it runs.
setPlatformAuditSink(databaseAuditSink);

export type { StaffAction, StaffRole } from './staff-roles.ts';

export interface Staff {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly role: StaffRole;
  /** The audited actor string for platform reads and commands. */
  readonly actor: string;
  can(action: StaffAction): boolean;
  /**
   * A command context for one org, acting as this staff member (a platform actor). `stepUpAt`:
   * when they last confirmed it's them (commands that check it themselves, M1.13d).
   */
  ctx(orgId: string, stepUpAt?: Date): Ctx;
}

/** The signed-in person, if they are active staff; `null` for anyone else. */
export const currentStaff = cache(async (): Promise<Staff | 'signed_out' | null> => {
  const h = await headers();
  const s = await getAuth().api.getSession({ headers: h });
  if (!s) return 'signed_out';
  const actor = `staff:${s.user.id}`;
  const [row] = await withPlatformReader({ actor, reason: 'staff console: check staff role' }, (tx) =>
    tx.execute<{ role: StaffRole }>(
      sql`select role from platform.staff where user_id = ${s.user.id} and revoked_at is null`,
    ),
  );
  if (!row) return null;
  const role = row.role;
  return {
    userId: s.user.id,
    name: s.user.name,
    email: s.user.email,
    role,
    actor,
    can: (a) => staffCan(role, a),
    ctx: (orgId, stepUpAt) =>
      createCtx({ orgId, actor: { type: 'system', name: actor }, ...(stepUpAt ? { stepUpAt } : {}) }),
  };
});

/** For pages and actions: active staff or a redirect (signed out) / 404-style refusal. */
export async function requireStaff(action: StaffAction = 'view'): Promise<Staff> {
  const s = await currentStaff();
  if (s === 'signed_out') redirect('/sign-in');
  if (!s) redirect('/not-staff');
  if (!s.can(action)) redirect('/not-staff');
  return s;
}
