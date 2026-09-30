import { currentRole, type MigratorSql, migratorSql } from '@yayatoh/db/migration';
import { type LoadResult, loadDump } from './load.ts';
import { ensureControlSchema, ident, stagingSchema } from './sql.ts';
import type { EventClock, Instance, StepContext } from './transforms/context.ts';
import { issueCodes } from './transforms/issue.ts';
import { mediaRefs } from './transforms/media-refs.ts';
import { t1Identity } from './transforms/t1-identity.ts';
import { t2Orgs } from './transforms/t2-orgs.ts';
import { t3Catalog } from './transforms/t3-catalog.ts';
import { t3Program } from './transforms/t3-program.ts';
import { t3Seating } from './transforms/t3-seating.ts';
import { t3VenuesSeries } from './transforms/t3-venues-series.ts';
import { t4Commerce } from './transforms/t4-commerce.ts';
import { t5Checkins } from './transforms/t5-checkins.ts';
import { t6Chats } from './transforms/t6-chats.ts';
import { t6Comms } from './transforms/t6-comms.ts';
import { t7Content } from './transforms/t7-content.ts';
import { t8Auth } from './transforms/t8-auth.ts';
import { t9Derived } from './transforms/t9-derived.ts';
import { urlInventory } from './transforms/url-inventory.ts';
import { summarize, type ValidationReport, validate } from './validate.ts';

export interface RunOptions {
  readonly instance: Instance;
  readonly mode: 'rehearsal' | 'cutover';
  /** The (masked) mysqldump to load; omit to transform what is already staged. */
  readonly dump?: string;
  /** Legacy event DATE+TIME are platform-timezone wall clock (default) or venue-local. */
  readonly eventClock?: EventClock;
  /** Platform timezone override; default: the dump's `regional.timezone_default` setting. */
  readonly systemTimezone?: string;
  /** The freeze instant (cutover T−0); default: now. What was live then is carried (T8, T6 plan). */
  readonly freezeAt?: Date;
  /** Extra hosts the URL inventory's redirects are loaded for (e.g. a dev host for e2e). */
  readonly extraHosts?: readonly string[];
  readonly log?: (message: string) => void;
}

export interface RunResult {
  readonly runId: number;
  readonly pass: boolean;
  readonly report: ValidationReport & {
    readonly mode: string;
    readonly dumpSha256: string | null;
    readonly timingsMs: Record<string, number>;
    readonly totalMs: number;
    readonly loaded: Record<string, number> | null;
  };
  readonly summary: string;
}

export const STAGES = [
  't1_identity',
  't2_orgs',
  't3_catalog',
  't4_commerce',
  't5_checkins',
  'issue_codes',
  't3_venues_series',
  't3_seating',
  't3_program',
  't6_comms',
  't6_chats',
  't7_content',
  't8_auth',
  't9_derived',
  'media_refs',
  'url_inventory',
] as const;

async function instanceSettings(sql: MigratorSql, instance: Instance, override?: string) {
  const S = ident(stagingSchema(instance));
  const rows = (await sql
    .unsafe(
      `select key, value from ${S}.settings where key in ('regional.timezone_default', 'regional.currency_default', 'multi-vendor.admin_commission')`,
    )
    .catch(() => [])) as unknown as { key: string; value: string | null }[];
  const get = (k: string) => rows.find((r) => r.key === k)?.value?.trim() || null;
  const tz = override ?? get('regional.timezone_default') ?? 'America/New_York';
  const [valid] = await sql<
    { ok: boolean }[]
  >`select exists (select 1 from pg_timezone_names where name = ${tz}) as ok`;
  if (!valid?.ok) throw new Error(`unknown platform timezone "${tz}"`);
  const cur = (get('regional.currency_default') ?? 'USD').toUpperCase();
  const pct = Number(get('multi-vendor.admin_commission') ?? '0');
  return {
    platformTz: tz,
    currency: /^[A-Z]{3}$/.test(cur) ? cur : 'USD',
    commissionBps: Number.isFinite(pct) ? Math.round(pct * 100) : 0,
  };
}

/**
 * `pnpm migrate:legacy --instance=yay|abc --mode=rehearsal|cutover --dump <file>`: load, transform,
 * issue codes, validate. Runs as `migrator` only. Idempotent: a rerun on the same dump produces the
 * same ids and no duplicates. The run fails (non-zero exit) when a money or ticket table quarantined
 * any row, a content table more than 0.5%, or any validation check fails.
 */
