import { withTenant } from '@yayatoh/db';
import { eventIdsTx } from '@yayatoh/events';
import { actorId, createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { BACKFILL_STATUSES, backfillRuns, WAREHOUSE_ADAPTERS } from './schema.ts';
import { syncEventTx } from './sync.ts';
import type { AnalyticsWarehouse } from './warehouse/port.ts';
import { configuredWarehouseName } from './warehouse/select.ts';

/** Defaults: 25 events a page, at most 30 pages a minute (750 events a minute per org). */
export const BACKFILL_DEFAULTS = { pageSize: 25, pagesPerMinute: 30 } as const;
export const BACKFILL_ACTOR = 'analytics.backfill';

export const BackfillRunDto = z.object({
  id: z.uuid(),
  status: z.enum(BACKFILL_STATUSES),
  adapter: z.enum(WAREHOUSE_ADAPTERS),
  pagesDone: z.int().nonnegative(),
  eventsDone: z.int().nonnegative(),
  eventsWritten: z.int().nonnegative(),
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
});
export type BackfillRunDto = z.infer<typeof BackfillRunDto>;

type RunRow = typeof backfillRuns.$inferSelect;
const toDto = (r: RunRow): BackfillRunDto => ({
  id: r.id,
  status: r.status as BackfillRunDto['status'],
  adapter: r.adapter as BackfillRunDto['adapter'],
  pagesDone: r.pagesDone,
  eventsDone: r.eventsDone,
  eventsWritten: r.eventsWritten,
  startedAt: r.createdAt,
  finishedAt: r.finishedAt,
});

/**
 * Rebuild the org's warehouse from the source tables (M6.2a): starts a backfill run that the
 * worker's `analytics.backfill` job works a page at a time. Nothing leaves the platform and no
 * source data changes; owners and admins (`org:update`) may start one. One run at a time per org.
 */
export const startBackfillCommand = tenantCommand({
  name: 'analytics.startBackfill',
  input: z.object({
    pageSize: z.int().min(1).max(500).default(BACKFILL_DEFAULTS.pageSize),
    pagesPerMinute: z.int().min(1).max(600).default(BACKFILL_DEFAULTS.pagesPerMinute),
  }),
  output: BackfillRunDto,
  entitlement: 'analytics_pro',
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const [running] = await tx
      .select({ id: backfillRuns.id })
      .from(backfillRuns)
      .where(and(eq(backfillRuns.orgId, orgId), eq(backfillRuns.status, 'running')));
    if (running) throw new DomainError('conflict', 'A rebuild is already running', { reason: 'running' });
    const [row] = await tx
      .insert(backfillRuns)
      .values({
        orgId,
        status: 'running',
        adapter: configuredWarehouseName(),
        pageSize: input.pageSize,
        pagesPerMinute: input.pagesPerMinute,
        nextPageAt: ctx.now,
        startedBy: actorId(ctx.actor),
      })
      .returning();
    return toDto(row as RunRow);
  },
  audit: (_input, r) => ({ action: 'analytics.backfill_started', targetType: 'backfill_run', targetId: r.id }),
});

/** The org's latest backfill run, or null. */
export const backfillStatusQuery = tenantQuery({
  name: 'analytics.backfillStatus',
  input: z.object({}),
  output: BackfillRunDto.nullable(),
  entitlement: 'analytics_pro',
  permission: 'orders:read',
  handler: async ({ ctx, tx }) => {
    const [row] = await tx
      .select()
      .from(backfillRuns)
      .where(eq(backfillRuns.orgId, requireOrg(ctx)))
      .orderBy(desc(backfillRuns.createdAt))
      .limit(1);
    return row ? toDto(row) : null;
  },
});

export type PageResult =
  | { readonly state: 'idle' }
  | { readonly state: 'waiting'; readonly nextPageAt: Date }
  | { readonly state: 'page' | 'done'; readonly events: number; readonly written: number }
  | { readonly state: 'failed'; readonly error: string };

/**
 * Work one page of a backfill run (M6.2a), in one tenant transaction: the next `pageSize` events
 * after the run's cursor (by id), each synced through `syncEventTx` (so an event the warehouse
 * already holds exactly is not written again), then the cursor moves and the next page is due
 * `60 / pagesPerMinute` seconds later. A crash rolls the page back and the next call does it
 * again (resumable). A page asked for before its time waits (rate limit).
 */
