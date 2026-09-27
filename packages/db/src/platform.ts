// Restricted entry point: only apps/admin and apps/worker may import `@yayatoh/db/platform`
// (enforced by tools/check-modules). platform_reader bypasses RLS; every use is audited.
import { sql } from 'drizzle-orm';
import { pool } from './client.ts';
import type { TenantTx } from './tenant.ts';

export interface PlatformAccess {
  /** Who is reading, e.g. `user:<id>` for staff or `system:relay` for the worker. */
  readonly actor: string;
  /** Why, in words that make sense in an audit review. */
  readonly reason: string;
}

export type PlatformAuditSink = (entry: PlatformAccess & { at: Date }) => Promise<void>;

let auditSink: PlatformAuditSink | null = null;

/** Register where platform reads are audited. Required before `withPlatformReader` can run. */
export function setPlatformAuditSink(sink: PlatformAuditSink): void {
  auditSink = sink;
}

export interface PlatformOptions {
  /**
   * Allow the transaction to call the migration-granted SECURITY DEFINER functions that write
   * (e.g. `platform.relay_stamp`). platform_reader has no direct write privileges on any table.
   */
  readonly callsWritingFunctions?: boolean;
}

export async function withPlatformReader<T>(
  access: PlatformAccess,
  fn: (tx: TenantTx) => Promise<T>,
  options: PlatformOptions = {},
): Promise<T> {
  if (!auditSink) throw new Error('withPlatformReader: no audit sink registered');
  if (!access.reason.trim()) throw new Error('withPlatformReader: a reason is required');
  await auditSink({ ...access, at: new Date() });
  return pool('platformReader').db.transaction(async (tx) => {
    if (!options.callsWritingFunctions) await tx.execute(sql`set transaction read only`);
    return fn(tx as unknown as TenantTx);
  });
}

/**
 * Single-leader election with a session-level advisory lock on a reserved (direct) connection.
 * Returns a release function when this process is the leader, or null.
 */
export async function tryAcquireLeadership(name: string): Promise<(() => Promise<void>) | null> {
  const conn = await pool('platformReader').sql.reserve();
  const [row] = await conn<{ ok: boolean }[]>`select pg_try_advisory_lock(hashtext(${name})) as ok`;
  if (!row?.ok) {
    conn.release();
    return null;
  }
  return async () => {
    await conn`select pg_advisory_unlock(hashtext(${name}))`;
    conn.release();
  };
}
