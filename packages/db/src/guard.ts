import type postgres from 'postgres';
import { ROLE } from './roles.ts';

export interface GuardViolation {
  readonly table: string;
  readonly problem: string;
}

const SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema', 'drizzle', 'pgboss', 'public'];

/**
 * The legacy ELT's platform-owned schemas (M2.2b): `legacy` (control) and `legacy_{inst}` (staging,
 * raw legacy rows). They are not tenant tables; instead the runtime roles must have no access at all.
 */
export const isMigrationSchema = (schema: string) => schema === 'legacy' || /^legacy_[a-z]+$/.test(schema);

/** Normalise a policy expression for comparison with the canonical tenant predicate. */
function normalise(expr: string | null): string {
  return (expr ?? '')
    .replace(/\s+/g, '')
    .replace(/::text/g, '')
    .replace(/AS"?nullif"?/gi, '')
    .toLowerCase();
}
const CANONICAL = "(org_id=(select(nullif(current_setting('app.org_id',true),''))::uuid))";

/**
 * Schema guard (roadmap §4.3, isolation suite step 1). Every table outside the system schemas
 * and GLOBAL_TABLES must have: `org_id uuid NOT NULL`, RLS ENABLEd **and FORCEd**, a permissive
 * policy using the canonical predicate for both USING and WITH CHECK, and an index leading with org_id.
 */
export async function schemaGuard(
  sql: postgres.Sql,
  globalTables: Readonly<Record<string, string>>,
): Promise<GuardViolation[]> {
  const tables = await sql<
    {
      schema: string;
      name: string;
      rls: boolean;
      force: boolean;
      org_col: string | null;
      org_notnull: boolean | null;
    }[]
  >`
    select n.nspname as schema, c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as force,
           format_type(a.atttypid, a.atttypmod) as org_col, a.attnotnull as org_notnull
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
    where c.relkind in ('r', 'p') and not c.relispartition
      and n.nspname <> all(${SYSTEM_SCHEMAS}) and n.nspname not like 'pg\\_%'
    order by 1, 2`;

  const policies = await sql<
    { schema: string; name: string; permissive: string; qual: string | null; with_check: string | null }[]
  >`
    select schemaname as schema, tablename as name, permissive, qual, with_check from pg_policies`;

  const indexes = await sql<{ schema: string; name: string; first_col: string }[]>`
    select n.nspname as schema, t.relname as name, a.attname as first_col
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]`;

  const violations: GuardViolation[] = [];
  const migrationSchemas = [...new Set(tables.map((t) => t.schema).filter(isMigrationSchema))];
  for (const schema of migrationSchemas) {
    const [access] = await sql<{ app: boolean; reader: boolean }[]>`
      select has_schema_privilege(${ROLE.appUser}, ${schema}, 'usage') as app,
             has_schema_privilege(${ROLE.platformReader}, ${schema}, 'usage') as reader`;
    if (access?.app || access?.reader)
      violations.push({ table: `${schema}.*`, problem: 'migration schema is visible to a runtime role' });
  }
  for (const t of tables) {
    const key = `${t.schema}.${t.name}`;
    if (key in globalTables || isMigrationSchema(t.schema)) continue;
    const v = (problem: string) => violations.push({ table: key, problem });
    if (t.org_col !== 'uuid') v('missing org_id uuid column');
    else if (!t.org_notnull) v('org_id must be NOT NULL');
    if (!t.rls) v('row level security is not enabled');
    if (!t.force) v('row level security is not forced');
    const own = policies.filter((p) => p.schema === t.schema && p.name === t.name);
    const canonical = own.some(
      (p) =>
        p.permissive === 'PERMISSIVE' &&
        normalise(p.qual) === CANONICAL &&
        normalise(p.with_check) === CANONICAL,
    );
    if (!canonical) v('missing canonical tenant policy (USING and WITH CHECK)');
    if (!indexes.some((i) => i.schema === t.schema && i.name === t.name && i.first_col === 'org_id')) {
      v('no index leads with org_id');
    }
  }
  return violations;
}

/** Role guard (isolation suite step 2): the runtime role cannot bypass RLS and owns nothing. */
export async function roleGuard(sql: postgres.Sql): Promise<GuardViolation[]> {
  const violations: GuardViolation[] = [];
  const [role] = await sql<{ super: boolean; bypass: boolean }[]>`
    select rolsuper as super, rolbypassrls as bypass from pg_roles where rolname = ${ROLE.appUser}`;
  if (!role) return [{ table: '-', problem: `role ${ROLE.appUser} does not exist` }];
  if (role.super) violations.push({ table: '-', problem: `${ROLE.appUser} is a superuser` });
  if (role.bypass) violations.push({ table: '-', problem: `${ROLE.appUser} has BYPASSRLS` });
  const owned = await sql<{ name: string }[]>`
    select n.nspname || '.' || c.relname as name from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where pg_get_userbyid(c.relowner) = ${ROLE.appUser} and c.relkind in ('r', 'p', 'v', 'm')`;
  for (const o of owned) violations.push({ table: o.name, problem: `${ROLE.appUser} owns this table` });
  return violations;
}
