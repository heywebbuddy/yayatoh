import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { listConnectionsQuery, requestSyncCommand } from '@yayatoh/integrations';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { fakeAuth, type OrgFixture, ports, twoOrgs } from '@yayatoh/testing';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  enqueueSlackWork,
  enqueueSyncWork,
  orgsWithSlackWork,
  SLACK_JOB,
  SYNC_JOB,
  slackJob,
  syncJob,
} from '../src/integrations.ts';
import { JOBS } from '../src/registry.ts';
import { startWorker } from '../src/worker.ts';

/**
 * M6.4a: integration syncs run as the pg-boss job `integrations.sync`, one job per connection at a
 * time (an exclusive queue keyed by the connection), queued by the leader's tick for connections
 * the SECURITY DEFINER finder reports (platform_reader, audited).
 */
let a: OrgFixture;
let boss: PgBoss;
let admin: AdminSql;
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
  ({ a } = await twoOrgs());
  admin = adminClient();
  boss = await startWorker({
    connectionString: process.env.MIGRATOR_DATABASE_URL as string,
    jobs: [syncJob(fakeAuth), slackJob(fakeAuth, 'https://app.yayatoh.test')],
  });
}, 240_000);
afterAll(async () => {
  await boss?.stop({ graceful: false });
  await admin?.end();
  await closePools();
});

describe('integration sync job (M6.4a, pg-boss)', () => {
  it('the worker registers the sync job', () => {
    expect(JOBS.map((j) => j.name)).toContain(SYNC_JOB);
  });

  it('one job per connection at a time; a requested sync runs once through the queue', async () => {
    const [conn] = await executeQuery(listConnectionsQuery, {}, a.ctx(), ports);
    if (!conn) throw new Error('fixture connection');
    const first = await boss.send(
      SYNC_JOB,
      { orgId: a.org.id, connectionId: conn.id },
      { singletonKey: conn.id, startAfter: 60 },
    );
    const second = await boss.send(
      SYNC_JOB,
      { orgId: a.org.id, connectionId: conn.id },
      { singletonKey: conn.id },
    );
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    await boss.cancel(SYNC_JOB, first as string);

    const { runId } = await executeCommand(requestSyncCommand, { connectionId: conn.id }, a.ctx(), ports);
    expect(await enqueueSyncWork(boss, new Set([a.org.id]))).toBe(1);
    expect(audited).toContain('system:integrations');
    await until(async () => {
      const [row] = await admin<
        { status: string }[]
      >`select status from integrations.sync_runs where id = ${runId}`;
      return row?.status !== 'queued' && row?.status !== 'running';
    });
    const [run] = await admin<{ status: string; trigger: string }[]>`
      select status, trigger from integrations.sync_runs where id = ${runId}`;
    // The demo's broken record may have been retried in it (partial) if its retry came due.
    expect(run?.trigger).toBe('manual');
    expect(['succeeded', 'partial']).toContain(run?.status);
    // Nothing due any more for this org (the next scheduled sync is an hour away).
    await until(async () => (await enqueueSyncWork(boss, new Set([a.org.id]))) === 0);
  });
});

describe('Slack job (M6.4c, pg-boss)', () => {
  it('the worker registers the Slack job; the leader queues one per org with due messages', async () => {
    expect(JOBS.map((j) => j.name)).toContain(SLACK_JOB);
    // The fixture queued a test alert to its Slack channel.
    // Every fixture org of the run queued one, so ask for all of them.
    expect(await orgsWithSlackWork(100_000)).toContain(a.org.id);
    expect(audited).toContain('system:integrations');
    expect(await enqueueSlackWork(boss, new Set([a.org.id]), 100_000)).toBe(1);
    await until(async () => {
      const rows = await admin<{ status: string }[]>`
        select status from integrations.slack_messages where org_id = ${a.org.id} and kind = 'test'`;
      return rows.length > 0 && rows.every((r) => r.status === 'sent');
    });
    await until(async () => (await enqueueSlackWork(boss, new Set([a.org.id]), 100_000)) === 0);
  });
});
