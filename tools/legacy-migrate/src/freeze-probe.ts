import { migratorSql } from '@yayatoh/db/migration';
import { ident, stagingSchema } from './sql.ts';
import type { Instance } from './transforms/context.ts';

/**
 * The legacy freeze verification probe (M2.5a, roadmap §7.8 T−0 "No writes confirmed"). The legacy
 * read-only switch is a manual runbook step on the Laravel side (no legacy code change); this probe
 * proves it held: it reads the final snapshot loaded into the staging schema (`legacy_{inst}`) and
 * finds every row of the write tables created or updated after the freeze instant (legacy
 * timestamps are wall clock in the platform timezone). Any row is a failed freeze: abort, or take a
 * new dump after the stragglers are understood. Read-only; it never connects to MySQL.
 */
export const FREEZE_WRITE_TABLES = [
  'users',
  'bookings',
  'transactions',
  'commissions',
  'attendees',
  'checkins',
  'events',
  'tickets',
  'promocodes',
  'newsletters',
  'notifications',
] as const;

export interface FreezeProbeResult {
  readonly instance: Instance;
  readonly freezeAt: string;
  readonly pass: boolean;
  /** Per table: rows stamped after the freeze (0 = quiet) and the latest stamp seen. */
  readonly tables: Record<string, { readonly after: number; readonly latest: string | null }>;
  /** Tables the snapshot does not have (older dumps), skipped. */
  readonly missing: readonly string[];
}

export async function legacyFreezeProbe(instance: Instance, freezeAt: Date): Promise<FreezeProbeResult> {
  const sql = migratorSql();
  const schema = stagingSchema(instance);
  const [settings] = await sql<{ platform_tz: string }[]>`
    select platform_tz from legacy.instance_settings where instance = ${instance}`.catch(() => []);
  const tz = settings?.platform_tz ?? 'America/New_York';
  const cols = await sql<{ table_name: string; column_name: string }[]>`
    select table_name, column_name from information_schema.columns
    where table_schema = ${schema} and column_name in ('created_at', 'updated_at')`;
  const byTable = new Map<string, string[]>();
  for (const c of cols) byTable.set(c.table_name, [...(byTable.get(c.table_name) ?? []), c.column_name]);
  const tables: Record<string, { after: number; latest: string | null }> = {};
  const missing: string[] = [];
  for (const t of FREEZE_WRITE_TABLES) {
    const stamps = byTable.get(t);
    if (!stamps?.length) {
      missing.push(t);
      continue;
    }
    const greatest = stamps.length > 1 ? `greatest(${stamps.join(', ')})` : (stamps[0] as string);
    const [r] = (await sql.unsafe(
      `select count(*) filter (where (${greatest} at time zone $1) > $2::timestamptz)::int as after,
              max(${greatest} at time zone $1) as latest
       from ${ident(schema)}.${ident(t)}`,
      [tz, freezeAt.toISOString()],
    )) as unknown as { after: number; latest: Date | null }[];
    tables[t] = { after: r?.after ?? 0, latest: r?.latest ? new Date(r.latest).toISOString() : null };
  }
  return {
    instance,
    freezeAt: freezeAt.toISOString(),
    pass: Object.values(tables).every((t) => t.after === 0),
    tables,
    missing,
  };
}
