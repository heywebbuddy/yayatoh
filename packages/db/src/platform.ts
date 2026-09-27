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

export async function withPlatformReader<T>(
  access: PlatformAccess,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!auditSink) throw new Error('withPlatformReader: no audit sink registered');
  if (!access.reason.trim()) throw new Error('withPlatformReader: a reason is required');
  await auditSink({ ...access, at: new Date() });
  return pool('platformReader').db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    return fn(tx as unknown as TenantTx);
  });
}
