import {
  backfillStatusQuery,
  postgresWarehouse,
  startBackfillCommand,
  WAREHOUSE_CONSUMER,
} from '@yayatoh/analytics';
import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { type OrgFixture, ports, twoOrgs } from '@yayatoh/testing';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { subscribers } from '../src/registry.ts';
import { BACKFILL_JOB, backfillJob, enqueueDueBackfills } from '../src/warehouse.ts';
import { startWorker } from '../src/worker.ts';

/**
 * M6.2a: the warehouse subscriber is registered, and a backfill runs as the pg-boss job
 * `analytics.backfill`, one job per run at a time (exclusive queue keyed by the run), queued by
 * the leader's tick while a page is due (platform_reader, audited), until the run is done.
 */
let a: OrgFixture;
let b: OrgFixture;
let boss: PgBoss;
const audited: string[] = [];

async function until(check: () => Promise<boolean>, ms = 30_000) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 200));
  }
}

beforeAll(async () => {
  setPlatformAuditSink(async ({ actor }) => void audited.push(actor));
  ({ a, b } = await twoOrgs());
  // A tiny budget: each job works about one page, then the tick queues the next.
  boss = await startWorker({
    connectionString: process.env.MIGRATOR_DATABASE_URL as string,
    jobs: [backfillJob(postgresWarehouse, { budgetMs: 1 })],
  });
});
afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closePools();
});

describe('analytics warehouse in the worker (M6.2a)', () => {
  it('registers the warehouse subscriber', () => {
    const subs = subscribers({
      ...process.env,
      APP_TOKEN_SECRET: 'x'.repeat(32),
      NEXT_PUBLIC_APP_ORIGIN: 'https://app.test',
    });
    expect(subs.map((s) => s.name)).toContain(WAREHOUSE_CONSUMER);
  });

  it('works a backfill page by page until it is done, one job per run at a time', async () => {
    const run = await executeCommand(
      startBackfillCommand,
      { pageSize: 1, pagesPerMinute: 600 },
      a.ctx(),
      ports,
    );
    const first = await boss.send(
      BACKFILL_JOB,
      { orgId: a.org.id, runId: run.id },
      { singletonKey: run.id, startAfter: 60 },
    );
    const second = await boss.send(
      BACKFILL_JOB,
      { orgId: a.org.id, runId: run.id },
      { singletonKey: run.id },
    );
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    await boss.cancel(BACKFILL_JOB, first as string);
    await until(async () => {
      await enqueueDueBackfills(boss, new Set([a.org.id]));
      return (await executeQuery(backfillStatusQuery, {}, a.ctx(), ports))?.status === 'done';
    });
    const done = await executeQuery(backfillStatusQuery, {}, a.ctx(), ports);
    expect(done).toMatchObject({ id: run.id, status: 'done', eventsWritten: 0 });
    expect(done?.pagesDone).toBe((done?.eventsDone ?? 0) + 1);
    expect(audited).toContain('system:analytics');
    // Org B's runs are its own: nothing of B was queued or changed.
    expect(await executeQuery(backfillStatusQuery, {}, b.ctx(), ports)).toMatchObject({ status: 'done' });
    expect((await executeQuery(backfillStatusQuery, {}, b.ctx(), ports))?.id).not.toBe(run.id);
  });
});
