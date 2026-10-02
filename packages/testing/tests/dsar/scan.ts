import type { AdminSql } from '@yayatoh/db/testing';

export interface ScanHit {
  readonly table: string;
  readonly column: string;
  readonly rows: number;
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/**
 * Every text, json, array and bytea column of every table that has `org_id`, searched for the
 * tokens (case-insensitive) in one org's rows. Superuser: RLS does not hide anything.
 */
export async function scanOrg(admin: AdminSql, orgId: string, tokens: readonly string[]): Promise<ScanHit[]> {
  const cols = await admin<
    { table_schema: string; table_name: string; column_name: string; data_type: string }[]
  >`
    select c.table_schema, c.table_name, c.column_name, c.data_type
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema not in ('pg_catalog', 'information_schema', 'drizzle')
      and exists (select 1 from information_schema.columns o
                  where o.table_schema = c.table_schema and o.table_name = c.table_name and o.column_name = 'org_id')
      and c.data_type in ('text', 'character varying', 'jsonb', 'json', 'ARRAY', 'bytea', 'citext', 'USER-DEFINED')`;
  const hits: ScanHit[] = [];
  for (const c of cols) {
    const col = ident(c.column_name);
    const expr =
      c.data_type === 'bytea'
        ? (t: number) => `position(convert_to($${t + 2}, 'UTF8') in ${col}) > 0`
        : (t: number) => `${col}::text ilike '%' || $${t + 2} || '%'`;
    const where = tokens.map((_, i) => expr(i)).join(' or ');
    const [r] = await admin.unsafe<{ n: number }[]>(
      `select count(*)::int as n from ${ident(c.table_schema)}.${ident(c.table_name)} where org_id = $1 and (${where})`,
      [orgId, ...tokens],
    );
    if (r && r.n > 0)
      hits.push({ table: `${c.table_schema}.${c.table_name}`, column: c.column_name, rows: r.n });
  }
  return hits;
}
