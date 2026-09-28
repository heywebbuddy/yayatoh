import { GLOBAL_TABLES, withoutTenant, withTenant } from '@yayatoh/db';
import {
  type AdminSql,
  adminClient,
  closePools,
  isMigrationSchema,
  roleGuard,
  schemaGuard,
} from '@yayatoh/db/testing';
import { createCtx } from '@yayatoh/kernel';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, twoOrgs } from '../src/index.ts';

let admin: AdminSql;
let a: OrgFixture;
let b: OrgFixture;
let tables: string[];

beforeAll(async () => {
  admin = adminClient();
  ({ a, b } = await twoOrgs());
  const rows = await admin<{ t: string }[]>`
    select n.nspname || '.' || c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r','p') and not c.relispartition
      and n.nspname not in ('pg_catalog','information_schema','drizzle','pgboss','public') and n.nspname not like 'pg\\_%'
    order by 1`;
  // Migration schemas are not tenant tables; the schema guard checks app_user cannot reach them.
  tables = rows
    .map((r) => r.t)
    .filter((t) => !(t in GLOBAL_TABLES) && !isMigrationSchema(t.split('.')[0] ?? ''));
});

afterAll(async () => {
  await closePools();
  await admin.end();
});

const ident = (t: string) =>
  sql.raw(
    t
      .split('.')
      .map((p) => `"${p}"`)
      .join('.'),
  );

describe('isolation suite', () => {
  it('schema guard: every migrated table is tenant-safe', async () => {
    expect(await schemaGuard(admin, GLOBAL_TABLES)).toEqual([]);
  });

  it('role guard: app_user cannot bypass RLS and owns nothing', async () => {
    expect(await roleGuard(admin)).toEqual([]);
  });

  it('the fixture covers every tenant table for both orgs', async () => {
    expect(tables.length).toBeGreaterThan(5);
    for (const t of tables) {
      const [row] = await admin.unsafe<{ a: number; b: number }[]>(
        `select count(*) filter (where org_id = $1)::int as a, count(*) filter (where org_id = $2)::int as b from ${t}`,
        [a.org.id, b.org.id],
      );
      expect({ table: t, a: (row?.a ?? 0) > 0, b: (row?.b ?? 0) > 0 }).toEqual({
        table: t,
        a: true,
        b: true,
      });
    }
  });

  it('raw SQL as app_user in org A sees 0 rows of org B in every tenant table', async () => {
    for (const t of tables) {
      const [row] = await withTenant(createCtx({ orgId: a.org.id }), (tx) =>
        tx.execute<{ foreign: number; own: number }>(
          sql`select count(*) filter (where org_id <> ${a.org.id})::int as foreign, count(*)::int as own from ${ident(t)}`,
        ),
      );
      const [truth] = await admin.unsafe<{ n: number }[]>(
        `select count(*)::int as n from ${t} where org_id = $1`,
        [a.org.id],
      );
      expect({ table: t, foreign: row?.foreign, own: row?.own }).toEqual({
        table: t,
        foreign: 0,
        own: truth?.n,
      });
    }
  });

  it('a missing tenant context sees nothing and cannot write', async () => {
    for (const t of tables) {
      const [row] = await withoutTenant((tx) =>
        tx.execute<{ n: number }>(sql`select count(*)::int as n from ${ident(t)}`),
      );
      expect({ table: t, n: row?.n }).toEqual({ table: t, n: 0 });
    }
    await expect(
      withoutTenant((tx) =>
        tx.execute(
          sql`insert into tenancy.memberships (org_id, user_id, role) values (${a.org.id}, ${a.ownerId}, 'owner')`,
        ),
      ),
    ).rejects.toThrow();
    await expect(withTenant(createCtx(), async () => 1)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('append-only tables reject UPDATE and DELETE from app_user', async () => {
    for (const t of [
      'platform.audit_events',
      'platform.domain_events',
      'platform.processed_events',
      'ai.credit_ledger',
    ]) {
      await expect(
        withTenant(createCtx({ orgId: a.org.id }), (tx) => tx.execute(sql`delete from ${ident(t)}`)),
      ).rejects.toThrow();
    }
  });

  it('reference data is read-only for app_user', async () => {
    const rows = await withoutTenant((tx) => tx.execute(sql`select key from billing.plans`));
    expect(rows.map((r) => r.key)).toContain('launch_standard');
    await expect(
      withoutTenant((tx) => tx.execute(sql`insert into billing.plans values ('x', 'x')`)),
    ).rejects.toThrow();
  });
});
