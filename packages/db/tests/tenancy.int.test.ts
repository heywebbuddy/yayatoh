import { createCtx } from '@yayatoh/kernel';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { eq, sql } from 'drizzle-orm';
import { pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { roleGuard, schemaGuard } from '../src/guard.ts';
import { GLOBAL_TABLES, tenantTable, withoutTenant, withTenant } from '../src/index.ts';
import { closePools, forceRowLevelSecurity, grantSchemaUsage } from '../src/testing.ts';

const probe = pgSchema('probe');
const widgets = tenantTable(probe, 'widgets', { name: text('name').notNull() });
const unsafeTable = pgSchema('probe_canary').table('no_rls', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id'),
});

const ORG_A = '0190f5f6-0000-7000-8000-00000000000a';
const ORG_B = '0190f5f6-0000-7000-8000-00000000000b';

let migrator: postgres.Sql;
let admin: postgres.Sql;

/** Drizzle wraps driver errors; the Postgres message is on `cause`. */
async function expectRlsViolation(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(String((err as { cause?: Error } | null)?.cause?.message)).toMatch(/row-level security/);
}

async function applySchema(tables: Record<string, unknown>) {
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(tables));
  const migration = forceRowLevelSecurity(statements.join('--> statement-breakpoint\n'));
  for (const stmt of migration.split('--> statement-breakpoint\n'))
    if (stmt.trim()) await migrator.unsafe(stmt);
  await grantSchemaUsage(migrator);
  return migration;
}

beforeAll(async () => {
  migrator = postgres(process.env.MIGRATOR_DATABASE_URL as string, { max: 1, onnotice: () => {} });
  admin = postgres(process.env.ADMIN_DATABASE_URL as string, { max: 1, onnotice: () => {} });
  const migration = await applySchema({ probe, widgets });
  expect(migration).toContain('FORCE ROW LEVEL SECURITY');
});

afterAll(async () => {
  await migrator.unsafe('DROP SCHEMA IF EXISTS probe CASCADE; DROP SCHEMA IF EXISTS probe_canary CASCADE');
  await closePools();
  await migrator.end();
  await admin.end();
});

describe('isolation: tenantTable + withTenant', () => {
  it('passes the schema guard and the role guard', async () => {
    expect(await schemaGuard(admin, GLOBAL_TABLES)).toEqual([]);
    expect(await roleGuard(admin)).toEqual([]);
  });

  it('only shows the current tenant its own rows', async () => {
    await withTenant(createCtx({ orgId: ORG_A }), (tx) =>
      tx.insert(widgets).values({ orgId: ORG_A, name: 'a1' }),
    );
    await withTenant(createCtx({ orgId: ORG_B }), (tx) =>
      tx.insert(widgets).values({ orgId: ORG_B, name: 'b1' }),
    );

    const seenByA = await withTenant(createCtx({ orgId: ORG_A }), (tx) => tx.select().from(widgets));
    expect(seenByA.map((r) => r.name)).toEqual(['a1']);

    // Even an explicit filter on another org returns nothing.
    const foreign = await withTenant(createCtx({ orgId: ORG_A }), (tx) =>
      tx.select().from(widgets).where(eq(widgets.orgId, ORG_B)),
    );
    expect(foreign).toEqual([]);
  });

  it('rejects writes into another tenant', async () => {
    await expectRlsViolation(
      withTenant(createCtx({ orgId: ORG_A }), (tx) =>
        tx.insert(widgets).values({ orgId: ORG_B, name: 'evil' }),
      ),
    );
  });

  it('shows raw SQL as app_user zero rows without a tenant, and blocks inserts', async () => {
    const rows = await withoutTenant((tx) => tx.execute(sql`select count(*)::int as n from probe.widgets`));
    expect(rows[0]).toEqual({ n: 0 });
    await expectRlsViolation(
      withoutTenant((tx) => tx.execute(sql`insert into probe.widgets (org_id, name) values (${ORG_A}, 'x')`)),
    );
  });

  it('refuses to open a tenant transaction without a valid org', async () => {
    await expect(withTenant(createCtx(), async () => 1)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(withTenant(createCtx({ orgId: "x' or 1=1" }), async () => 1)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('does not leak the tenant setting across pooled transactions', async () => {
    await withTenant(createCtx({ orgId: ORG_A }), async () => undefined);
    const rows = await withoutTenant((tx) =>
      tx.execute(sql`select current_setting('app.org_id', true) as v`),
    );
    expect(rows[0]?.v ?? '').toBe('');
  });
});

describe('gate canary: table without RLS', () => {
  it('is caught by the schema guard', async () => {
    await applySchema({ probeCanary: pgSchema('probe_canary'), unsafeTable });
    const violations = await schemaGuard(admin, GLOBAL_TABLES);
    const problems = violations.filter((v) => v.table === 'probe_canary.no_rls').map((v) => v.problem);
    expect(problems).toEqual(
      expect.arrayContaining([
        'org_id must be NOT NULL',
        'row level security is not enabled',
        'row level security is not forced',
        'missing canonical tenant policy (USING and WITH CHECK)',
        'no index leads with org_id',
      ]),
    );
    await migrator.unsafe('DROP SCHEMA probe_canary CASCADE');
  });
});
