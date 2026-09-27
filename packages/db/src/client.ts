// Internal: the only place raw database clients are created. Never exported from the package.
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { type DbRole, databaseUrl } from './env.ts';

export type Database = PostgresJsDatabase<Record<string, never>>;

const pools = new Map<DbRole, { sql: postgres.Sql; db: Database }>();

export function pool(role: DbRole): { sql: postgres.Sql; db: Database } {
  let p = pools.get(role);
  if (!p) {
    const sql = postgres(databaseUrl(role), {
      max: role === 'app' ? 10 : 2,
      // Transaction pooling (PgBouncer/Neon pooler) cannot use named prepared statements.
      prepare: false,
      onnotice: () => {},
      connection: { application_name: `yayatoh:${role}` },
    });
    p = { sql, db: drizzle(sql) };
    pools.set(role, p);
  }
  return p;
}

export async function closePools(): Promise<void> {
  const all = [...pools.values()];
  pools.clear();
  await Promise.all(all.map((p) => p.sql.end({ timeout: 5 })));
}
