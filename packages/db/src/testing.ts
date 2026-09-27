// Test-only helpers. Imported from tests, never from application code (check-modules enforces).
export { bootstrapRoles, grantSchemaUsage } from './bootstrap.ts';
export { closePools } from './client.ts';
export { roleGuard, schemaGuard } from './guard.ts';
export { runMigrations } from './migrate.ts';
export { forceRowLevelSecurity } from './rls-migration.ts';

import postgres from 'postgres';
import { databaseUrl } from './env.ts';

/** Superuser connection to the throwaway test database (integration tests only). */
export function adminClient(): postgres.Sql {
  return postgres(databaseUrl('admin'), { max: 1, onnotice: () => {} });
}

export type AdminSql = postgres.Sql;
