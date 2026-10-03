import type postgres from 'postgres';
import { ROLE } from './roles.ts';

export interface RolePasswords {
  readonly app: string;
  readonly migrator: string;
  readonly platformReader: string;
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/**
 * Create or update the database roles and default privileges. Runs as a superuser connected to
 * `database` itself (default privileges are per database). Local, CI and preview databases only;
 * production roles are provisioned by an owner-run runbook.
 */
export async function bootstrapRoles(
  admin: postgres.Sql,
  database: string,
  pw: RolePasswords,
): Promise<void> {
  const roles: [string, string, string][] = [
    [ROLE.appUser, 'LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE', pw.app],
    [ROLE.migrator, 'LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE', pw.migrator],
    [ROLE.platformReader, 'LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE', pw.platformReader],
  ];
  for (const [name, attrs, password] of roles) {
    const [exists] = await admin`select 1 from pg_roles where rolname = ${name}`;
    await admin.unsafe(
      `${exists ? 'ALTER' : 'CREATE'} ROLE ${ident(name)} WITH ${attrs} PASSWORD ${lit(password)}`,
    );
  }
  // The ledger owner never logs in; the migrator must be a member to hand it the function.
  const [lw] = await admin`select 1 from pg_roles where rolname = ${ROLE.ledgerWriter}`;
  if (!lw) await admin.unsafe(`CREATE ROLE ${ident(ROLE.ledgerWriter)} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
  await admin.unsafe(`GRANT ${ident(ROLE.ledgerWriter)} TO ${ident(ROLE.migrator)}`);
  const db = ident(database);
  await admin.unsafe(`GRANT CONNECT, CREATE, TEMPORARY ON DATABASE ${db} TO ${ROLE.migrator}`);
  await admin.unsafe(`GRANT CONNECT ON DATABASE ${db} TO ${ROLE.appUser}, ${ROLE.platformReader}`);
  await admin.unsafe(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${ROLE.migrator} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE.appUser}`,
  );
  await admin.unsafe(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${ROLE.migrator} GRANT USAGE, SELECT ON SEQUENCES TO ${ROLE.appUser}`,
  );
  // Functions are private by default; migrations grant EXECUTE per function.
  await admin.unsafe(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${ROLE.migrator} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`,
  );
  await admin.unsafe(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${ROLE.migrator} GRANT SELECT ON TABLES TO ${ROLE.platformReader}`,
  );
  // M6.12b: pgvector (matchmaking embeddings) is not a trusted extension: the superuser creates it,
  // in the migrator's `extensions` schema (where M1.8f's pg_trgm lives), before migrations run.
  await admin.unsafe(`CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION ${ROLE.migrator}`);
  const [vector] = await admin`select 1 from pg_available_extensions where name = 'vector'`;
  if (!vector)
    throw new Error(
      'The pgvector extension is not installed on this Postgres. Use the pgvector/pgvector:pg18 image (docker-compose.yml).',
    );
  await admin.unsafe('CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions');
}

/**
 * After migrations: let the runtime roles see every schema the migrator owns, except drizzle's and
 * the legacy ELT's platform-owned schemas (`legacy` control tables and `legacy_{inst}` staging, which
 * hold raw legacy rows and are for the migrator only).
 */
export async function grantSchemaUsage(migrator: postgres.Sql): Promise<void> {
  const schemas = await migrator<{ name: string }[]>`
    select nspname as name from pg_namespace
    where pg_get_userbyid(nspowner) = ${ROLE.migrator} and nspname <> 'drizzle'
      and nspname <> 'legacy' and nspname not like 'legacy\_%'`;
  for (const { name } of schemas) {
    await migrator.unsafe(`GRANT USAGE ON SCHEMA ${ident(name)} TO ${ROLE.appUser}, ${ROLE.platformReader}`);
  }
}
