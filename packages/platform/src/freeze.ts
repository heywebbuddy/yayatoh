import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { type CommandPorts, DomainError } from '@yayatoh/kernel';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

/**
 * The read-only freeze of the new app (M2.5a, roadmap §7.8): during a cutover or a rollback every
 * write command is refused with `read_only_freeze` (503 + Retry-After), while reads, offline
 * check-in scans (`duringFreeze: 'allowed'`) and public pages keep working. Platform-wide, or for
 * listed orgs only (the B-A tenant import freezes only ABC and its affiliates). Stored in
 * `platform.ops_flags`; staff switch it in the console (audited, step-up) and the cutover tool
 * during the runbook.
 */
export interface FreezeState {
  readonly scope: 'platform' | 'orgs';
  readonly orgIds: readonly string[];
  /** When the freeze went on. */
  readonly since: Date;
  /** The announced end (the banner and Retry-After use it), if any. */
  readonly expectedEndAt: Date | null;
}

/** The stored value of `read_only_freeze` (what staff and the cutover tool write). */
export const FreezeValue = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('platform'), expectedEndAt: z.iso.datetime().nullish() }),
  z.object({
    scope: z.literal('orgs'),
    orgIds: z.array(z.uuid()).min(1).max(1000),
    expectedEndAt: z.iso.datetime().nullish(),
  }),
]);
export type FreezeValue = z.infer<typeof FreezeValue>;

/** Host routing target during the cutover (`host_route:<host>`): the web front door reads it. */
export const HostTarget = z.enum(['next', 'legacy']);
export type HostTarget = z.infer<typeof HostTarget>;

/** Retry-After when no end was announced: five minutes. */
export const FREEZE_DEFAULT_RETRY_SECONDS = 300;

export async function readOnlyFreezeTx(tx: TenantTx): Promise<FreezeState | null> {
  const rows = await tx.execute<{
    scope: 'platform' | 'orgs';
    org_ids: string[] | null;
    since: string | Date;
    expected_end_at: string | Date | null;
  }>(sql`select scope, org_ids, since, expected_end_at from platform.read_only_freeze()`);
  const r = rows[0];
  if (!r) return null;
  return {
    scope: r.scope,
    orgIds: r.org_ids ?? [],
    since: new Date(r.since),
    expectedEndAt: r.expected_end_at ? new Date(r.expected_end_at) : null,
  };
}

/** The current freeze, if any (one primary-key lookup, never cached: a switch applies at once). */
export function readOnlyFreeze(): Promise<FreezeState | null> {
  return withoutTenant(readOnlyFreezeTx);
}

/** Whether a freeze covers this org (`null`: a platform-level context). */
export function freezeCovers(state: FreezeState | null, orgId: string | null | undefined): boolean {
  if (!state) return false;
  if (state.scope === 'platform') return true;
  return orgId ? state.orgIds.includes(orgId) : false;
}

/** The refusal for a frozen context: stable code, the end if announced, and a retry hint. */
export function freezeRefusal(state: FreezeState, now = new Date()): DomainError {
  const left = state.expectedEndAt ? Math.ceil((state.expectedEndAt.getTime() - now.getTime()) / 1000) : 0;
  return new DomainError('read_only_freeze', 'Read-only maintenance: changes are paused', {
    since: state.since.toISOString(),
    ...(state.expectedEndAt ? { expectedEndAt: state.expectedEndAt.toISOString() } : {}),
    retryAfterSeconds: left > 0 ? left : FREEZE_DEFAULT_RETRY_SECONDS,
  });
}

/** The pipeline port: refuses a command while the freeze covers its context. */
export const freezeGate: NonNullable<CommandPorts<TenantTx>['freeze']> = {
  check: async (ctx) => {
    const state = await readOnlyFreeze();
    if (freezeCovers(state, ctx.orgId)) throw freezeRefusal(state as FreezeState, ctx.now);
  },
};

/** Where a host's traffic goes during the cutover, if routed (`platform.host_route`). */
export async function hostRoute(host: string): Promise<HostTarget | null> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ target: string | null }>(sql`select platform.host_route(${host.toLowerCase()}) as target`),
  );
  const parsed = HostTarget.safeParse(rows[0]?.target);
  return parsed.success ? parsed.data : null;
}