export async function runBackfillPage(
  orgId: string,
  runId: string,
  warehouse: AnalyticsWarehouse,
  opts: { now?: Date; ignoreRateLimit?: boolean } = {},
): Promise<PageResult> {
  const ctx = createCtx({
    orgId,
    actor: { type: 'system', name: BACKFILL_ACTOR },
    ...(opts.now ? { now: opts.now } : {}),
  });
  try {
    return await withTenant(ctx, async (tx): Promise<PageResult> => {
      const [run] = await tx
        .select()
        .from(backfillRuns)
        .where(and(eq(backfillRuns.orgId, orgId), eq(backfillRuns.id, runId)))
        .for('update');
      if (!run || run.status !== 'running') return { state: 'idle' };
      if (!opts.ignoreRateLimit && run.nextPageAt.getTime() > ctx.now.getTime())
        return { state: 'waiting', nextPageAt: run.nextPageAt };
      const after = run.cursor;
      const ids = (await eventIdsTx(tx)).filter((id) => !after || id > after).slice(0, run.pageSize);
      let written = 0;
      for (const id of ids) if ((await syncEventTx({ ctx, tx }, warehouse, id)).written) written += 1;
      const done = ids.length < run.pageSize;
      await tx
        .update(backfillRuns)
        .set({
          cursor: ids.at(-1) ?? run.cursor,
          pagesDone: run.pagesDone + 1,
          eventsDone: run.eventsDone + ids.length,
          eventsWritten: run.eventsWritten + written,
          nextPageAt: new Date(ctx.now.getTime() + Math.ceil(60_000 / run.pagesPerMinute)),
          ...(done ? { status: 'done', finishedAt: ctx.now } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(backfillRuns.id, run.id));
      return { state: done ? 'done' : 'page', events: ids.length, written };
    });
  } catch (err) {
    const error = (err as Error).message.slice(0, 500);
    await withTenant(ctx, (tx) =>
      tx
        .update(backfillRuns)
        .set({ status: 'failed', error, finishedAt: ctx.now, updatedAt: sql`now()` })
        .where(and(eq(backfillRuns.id, runId), eq(backfillRuns.status, 'running'))),
    );
    return { state: 'failed', error };
  }
}

/**
 * Work a run until it finishes, fails or (unless `ignoreRateLimit`) has to wait longer than
 * `budgetMs` (the worker job; dev and seed drain with `ignoreRateLimit`).
 */
export async function runBackfill(
  orgId: string,
  runId: string,
  warehouse: AnalyticsWarehouse,
  opts: { budgetMs?: number; ignoreRateLimit?: boolean; maxPages?: number } = {},
): Promise<{ pages: number; events: number; written: number; state: PageResult['state'] }> {
  const until = Date.now() + (opts.budgetMs ?? 25_000);
  let pages = 0;
  let events = 0;
  let written = 0;
  for (;;) {
    const r = await runBackfillPage(orgId, runId, warehouse, {
      ...(opts.ignoreRateLimit ? { ignoreRateLimit: true } : {}),
    });
    if (r.state === 'page' || r.state === 'done') {
      pages += 1;
      events += r.events;
      written += r.written;
    }
    if (r.state !== 'page') return { pages, events, written, state: r.state };
    if (opts.maxPages && pages >= opts.maxPages) return { pages, events, written, state: r.state };
    if (Date.now() >= until) return { pages, events, written, state: r.state };
  }
}

/** Start a run and work it to the end at once (seed, dev, tests); no rate limit. */
export async function backfillOrgNow(orgId: string, warehouse: AnalyticsWarehouse) {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: BACKFILL_ACTOR } });
  const run = await withTenant(ctx, async (tx) => {
    const [running] = await tx
      .select({ id: backfillRuns.id })
      .from(backfillRuns)
      .where(and(eq(backfillRuns.orgId, orgId), eq(backfillRuns.status, 'running')));
    if (running) return running;
    const [row] = await tx
      .insert(backfillRuns)
      .values({
        orgId,
        status: 'running',
        adapter: warehouse.name,
        pageSize: BACKFILL_DEFAULTS.pageSize,
        pagesPerMinute: BACKFILL_DEFAULTS.pagesPerMinute,
        nextPageAt: ctx.now,
        startedBy: `system:${BACKFILL_ACTOR}`,
      })
      .returning({ id: backfillRuns.id });
    return row as { id: string };
  });
  return { runId: run.id, ...(await runBackfill(orgId, run.id, warehouse, { ignoreRateLimit: true, budgetMs: 3_600_000 })) };
}
