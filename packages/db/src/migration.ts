// Restricted entry point: only tools/legacy-migrate may import `@yayatoh/db/migration` (enforced by
// tools/check-modules). The legacy ELT (roadmap §7.5) runs as `migrator`, the schema owner that
// also runs schema migrations: it creates the platform-owned staging schemas (`legacy_{inst}`) and
// the `legacy` control schema, and writes migrated rows set-based, with every row's `org_id`
// written explicitly. Row-level security stays ENABLE + FORCE on every tenant table; `app_user`
// never sees the staging or control schemas.
import type postgres from 'postgres';
import { pool } from './client.ts';

export type MigratorSql = postgres.Sql;

/** The migrator connection pool (direct, unpooled URL: MIGRATOR_DATABASE_URL). */
export function migratorSql(): MigratorSql {
  return pool('migrator').sql;
}

/** Superuser-free check used by the tool before it writes anything: who are we connected as? */
export async function currentRole(sql: MigratorSql): Promise<string> {
  const [row] = await sql<{ role: string }[]>`select current_user as role`;
  return row?.role ?? '';
}
