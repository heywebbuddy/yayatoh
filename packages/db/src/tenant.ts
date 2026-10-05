import type { Ctx } from '@yayatoh/kernel';
import { DomainError } from '@yayatoh/kernel';
import { sql } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import { pool } from './client.ts';

export type TenantTx = PgTransaction<PostgresJsQueryResultHKT, Record<string, never>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` in a transaction as `app_user` with the tenant set for this transaction only
 * (`set_config(…, true)`, safe under transaction pooling). Row-level security does the rest.
 * The org comes from `ctx`, which is built from the route root param or the session — never headers.
 */
export async function withTenant<T>(ctx: Ctx, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  const orgId = ctx.orgId;
  if (!orgId || !UUID.test(orgId)) throw new DomainError('forbidden', 'Tenant context required');
  const actor = ctx.actor.type === 'user' ? ctx.actor.userId : '';
  // M6.7a: a user acting through an agency grant. The money tables' row policy
  // (`tenancy.money_access_allowed()`) refuses their rows unless that grant is live and the client
  // opted in to finance.
  const grant = ctx.viaAgency?.grantId ?? '';
  if (grant && !UUID.test(grant)) throw new DomainError('forbidden', 'Invalid agency grant');
  return pool('app').db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', ${orgId}, true), set_config('app.actor_id', ${actor}, true), set_config('app.request_id', ${ctx.requestId}, true), set_config('app.agency_grant_id', ${grant}, true)`,
    );
    return fn(tx as unknown as TenantTx);
  });
}

/**
 * Run `fn` as `app_user` with **no** tenant set. Tenant tables return no rows and reject
 * writes. For global tables only (e.g. host → org resolution, public lookups).
 */
export async function withoutTenant<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return pool('app').db.transaction(async (tx) => fn(tx as unknown as TenantTx));
}
