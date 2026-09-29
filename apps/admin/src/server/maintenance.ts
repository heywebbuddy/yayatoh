import 'server-only';
import { withPlatformReader } from '@yayatoh/db/platform';
import { FreezeValue } from '@yayatoh/platform';
import { sql } from 'drizzle-orm';
import type { Staff } from './staff.ts';

/**
 * The read-only freeze and the cutover host routes (M2.5a), as the staff console sees them: an
 * explicit allowlist of fields (never the raw jsonb). Reads and writes go through platform_reader
 * and are audited in the access log; the change itself is appended to `platform.ops_flag_changes`.
 */
export interface FreezeView {
  readonly scope: 'platform' | 'orgs';
  readonly orgs: readonly { id: string; slug: string; name: string }[];
  readonly since: Date;
  readonly expectedEndAt: Date | null;
  readonly reason: string;
  readonly by: string;
}

export interface OpsChange {
  readonly id: string;
  readonly key: string;
  readonly on: boolean;
  readonly summary: string;
  readonly reason: string;
  readonly actor: string;
  readonly at: Date;
}

export interface MaintenanceView {
  readonly freeze: FreezeView | null;
  readonly routes: readonly { host: string; target: string; by: string; at: Date }[];
  readonly changes: readonly OpsChange[];
}

function summarize(key: string, value: Record<string, unknown> | null): string {
  if (!value) return 'off';
  if (key === 'read_only_freeze')
    return value.scope === 'platform'
      ? 'platform'
      : `${Array.isArray(value.orgIds) ? value.orgIds.length : 0} org(s)`;
  return String(value.target ?? '');
}

export async function maintenanceView(staff: Staff): Promise<MaintenanceView> {
  return withPlatformReader({ actor: staff.actor, reason: 'staff console: view maintenance' }, async (tx) => {
    const flags = await tx.execute<{
      key: string;
      value: Record<string, unknown>;
      reason: string;
      updated_by: string;
      updated_at: string;
    }>(sql`select key, value, reason, updated_by, updated_at from platform.ops_flags order by key`);
    const changes = await tx.execute<{
      id: string;
      key: string;
      value: Record<string, unknown> | null;
      reason: string;
      actor: string;
      at: string;
    }>(
      sql`select id, key, value, reason, actor, at from platform.ops_flag_changes order by at desc, id desc limit 20`,
    );
    const f = flags.find((r) => r.key === 'read_only_freeze');
    let freeze: FreezeView | null = null;
    if (f) {
      const v = FreezeValue.safeParse(f.value);
      const ids = v.success && v.data.scope === 'orgs' ? v.data.orgIds : [];
      const orgs = ids.length
        ? await tx.execute<{ id: string; slug: string; name: string }>(
            sql`select id, slug, name from tenancy.organizations where id = any(${`{${ids.join(',')}}`}::uuid[]) order by name`,
          )
        : [];
      freeze = {
        scope: v.success ? v.data.scope : 'platform',
        orgs: orgs.map((o) => ({ id: o.id, slug: o.slug, name: o.name })),
        since: new Date(f.updated_at),
        expectedEndAt: v.success && v.data.expectedEndAt ? new Date(v.data.expectedEndAt) : null,
        reason: f.reason,
        by: f.updated_by,
      };
    }
    return {
      freeze,
      routes: flags
        .filter((r) => r.key.startsWith('host_route:'))
        .map((r) => ({
          host: r.key.slice('host_route:'.length),
          target: String(r.value.target ?? ''),
          by: r.updated_by,
          at: new Date(r.updated_at),
        })),
      changes: changes.map((c) => ({
        id: c.id,
        key: c.key,
        on: c.value !== null,
        summary: summarize(c.key, c.value),
        reason: c.reason,
        actor: c.actor,
        at: new Date(c.at),
      })),
    };
  });
}

/** Org slugs → ids (unknown slugs listed back so the form can say which). */
export async function orgsBySlug(
  staff: Staff,
  slugs: readonly string[],
): Promise<{ ids: string[]; unknown: string[] }> {
  if (slugs.length === 0) return { ids: [], unknown: [] };
  const rows = await withPlatformReader(
    { actor: staff.actor, reason: 'staff console: resolve orgs for a read-only freeze' },
    (tx) =>
      tx.execute<{ id: string; slug: string }>(
        sql`select id, slug from tenancy.organizations where slug = any(${`{${slugs.join(',')}}`}::text[])`,
      ),
  );
  const found = new Map(rows.map((r) => [r.slug, r.id]));
  return {
    ids: [...new Set(slugs.map((s) => found.get(s)).filter((x): x is string => Boolean(x)))],
    unknown: slugs.filter((s) => !found.has(s)),
  };
}

/** Start (or change) the freeze, or end it (`null`). Audited: access log + ops_flag_changes. */
export async function setFreeze(staff: Staff, value: FreezeValue | null, reason: string): Promise<void> {
  const summary = value
    ? value.scope === 'platform'
      ? 'platform-wide'
      : `${value.orgIds.length} org(s)`
    : 'off';
  await withPlatformReader(
    { actor: staff.actor, reason: `staff console: read-only freeze ${summary}: ${reason}` },
    (tx) =>
      tx.execute(
        sql`select platform.set_ops_flag('read_only_freeze', ${value ? JSON.stringify(FreezeValue.parse(value)) : null}::jsonb, ${reason}, ${staff.actor})`,
      ),
    { callsWritingFunctions: true },
  );
}
