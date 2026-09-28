import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';
import { bootstrapRoles } from '../src/bootstrap.ts';
import { runMigrations } from '../src/migrate.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    dbUrls: Record<string, string>;
  }
}

/**
 * Integration/isolation setup: a fresh `yayatoh_test` database, roles with random per-run
 * passwords, all migrations applied from zero. Needs a local or CI Postgres 18 superuser URL
 * (ADMIN_DATABASE_URL; defaults to the docker-compose service).
 */
export default async function setup(project: TestProject): Promise<void> {
  const adminUrl = new URL(
    process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres',
  );
  const host = adminUrl.hostname;
  if (!['localhost', '127.0.0.1', 'postgres'].includes(host)) {
    throw new Error(`Refusing to run integration tests against non-local database host ${host}`);
  }
  const testDb = process.env.TEST_DATABASE_NAME ?? 'yayatoh_test';
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    await admin`select pg_terminate_backend(pid) from pg_stat_activity where datname = ${testDb} and pid <> pg_backend_pid()`;
    await admin.unsafe(`DROP DATABASE IF EXISTS "${testDb}"`);
    await admin.unsafe(`CREATE DATABASE "${testDb}"`);
    const pw = {
      app: randomBytes(12).toString('hex'),
      migrator: randomBytes(12).toString('hex'),
      platformReader: randomBytes(12).toString('hex'),
    };
    // Default privileges are per database, so bootstrap on a connection to the test database.
    const adminTestDb = new URL(adminUrl.toString());
    adminTestDb.pathname = `/${testDb}`;
    const adminOnTest = postgres(adminTestDb.toString(), { max: 1, onnotice: () => {} });
    try {
      await bootstrapRoles(adminOnTest, testDb, pw);
    } finally {
      await adminOnTest.end();
    }

    const url = (user: string, password: string) => {
      const u = new URL(adminUrl.toString());
      u.username = user;
      u.password = password;
      u.pathname = `/${testDb}`;
      return u.toString();
    };
    const urls = {
      DATABASE_URL: url('app_user', pw.app),
      MIGRATOR_DATABASE_URL: url('migrator', pw.migrator),
      PLATFORM_READER_DATABASE_URL: url('platform_reader', pw.platformReader),
      ADMIN_DATABASE_URL: adminTestDb.toString(),
      // Per-run signing secret for invitation tokens in tests.
      APP_TOKEN_SECRET: randomBytes(32).toString('hex'),
      // One key-vault key for the whole run: files share the database, so a secret one file
      // sealed (a migrated org's signing key) must open in the next.
      LOCAL_KMS_KEY: randomBytes(32).toString('hex'),
    };
    await runMigrations(urls.MIGRATOR_DATABASE_URL);
    project.provide('dbUrls', urls);
  } finally {
    await admin.end();
  }
}
