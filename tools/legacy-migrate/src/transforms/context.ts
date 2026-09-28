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
  readonly log: (message: string) => void;
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Expand a step's SQL template: `{s}` the staging schema, `{inst}` the instance literal, `{run}` the
 * run id, `{tz}` the platform timezone literal, `{cur}` the default currency literal. Values are
 * quoted literals or identifiers; nothing from the dump is spliced into SQL text.
 */
export function expand(ctx: StepContext, text: string): string {
  return text
    .replaceAll('{s}', ident(stagingSchema(ctx.instance)))
    .replaceAll('{inst}', lit(ctx.instance))
    .replaceAll('{run}', String(ctx.runId))
    .replaceAll('{tz}', lit(ctx.platformTz))
    .replaceAll('{cur}', lit(ctx.currency))
    .replaceAll('{clock}', lit(ctx.eventClock));
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

/** Legacy system timestamp (wall clock in the platform timezone) → timestamptz, as SQL. */
export const sysTs = (col: string) => `(${col} at time zone {tz})`;
