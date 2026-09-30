/** Connection URLs per role. Values come from the environment (Doppler); names are in .env.example. */
export type DbRole = 'app' | 'migrator' | 'admin' | 'platformReader';

const VARS: Record<DbRole, string> = {
  app: 'DATABASE_URL',
  migrator: 'MIGRATOR_DATABASE_URL',
  admin: 'ADMIN_DATABASE_URL',
  platformReader: 'PLATFORM_READER_DATABASE_URL',
};

export function databaseUrl(role: DbRole): string {
  const name = VARS[role];
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example and docs/local-development.md)`);
  return value;
}
