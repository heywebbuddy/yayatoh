import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  index,
  type PgColumnBuilderBase,
  type PgSchema,
  pgPolicy,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { appUserRole } from './roles.ts';

/**
 * The canonical tenant predicate (roadmap §4.3). The `(SELECT …)` wrapper lets Postgres
 * evaluate it once per statement; NULLIF avoids a cast error when a pooled connection
 * has an empty setting. With no tenant set, it matches nothing.
 */
export const TENANT_PREDICATE = sql`org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)`;

export const tenantBaseColumns = () => ({
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  orgId: uuid('org_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

type Base = ReturnType<typeof tenantBaseColumns>;

/**
 * Define a tenant-owned table. Adds `id` (UUIDv7), `org_id NOT NULL`, timestamps,
 * `UNIQUE (org_id, id)` for composite foreign keys, an org-leading index, and the tenant
 * policy. RLS is ENABLEd by drizzle-kit and FORCEd by `pnpm db:generate` (scripts/force-rls.ts);
 * the schema guard fails CI if either is missing.
 *
 * Extra indexes and uniques should lead with `org_id`.
 */
export function tenantTable<TName extends string, TColumns extends Record<string, PgColumnBuilderBase>>(
  schema: PgSchema,
  name: TName,
  columns: TColumns,
  extra?: Parameters<typeof schema.table<TName, Base & TColumns>>[2],
) {
  const all = { ...tenantBaseColumns(), ...columns } as Base & TColumns;
  return schema
    .table(name, all, (t) => {
      const cols = t as unknown as { orgId: AnyPgColumn; id: AnyPgColumn };
      const extras = typeof extra === 'function' ? extra(t) : [];
      return [
        unique(`${name}_org_id_id_key`).on(cols.orgId, cols.id),
        index(`${name}_org_id_idx`).on(cols.orgId),
        pgPolicy(`${name}_tenant_isolation`, {
          as: 'permissive',
          for: 'all',
          to: appUserRole,
          using: TENANT_PREDICATE,
          withCheck: TENANT_PREDICATE,
        }),
        ...(Array.isArray(extras) ? extras : Object.values(extras ?? {})),
      ];
    })
    .enableRLS();
}