export async function runMigration(opts: RunOptions): Promise<RunResult> {
  const log = opts.log ?? ((m: string) => console.info(`migrate:legacy ${m}`));
  const sql = migratorSql();
  const role = await currentRole(sql);
  if (role !== 'migrator') throw new Error(`migrate:legacy runs as migrator (connected as "${role}")`);
  if (opts.mode === 'cutover' && process.env.LEGACY_CUTOVER_CONFIRM !== opts.instance)
    throw new Error(
      `cutover mode needs LEGACY_CUTOVER_CONFIRM=${opts.instance} (runbook: docs/runbooks/legacy-migration.md)`,
    );
  const started = Date.now();
  const timings: Record<string, number> = {};
  await ensureControlSchema(sql);
  const [run] = await sql<{ id: string }[]>`
    insert into legacy.runs (instance, mode, stage) values (${opts.instance}, ${opts.mode}, 'load') returning id`;
  const runId = Number(run?.id);
  const freezeAt = opts.freezeAt ?? new Date();
  await sql`update legacy.runs set freeze_at = ${freezeAt.toISOString()} where id = ${runId}`;
  let loaded: LoadResult | null = null;
  try {
    if (opts.dump) {
      const t = Date.now();
      loaded = await loadDump(sql, opts.instance, opts.dump);
      timings.load = Date.now() - t;
      log(
        `loaded ${Object.values(loaded.tables).reduce((a, b) => a + b, 0)} rows from ${Object.keys(loaded.tables).length} tables (${timings.load} ms)`,
      );
      if (loaded.issues.length)
        await sql`insert into legacy.quarantine ${sql(
          loaded.issues.map((i) => ({
            run_id: runId,
            instance: opts.instance,
            table_name: i.table,
            legacy_id: i.legacyId,
            column_name: i.column,
            reason: i.reason,
            detail: i.detail,
          })),
        )}`;
      await sql`update legacy.runs set dump_sha256 = ${loaded.sha256} where id = ${runId}`;
    }
    const settings = await instanceSettings(sql, opts.instance, opts.systemTimezone);
    const eventClock = opts.eventClock ?? 'platform';
    await sql`
      insert into legacy.instance_settings (instance, platform_tz, currency, commission_bps, event_clock)
      values (${opts.instance}, ${settings.platformTz}, ${settings.currency}, ${settings.commissionBps}, ${eventClock})
      on conflict (instance) do update set platform_tz = excluded.platform_tz, currency = excluded.currency,
        commission_bps = excluded.commission_bps, event_clock = excluded.event_clock`;

    // One reserved connection: the stages share temporary working tables. Each stage is a
    // transaction, so a failure leaves the previous stages' (idempotent) writes in place.
    const conn = await sql.reserve();
    try {
      const ctx: StepContext = {
        sql: conn as unknown as MigratorSql,
        instance: opts.instance,
        runId,
        ...settings,
        eventClock,
        freezeAt,
        log,
      };
      const stages: Record<(typeof STAGES)[number], (c: StepContext) => Promise<void>> = {
        t1_identity: t1Identity,
        t2_orgs: t2Orgs,
        t3_catalog: t3Catalog,
        t4_commerce: t4Commerce,
        t5_checkins: t5Checkins,
        issue_codes: issueCodes,
        t3_venues_series: t3VenuesSeries,
        t3_seating: t3Seating,
        t3_program: t3Program,
        t6_comms: t6Comms,
        t6_chats: t6Chats,
        t7_content: t7Content,
        t8_auth: t8Auth,
        t9_derived: t9Derived,
        media_refs: mediaRefs,
        url_inventory: (c) => urlInventory(c, opts.extraHosts),
      };
      for (const name of STAGES) {
        const t = Date.now();
        await sql`update legacy.runs set stage = ${name} where id = ${runId}`;
        await conn.unsafe('begin');
        try {
          await stages[name](ctx);
          await conn.unsafe('commit');
        } catch (err) {
          await conn.unsafe('rollback');
          throw err;
        }
        timings[name] = Date.now() - t;
        log(`${name} done (${timings[name]} ms)`);
      }
    } finally {
      await conn.unsafe('discard temp').catch(() => {});
      conn.release();
    }

    // Fresh statistics for the tables the stages just filled (validation joins them all).
    const ta = Date.now();
    await sql.unsafe('analyze');
    timings.analyze = Date.now() - ta;
    const t = Date.now();
    const report = await validate(sql, opts.instance, runId, {
      platformTz: settings.platformTz,
      eventClock,
      freezeAt,
    });
    timings.validate = Date.now() - t;
    const totalMs = Date.now() - started;
    const full = {
      ...report,
      mode: opts.mode,
      dumpSha256: loaded?.sha256 ?? null,
      timingsMs: timings,
      totalMs,
      loaded: loaded?.tables ?? null,
    };
    await sql`
      update legacy.runs set status = ${report.pass ? 'succeeded' : 'failed'}, stage = 'done', finished_at = now(),
        timings = ${JSON.stringify(timings)}::jsonb, report = ${JSON.stringify(full)}::jsonb
      where id = ${runId}`;
    return { runId, pass: report.pass, report: full, summary: `${summarize(report)}\n  time: ${totalMs} ms` };
  } catch (err) {
    await sql`update legacy.runs set status = 'failed', finished_at = now(), timings = ${JSON.stringify(timings)}::jsonb,
                report = ${JSON.stringify({ error: String(err) })}::jsonb where id = ${runId}`.catch(
      () => {},
    );
    throw err;
  }
}

/** `pnpm migrate:legacy:validate --instance=…`: re-validate the latest run of an instance. */
export async function revalidate(instance: Instance): Promise<RunResult> {
  const sql = migratorSql();
  await ensureControlSchema(sql);
  const [run] = await sql<
    {
      id: string;
      mode: string;
      dump_sha256: string | null;
      timings: Record<string, number>;
      freeze_at: Date | null;
    }[]
  >`
    select id, mode, dump_sha256, timings, freeze_at from legacy.runs where instance = ${instance} order by id desc limit 1`;
  const [settings] = await sql<{ platform_tz: string; event_clock: EventClock }[]>`
    select platform_tz, event_clock from legacy.instance_settings where instance = ${instance}`;
  if (!run || !settings) throw new Error(`no migration run for instance ${instance}`);
  const runId = Number(run.id);
  const report = await validate(sql, instance, runId, {
    platformTz: settings.platform_tz,
    eventClock: settings.event_clock,
    freezeAt: run.freeze_at ? new Date(run.freeze_at) : new Date(),
  });
  const full = {
    ...report,
    mode: run.mode,
    dumpSha256: run.dump_sha256,
    timingsMs: run.timings,
    totalMs: 0,
    loaded: null,
  };
  return { runId, pass: report.pass, report: full, summary: summarize(report) };
}
