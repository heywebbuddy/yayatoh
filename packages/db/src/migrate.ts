import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { grantSchemaUsage } from './bootstrap.ts';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Apply migrations as the migrator on a direct connection, with a lock_timeout. */
export async function runMigrations(migratorUrl: string, folder = MIGRATIONS_FOLDER): Promise<void> {
  const sql = postgres(migratorUrl, {
    max: 1,
    onnotice: () => {},
    connection: { lock_timeout: 5_000, application_name: 'yayatoh:migrate' },
  });
  try {
    if (existsSync(`${folder}/meta/_journal.json`)) {
      await migrate(drizzle(sql), { migrationsFolder: folder, migrationsSchema: 'drizzle' });
    }
    await grantSchemaUsage(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
