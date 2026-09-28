import type { MigratorSql } from '@yayatoh/db/migration';
import { ident, stagingSchema } from '../sql.ts';

export type Instance = 'yay' | 'abc';
export type EventClock = 'platform' | 'venue';

/** Everything a transform step needs. Steps are SQL run as migrator, set-based and idempotent. */
export interface StepContext {
  readonly sql: MigratorSql;
  readonly instance: Instance;
  readonly runId: number;
  readonly platformTz: string;
  readonly currency: string;
  readonly commissionBps: number;
  readonly eventClock: EventClock;
  /**
   * The freeze instant (cutover T−0; a rehearsal's run time unless given): what was live then is
   * carried (magic links until expiry, resets under 60 minutes, unexpired access tokens), and the
   * buyer order-link plan only covers events that had not ended.
   */
  readonly freezeAt: Date;
  readonly log: (message: string) => void;
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Expand a step's SQL template: `{s}` the staging schema, `{inst}` the instance literal, `{run}` the
 * run id, `{tz}` the platform timezone literal, `{cur}` the default currency literal, `{freeze}` the freeze instant. Values are
 * quoted literals or identifiers; nothing from the dump is spliced into SQL text.
 */
export function expand(ctx: StepContext, text: string): string {
  return text
    .replaceAll('{s}', ident(stagingSchema(ctx.instance)))
    .replaceAll('{inst}', lit(ctx.instance))
    .replaceAll('{run}', String(ctx.runId))
    .replaceAll('{tz}', lit(ctx.platformTz))
    .replaceAll('{cur}', lit(ctx.currency))
    .replaceAll('{clock}', lit(ctx.eventClock))
    .replaceAll('{freeze}', `${lit(ctx.freezeAt.toISOString())}::timestamptz`);
}

export async function exec(ctx: StepContext, text: string): Promise<number> {
  const sql = expand(ctx, text);
  if (!process.env.LEGACY_TRACE) {
    const r = await ctx.sql.unsafe(sql);
    return r.count ?? 0;
  }
  // LEGACY_TRACE=1: run statement by statement and log the slow ones (timing rehearsals).
  let count = 0;
  for (const stmt of sql.split(/;\s*\n/).filter((s) => s.replace(/--.*$/gm, '').trim())) {
    const t = Date.now();
    const r = await ctx.sql.unsafe(stmt);
    count = r.count ?? 0;
    const ms = Date.now() - t;
    if (ms > 500) ctx.log(`  ${ms} ms: ${stmt.replace(/\s+/g, ' ').trim().slice(0, 110)}`);
  }
  return count;
}

export async function rows<T>(ctx: StepContext, text: string): Promise<T[]> {
  return (await ctx.sql.unsafe(expand(ctx, text))) as unknown as T[];
}

/** Does the staging schema have this table (a dump may omit empty or unused tables)? */
export async function hasTable(ctx: StepContext, table: string): Promise<boolean> {
  const [r] = await ctx.sql<{ ok: boolean }[]>`
    select exists (select 1 from information_schema.tables
                   where table_schema = ${stagingSchema(ctx.instance)} and table_name = ${table}) as ok`;
  return r?.ok === true;
}

/** Does the staging table have this column (older dumps predate some legacy migrations)? */
export async function hasColumn(ctx: StepContext, table: string, column: string): Promise<boolean> {
  const [r] = await ctx.sql<{ ok: boolean }[]>`
    select exists (select 1 from information_schema.columns
                   where table_schema = ${`legacy_${ctx.instance}`} and table_name = ${table} and column_name = ${column}) as ok`;
  return r?.ok === true;
}

/** Legacy system timestamp (wall clock in the platform timezone) → timestamptz, as SQL. */
export const sysTs = (col: string) => `(${col} at time zone {tz})`;

/** Insert rows in batches (every column named by the first row), skipping any that conflict. */
export async function insertRows(
  ctx: StepContext,
  table: string,
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000);
    await ctx.sql`insert into ${ctx.sql(table)} ${ctx.sql(batch as never)} on conflict do nothing`;
  }
}

export interface Finding {
  readonly legacyId: string;
  readonly kind: string;
  readonly detail?: Record<string, unknown>;
}

/** Exceptions for owner review (the row migrated, adjusted, or was deliberately not carried). */
export async function recordExceptions(ctx: StepContext, table: string, found: readonly Finding[]) {
  await insertRows(
    ctx,
    'legacy.exceptions',
    found.map((f) => ({
      run_id: ctx.runId,
      instance: ctx.instance,
      kind: f.kind,
      legacy_table: table,
      legacy_id: f.legacyId,
      detail: JSON.stringify(f.detail ?? {}),
    })),
  );
}

/** Quarantined rows: invalid, not migrated (content tables may quarantine up to 0.5%). */
export async function recordQuarantine(ctx: StepContext, table: string, found: readonly Finding[]) {
  await insertRows(
    ctx,
    'legacy.quarantine',
    found.map((f) => ({
      run_id: ctx.runId,
      instance: ctx.instance,
      table_name: table,
      legacy_id: f.legacyId,
      column_name: (f.detail?.column as string | undefined) ?? null,
      reason: f.kind,
      detail: f.detail ? JSON.stringify(f.detail) : null,
    })),
  );
}

/** Legacy id → new id (idempotent; a rerun keeps the same mapping). */
export async function recordRefs(
  ctx: StepContext,
  entity: string,
  refs: readonly { legacyId: string; newId: string; orgId: string; compatId?: number | null }[],
) {
  for (let i = 0; i < refs.length; i += 1000)
    await ctx.sql`
      insert into legacy.ref ${ctx.sql(
        refs.slice(i, i + 1000).map((r) => ({
          instance: ctx.instance,
          entity,
          legacy_id: r.legacyId,
          new_id: r.newId,
          org_id: r.orgId,
          compat_id: r.compatId ?? null,
        })),
      )}
      on conflict (instance, entity, legacy_id) do update set new_id = excluded.new_id, org_id = excluded.org_id`;
}
